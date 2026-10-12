using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace OpsPlatform.Api.Persistence.Relational;

public sealed class PromptVersionRow
{
    public int Id { get; set; }
    public string PromptId { get; set; } = string.Empty;
    public int Version { get; set; }
    public string Content { get; set; } = string.Empty;
    public long CreatedAtUnixMs { get; set; }
    public int? SourceVersion { get; set; }
}
public sealed class PromptPublishedRow
{
    public int Id { get; set; }
    public string PromptId { get; set; } = string.Empty;
    public int Version { get; set; }
    public string Content { get; set; } = string.Empty;
    public int PublishedFrom { get; set; }
    public long PublishedAtUnixMs { get; set; }
    public string? ApprovalReference { get; set; }
    public string? ApprovedBy { get; set; }
}
// Relational prompt state. Variable schemas are still code-owned: this store only replaces content state, and
// unknown prompt ids are ignored on load. Development-only: Save rewrites the whole state inside one
// transaction, so it is not a production write path.
public sealed class RelationalPromptStateStore(DbContextOptions<OpsPlatformDbContext> options) : IPromptStateStore
{
    public IReadOnlyList<PromptStateEntry>? Load()
    {
        using var context = new OpsPlatformDbContext(options);
        if (!context.PromptVersions.Any() && !context.PromptPublished.Any()) return null;
        var versions = context.PromptVersions.AsNoTracking().OrderBy(row => row.PromptId).ThenBy(row => row.Version)
            .Select(row => new { row.PromptId, Row = new PromptStateVersion(row.Version, row.Content, DateTimeOffset.FromUnixTimeMilliseconds(row.CreatedAtUnixMs), row.SourceVersion) })
            .ToArray();
        var published = context.PromptPublished.AsNoTracking().OrderBy(row => row.PromptId).ThenBy(row => row.Version)
            .Select(row => new { row.PromptId, Row = new PromptStatePublished(row.Version, row.Content, row.PublishedFrom, DateTimeOffset.FromUnixTimeMilliseconds(row.PublishedAtUnixMs), row.ApprovalReference, row.ApprovedBy) })
            .ToArray();
        var ids = versions.Select(item => item.PromptId).Concat(published.Select(item => item.PromptId)).Distinct(StringComparer.Ordinal).OrderBy(id => id, StringComparer.Ordinal);
        return ids.Select(id => new PromptStateEntry(id,
            versions.Where(item => item.PromptId == id).Select(item => item.Row).ToArray(),
            published.Where(item => item.PromptId == id).Select(item => item.Row).ToArray())).ToArray();
    }
    public void Save(IReadOnlyList<PromptStateEntry> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);
        using var context = new OpsPlatformDbContext(options);
        using var transaction = context.Database.BeginTransaction();
        context.PromptVersions.ExecuteDelete();
        context.PromptPublished.ExecuteDelete();
        foreach (var entry in entries)
        {
            foreach (var version in entry.Versions)
                context.PromptVersions.Add(new PromptVersionRow
                {
                    PromptId = entry.Id, Version = version.Version, Content = version.Content,
                    CreatedAtUnixMs = version.CreatedAt.ToUnixTimeMilliseconds(), SourceVersion = version.SourceVersion,
                });
            foreach (var published in entry.Published)
                context.PromptPublished.Add(new PromptPublishedRow
                {
                    PromptId = entry.Id, Version = published.Version, Content = published.Content, PublishedFrom = published.PublishedFrom,
                    PublishedAtUnixMs = published.PublishedAt.ToUnixTimeMilliseconds(),
                    ApprovalReference = published.ApprovalReference, ApprovedBy = published.ApprovedBy,
                });
        }
        context.SaveChanges();
        transaction.Commit();
    }
}
