using System.Text.Json;

namespace OpsPlatform.Api.Persistence;

// Development-only file-backed implementation of the idempotency ledger port. It keeps the same in-process
// semantics as DemoOperationLedger (claim before executing, resolve afterwards, capacity rejection) and adds
// only write-through persistence with an atomic replace. No transactions, no cross-instance coordination,
// no expiry or tombstone cleanup: it must never be presented as production idempotency.
public sealed class JsonFileOperationLedger : IOperationLedger
{
    private readonly object gate = new();
    private readonly string path;
    private readonly string tempPath;
    private readonly Dictionary<(string Scope,string Operation,string Key),OperationRecord> entries = new();
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    public JsonFileOperationLedger(string filePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(filePath);
        path = Path.GetFullPath(filePath);
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
        tempPath = path + ".tmp";
        foreach (var record in Load()) entries[(record.Scope,record.Operation,record.Key)] = record;
    }
    public int Count { get { lock (gate) return entries.Count; } }
    public OperationClaim Claim(IdempotencyIdentity identity, Guid operationId)
    {
        ArgumentNullException.ThrowIfNull(identity);
        if (operationId == Guid.Empty) throw new ArgumentException("Operation identifier required.", nameof(operationId));
        lock (gate)
        {
            if (entries.TryGetValue(Key(identity), out var existing))
            {
                if (existing.Digest != identity.Digest) return new(OperationOutcome.PayloadConflict, existing);
                return new(existing.Completed ? OperationOutcome.ReplayCompleted : existing.Unknown ? OperationOutcome.ReplayUnknown : OperationOutcome.PendingConflict, existing);
            }
            if (entries.Count >= DemoOperationLedger.Capacity) return new(OperationOutcome.CapacityReached, null);
            var record = new OperationRecord(identity.Scope, identity.Operation, identity.Key, identity.Digest, operationId, "pending", 0);
            entries[Key(identity)] = record;
            Flush();
            return new(OperationOutcome.Claimed, record);
        }
    }
    public bool Complete(IdempotencyIdentity identity, Guid operationId, int resultVersion, string? resultReference = null)
    {
        ArgumentNullException.ThrowIfNull(identity);
        if (resultVersion < 1) throw new ArgumentOutOfRangeException(nameof(resultVersion));
        if (resultReference is not null && (resultReference.Length is 0 or >128 || resultReference.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or ':'))))
            throw new ArgumentException("Invalid result reference.", nameof(resultReference));
        lock (gate)
        {
            if (!entries.TryGetValue(Key(identity), out var existing) || existing.OperationId != operationId || existing.Completed) return false;
            entries[Key(identity)] = existing with { State = "completed", ResultVersion = resultVersion, ResultReference = resultReference };
            Flush();
            return true;
        }
    }
    public bool MarkUnknown(IdempotencyIdentity identity, Guid operationId)
    {
        ArgumentNullException.ThrowIfNull(identity);
        lock (gate)
        {
            if (!entries.TryGetValue(Key(identity), out var existing) || existing.OperationId != operationId || existing.Completed) return false;
            entries[Key(identity)] = existing with { State = "unknown" };
            Flush();
            return true;
        }
    }
    public bool Release(IdempotencyIdentity identity, Guid operationId)
    {
        ArgumentNullException.ThrowIfNull(identity);
        lock (gate)
        {
            if (!entries.TryGetValue(Key(identity), out var existing) || existing.OperationId != operationId || existing.Completed) return false;
            var removed = entries.Remove(Key(identity));
            if (removed) Flush();
            return removed;
        }
    }
    public DemoOperationSummary Summary()
    {
        lock (gate) return new(DemoOperationLedger.Capacity, entries.Count,
            entries.Values.Count(record => record.State == "pending"),
            entries.Values.Count(record => record.Completed),
            entries.Values.Count(record => record.Unknown));
    }
    public OperationRecord? Find(Guid operationId)
    {
        if (operationId == Guid.Empty) throw new ArgumentException("Operation identifier required.", nameof(operationId));
        lock (gate) return entries.Values.FirstOrDefault(record => record.OperationId == operationId);
    }
    public OperationRecord? Get(IdempotencyIdentity identity)
    {
        ArgumentNullException.ThrowIfNull(identity);
        lock (gate) return entries.TryGetValue(Key(identity), out var record) ? record : null;
    }
    private List<OperationRecord> Load()
    {
        if (!File.Exists(path)) return [];
        try
        {
            var loaded = JsonSerializer.Deserialize<List<OperationRecord>>(File.ReadAllText(path), Options) ?? [];
            // A record without an operation id is not something this store wrote; quarantine the whole file.
            if (loaded.Any(record => record is null || record.OperationId == Guid.Empty || string.IsNullOrWhiteSpace(record.Key)
                || record.Digest.Length != 64 || record.State is not ("pending" or "completed" or "unknown")))
                return Quarantine("unreadable-records");
            return loaded.TakeLast(DemoOperationLedger.Capacity).ToList();
        }
        catch (JsonException) { return Quarantine("invalid-json"); }
        catch (IOException) { return Quarantine("unreadable-file"); }
    }
    // Never delete evidence silently: move the damaged file aside so it can be inspected.
    private List<OperationRecord> Quarantine(string reason)
    {
        try { File.Move(path, $"{path}.{reason}-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}", overwrite: false); }
        catch (IOException) { }
        return [];
    }
    private void Flush()
    {
        File.WriteAllText(tempPath, JsonSerializer.Serialize(entries.Values.ToList(), Options));
        File.Move(tempPath, path, overwrite: true);
    }
    private static (string, string, string) Key(IdempotencyIdentity identity) => (identity.Scope, identity.Operation, identity.Key);
}
