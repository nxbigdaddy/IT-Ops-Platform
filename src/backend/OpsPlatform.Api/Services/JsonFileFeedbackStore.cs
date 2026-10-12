using System.Text.Json;
using OpsPlatform.Api.Contracts;

namespace OpsPlatform.Api.Services;

// Development-only file-backed implementation of the feedback port. It is deliberately simple: one process,
// one file, write-through with an atomic replace, no transactions, no concurrent writers, no schema migration.
// It must never be marketed as production persistence; readiness still reports unconfigured.
public sealed class JsonFileFeedbackStore : IDemoFeedbackStore
{
    private readonly object gate = new();
    private readonly string path;
    private readonly string tempPath;
    private readonly List<FeedbackDto> items;
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    public JsonFileFeedbackStore(string filePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(filePath);
        path = Path.GetFullPath(filePath);
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
        tempPath = path + ".tmp";
        items = Load();
    }
    public int Count { get { lock (gate) return items.Count; } }
    public void Add(FeedbackDto item)
    {
        ArgumentNullException.ThrowIfNull(item);
        lock (gate)
        {
            items.Add(item);
            while (items.Count > InMemoryDemoFeedbackStore.Capacity) items.RemoveAt(0);
            Flush();
        }
    }
    public IReadOnlyList<FeedbackDto> List()
    {
        lock (gate) return items.AsEnumerable().Reverse().ToArray();
    }
    private List<FeedbackDto> Load()
    {
        if (!File.Exists(path)) return [];
        try
        {
            var loaded = JsonSerializer.Deserialize<List<FeedbackDto>>(File.ReadAllText(path), Options) ?? [];
            // A file without an id is not a record we produced; treat the whole file as damaged instead of
            // keeping half-parsed entries.
            if (loaded.Any(item => item is null || item.Id == Guid.Empty || string.IsNullOrWhiteSpace(item.Message)))
                return Quarantine("unreadable-records");
            return loaded.TakeLast(InMemoryDemoFeedbackStore.Capacity).ToList();
        }
        catch (JsonException) { return Quarantine("invalid-json"); }
        catch (IOException) { return Quarantine("unreadable-file"); }
    }
    // Never delete data silently: keep the damaged file for inspection and start clean.
    private List<FeedbackDto> Quarantine(string reason)
    {
        try { File.Move(path, $"{path}.{reason}-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}", overwrite: false); }
        catch (IOException) { }
        return [];
    }
    private void Flush()
    {
        var json = JsonSerializer.Serialize(items, Options);
        File.WriteAllText(tempPath, json);
        // Replace keeps a reader from ever observing a partially written file.
        File.Move(tempPath, path, overwrite: true);
    }
}
