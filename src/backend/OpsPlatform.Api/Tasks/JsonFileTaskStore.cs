using System.Text.Json;

namespace OpsPlatform.Api.Tasks;

// Development-only file-backed implementation of the task store port. It keeps the same CAS semantics as
// DemoTaskStore (compare version, append journal, replace state atomically inside one process) and adds
// write-through with an atomic replace. There is no cross-instance coordination, no worker and no production
// persistence: a second process writing the same file would lose one of the two updates.
public sealed class JsonFileTaskStore : IDemoTaskStore
{
    private sealed record Document(Dictionary<Guid, TaskSnapshot> Tasks, List<DemoTaskJournal> Journal);
    private readonly object gate = new();
    private readonly string path;
    private readonly string tempPath;
    private readonly Dictionary<Guid, TaskSnapshot> tasks = new();
    private readonly List<DemoTaskJournal> journal = [];
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    public JsonFileTaskStore(string filePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(filePath);
        path = Path.GetFullPath(filePath);
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
        tempPath = path + ".tmp";
        var document = Load();
        foreach (var pair in document.Tasks) tasks[pair.Key] = pair.Value;
        journal.AddRange(document.Journal);
    }
    public int Count { get { lock (gate) return tasks.Count; } }
    public IReadOnlyList<DemoTaskJournal> History(Guid id)
    {
        lock (gate) return journal.Where(entry => entry.TaskId == id).ToArray();
    }
    public DemoTaskRead? Read(Guid id)
    {
        lock (gate) return tasks.TryGetValue(id, out var snapshot)
            ? new(new(id, snapshot), journal.Where(entry => entry.TaskId == id).ToArray()) : null;
    }
    public DemoTaskUpdate Create()
    {
        lock (gate)
        {
            if (tasks.Count >= DemoTaskStore.Capacity) return new(409, "capacity_reached", null);
            var id = Guid.NewGuid();var snapshot = new TaskSnapshot(TaskState.AwaitingApproval, 1);
            tasks.Add(id, snapshot);Flush();
            return new(201, "created", new(id, snapshot));
        }
    }
    public DemoTask? Get(Guid id)
    {
        lock (gate) return tasks.TryGetValue(id, out var snapshot) ? new(id, snapshot) : null;
    }
    public DemoTaskUpdate Apply(Guid id, TaskEvent action, int expectedVersion)
    {
        lock (gate)
        {
            if (!tasks.TryGetValue(id, out var snapshot)) return new(404, "task_not_found", null);
            var result = TaskLifecycle.Apply(snapshot, action, expectedVersion);
            if (!result.Accepted) return new(409, result.Code, new(id, snapshot));
            journal.Add(new(journal.Count + 1L, id, action, snapshot.State, result.Snapshot.State, result.Snapshot.Version));
            tasks[id] = result.Snapshot;
            Flush();
            return new(200, result.Code, new(id, result.Snapshot));
        }
    }
    private Document Load()
    {
        if (!File.Exists(path)) return new([], []);
        try
        {
            var document = JsonSerializer.Deserialize<Document>(File.ReadAllText(path), Options);
            if (document?.Tasks is null || document.Journal is null) return Quarantine("unreadable-document");
            // Any entry that cannot be a task this store writes means the file is damaged: keep it aside.
            if (document.Tasks.Values.Any(snapshot => snapshot is null || snapshot.Version < 1 || !Enum.IsDefined(snapshot.State))
                || document.Journal.Any(entry => entry is null || entry.Sequence < 1 || !Enum.IsDefined(entry.Event) || !Enum.IsDefined(entry.From) || !Enum.IsDefined(entry.To)))
                return Quarantine("unreadable-records");
            if (document.Tasks.Count > DemoTaskStore.Capacity) return Quarantine("over-capacity");
            return document;
        }
        catch (JsonException) { return Quarantine("invalid-json"); }
        catch (IOException) { return Quarantine("unreadable-file"); }
    }
    // Never delete evidence silently: move the damaged file aside so it can be inspected.
    private Document Quarantine(string reason)
    {
        try { File.Move(path, $"{path}.{reason}-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}", overwrite: false); }
        catch (IOException) { }
        return new([], []);
    }
    private void Flush()
    {
        var document = new Document(tasks.ToDictionary(pair => pair.Key, pair => pair.Value), [.. journal]);
        File.WriteAllText(tempPath, JsonSerializer.Serialize(document, Options));
        File.Move(tempPath, path, overwrite: true);
    }
}
