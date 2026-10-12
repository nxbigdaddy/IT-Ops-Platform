namespace OpsPlatform.Api.Persistence;

// Replacable port: the Demo implements it in process memory, a durable store must implement the same protocol
// (claim before executing, complete or mark unknown afterwards, never authorise a retry from a replay).
public interface IOperationLedger
{
    int Count { get; }
    DemoOperationSummary Summary();
    OperationRecord? Find(Guid operationId);
    OperationRecord? Get(IdempotencyIdentity identity);
    OperationClaim Claim(IdempotencyIdentity identity, Guid operationId);
    bool Complete(IdempotencyIdentity identity, Guid operationId, int resultVersion, string? resultReference = null);
    bool Release(IdempotencyIdentity identity, Guid operationId);
    bool MarkUnknown(IdempotencyIdentity identity, Guid operationId);
}
public enum OperationOutcome { Claimed, ReplayCompleted, ReplayUnknown, PendingConflict, PayloadConflict, CapacityReached }
public sealed record OperationRecord(string Scope,string Operation,string Key,string Digest,Guid OperationId,string State,int ResultVersion,string? ResultReference = null)
{
    public bool Completed => State=="completed";
    public bool Unknown => State=="unknown";
}
public sealed record OperationClaim(OperationOutcome Outcome,OperationRecord? Record)
{
    public bool MayExecute => Outcome==OperationOutcome.Claimed;
    // Reconciling an undetermined outcome is not permission to repeat the write.
    public bool ReconciliationRequired => Outcome==OperationOutcome.ReplayUnknown;
    public bool AutomaticRetryAllowed => false;
}
public sealed record DemoOperationSummary(int Capacity,int Count,int Pending,int Completed,int Unknown)
{
    public bool Persistent => false;
    public int Remaining => Capacity-Count;
}
// Process-local demonstration ledger only. Durability, expiration and cross-instance uniqueness are NOT implemented.
public sealed class DemoOperationLedger : IOperationLedger
{
    public const int Capacity = 500;
    private readonly object gate = new();
    private readonly Dictionary<(string Scope,string Operation,string Key),OperationRecord> entries = new();
    public int Count { get { lock(gate) return entries.Count; } }
    public OperationClaim Claim(IdempotencyIdentity identity,Guid operationId)
    {
        ArgumentNullException.ThrowIfNull(identity);
        if(operationId==Guid.Empty) throw new ArgumentException("Operation identifier required.",nameof(operationId));
        lock(gate)
        {
            if(entries.TryGetValue(Key(identity),out var existing))
            {
                if(existing.Digest!=identity.Digest) return new(OperationOutcome.PayloadConflict,existing);
                return new(existing.Completed?OperationOutcome.ReplayCompleted:existing.Unknown?OperationOutcome.ReplayUnknown:OperationOutcome.PendingConflict,existing);
            }
            if(entries.Count>=Capacity) return new(OperationOutcome.CapacityReached,null);
            var record=new OperationRecord(identity.Scope,identity.Operation,identity.Key,identity.Digest,operationId,"pending",0);
            entries.Add(Key(identity),record);
            return new(OperationOutcome.Claimed,record);
        }
    }
    // Pending and unknown records may only be resolved by the operation that claimed them.
    public bool Complete(IdempotencyIdentity identity,Guid operationId,int resultVersion)
        => Complete(identity,operationId,resultVersion,null);
    // resultReference is an opaque server-side pointer (for example a record id) used to answer replays.
    public bool Complete(IdempotencyIdentity identity,Guid operationId,int resultVersion,string? resultReference)
    {
        ArgumentNullException.ThrowIfNull(identity);
        if(resultVersion<1) throw new ArgumentOutOfRangeException(nameof(resultVersion));
        if(resultReference is not null&&(resultReference.Length is 0 or >128||resultReference.Any(c=>!(char.IsAsciiLetterOrDigit(c)||c is '-' or '_' or '.' or ':'))))
            throw new ArgumentException("Invalid result reference.",nameof(resultReference));
        lock(gate)
        {
            if(!entries.TryGetValue(Key(identity),out var existing)||existing.OperationId!=operationId||existing.Completed) return false;
            entries[Key(identity)]=existing with {State="completed",ResultVersion=resultVersion,ResultReference=resultReference};
            return true;
        }
    }
    public bool MarkUnknown(IdempotencyIdentity identity,Guid operationId)    {
        ArgumentNullException.ThrowIfNull(identity);
        lock(gate)
        {
            if(!entries.TryGetValue(Key(identity),out var existing)||existing.OperationId!=operationId||existing.Completed) return false;
            entries[Key(identity)]=existing with {State="unknown"};
            return true;
        }
    }
    // Only for outcomes proven not committed (validation, permission or version rejection).
    // Never use it to retry an unknown or completed write.
    public bool Release(IdempotencyIdentity identity,Guid operationId)
    {
        ArgumentNullException.ThrowIfNull(identity);
        lock(gate)
        {
            if(!entries.TryGetValue(Key(identity),out var existing)||existing.OperationId!=operationId||existing.Completed) return false;
            return entries.Remove(Key(identity));
        }
    }
    // Single-instance snapshot only: counts describe this process right now and expire with it.
    public DemoOperationSummary Summary()
    {
        lock(gate) return new(Capacity,entries.Count,
            entries.Values.Count(record=>record.State=="pending"),
            entries.Values.Count(record=>record.Completed),
            entries.Values.Count(record=>record.Unknown));
    }
    // Reconciliation lookup by operation id. A real implementation must also check scope and permission.
    public OperationRecord? Find(Guid operationId)
    {
        if(operationId==Guid.Empty) throw new ArgumentException("Operation identifier required.",nameof(operationId));
        lock(gate) return entries.Values.FirstOrDefault(record=>record.OperationId==operationId);
    }
    public OperationRecord? Get(IdempotencyIdentity identity)    {
        ArgumentNullException.ThrowIfNull(identity);
        lock(gate) return entries.TryGetValue(Key(identity),out var record)?record:null;
    }
    private static (string,string,string) Key(IdempotencyIdentity identity)=>(identity.Scope,identity.Operation,identity.Key);
}
