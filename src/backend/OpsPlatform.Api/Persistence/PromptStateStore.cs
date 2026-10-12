using System.Text.Json;

namespace OpsPlatform.Api.Persistence;

// Serializable prompt state. Variable schemas are deliberately NOT part of it: they stay code-owned so a file
// can never introduce or widen the placeholders a feature accepts.
public sealed record PromptStateVersion(int Version, string Content, DateTimeOffset CreatedAt, int? SourceVersion);
public sealed record PromptStatePublished(int Version, string Content, int PublishedFrom, DateTimeOffset PublishedAt, string? ApprovalReference = null, string? ApprovedBy = null);
public sealed record PromptStateEntry(string Id, PromptStateVersion[] Versions, PromptStatePublished[] Published);
public interface IPromptStateStore
{
    // Null means "no stored state"; an empty list means "stored state with no usable entries".
    IReadOnlyList<PromptStateEntry>? Load();
    void Save(IReadOnlyList<PromptStateEntry> entries);
}
// Development-only file-backed prompt state: write-through with an atomic replace, no transactions, no
// concurrent writers and no schema migration. Damaged files are moved aside instead of being deleted.
public sealed class JsonFilePromptStateStore : IPromptStateStore
{
    private readonly object gate = new();
    private readonly string path;
    private readonly string tempPath;
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    public JsonFilePromptStateStore(string filePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(filePath);
        path = Path.GetFullPath(filePath);
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
        tempPath = path + ".tmp";
    }
    public IReadOnlyList<PromptStateEntry>? Load()
    {
        lock (gate)
        {
            if (!File.Exists(path)) return null;
            try
            {
                var loaded = JsonSerializer.Deserialize<List<PromptStateEntry>>(File.ReadAllText(path), Options);
                if (loaded is null) return Quarantine("unreadable-document");
                if (loaded.Any(entry => entry is null || string.IsNullOrWhiteSpace(entry.Id)
                    || entry.Versions is null || entry.Versions.Length == 0
                    || entry.Published is null
                    || entry.Versions.Any(version => version is null || version.Version < 1 || string.IsNullOrWhiteSpace(version.Content))
                    || entry.Published.Any(published => published is null || published.Version < 1 || string.IsNullOrWhiteSpace(published.Content))))
                    return Quarantine("unreadable-records");
                return loaded;
            }
            catch (JsonException) { return Quarantine("invalid-json"); }
            catch (IOException) { return Quarantine("unreadable-file"); }
        }
    }
    public void Save(IReadOnlyList<PromptStateEntry> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);
        lock (gate)
        {
            File.WriteAllText(tempPath, JsonSerializer.Serialize(entries, Options));
            File.Move(tempPath, path, overwrite: true);
        }
    }
    private IReadOnlyList<PromptStateEntry>? Quarantine(string reason)
    {
        try { File.Move(path, $"{path}.{reason}-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}", overwrite: false); }
        catch (IOException) { }
        return [];
    }
}
