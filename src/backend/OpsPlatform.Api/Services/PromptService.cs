using System.Text.RegularExpressions;
using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Persistence;

namespace OpsPlatform.Api.Services;

// Fixed synthetic catalog; no rendering, model execution, publishing or approval dependencies.
public sealed partial class PromptService : IPromptCatalog
{
    public const int MaxVersions = 20;
    public const int MaxContentLength = 4000;
    private readonly object gate = new();
    private readonly Dictionary<string, Entry> entries;
    private readonly IPromptStateStore? state;

    public PromptService() : this(null) { }
    // The optional state store only replaces *content* state; schemas always come from the code below.
    public PromptService(IPromptStateStore? stateStore)
    {
        state = stateStore;
        Entry[] seeds =
        [
            new("alert-explanation", "alerts", "告警解释",
                [new("asset_name", "string", "演示资产名称", "演示应用服务器", true),
                 new("alert_summary", "string", "已知告警信息", "演示磁盘使用率85%，根因未知", true),
                 new("severity", "string", "演示严重级别", "Warning")],
                [new(1, "根据 {{asset_name}} 的 {{alert_summary}} 区分事实与假设；无依据时明确无法确认，不执行操作。", DateTimeOffset.UtcNow)], []),
            new("ticket-summary", "tickets", "工单摘要",
                [new("ticket_id", "string", "演示工单编号", "demo-ticket-01", true),
                 new("ticket_details", "string", "演示工单已知信息", "排查磁盘告警；尚未确认根因", true),
                 new("asset_name", "string", "关联演示资产", "演示应用服务器")],
                [new(1, "总结工单 {{ticket_id}} 的 {{ticket_details}} 与待人工确认项；不得自行批准变更。", DateTimeOffset.UtcNow)], []),
            new("inspection-report", "inspection", "巡检报告",
                [new("asset_name", "string", "演示资产名称", "演示应用服务器", true),
                 new("inspection_result", "string", "演示巡检观察结果", "演示主机可达；备份结果未知", true),
                 new("inspection_date", "string", "演示巡检日期", "2026-10-10")],
                [new(1, "依据 {{asset_name}} 的 {{inspection_result}} 编写摘要，标明缺失数据与来源，禁止将未知状态描述为正常。", DateTimeOffset.UtcNow)], [])
        ];
        entries = seeds.ToDictionary(p => p.Id, StringComparer.Ordinal);
        Restore(state?.Load());
    }
    // Only known ids are restored so a file can never add a prompt or change its variables.
    private void Restore(IReadOnlyList<PromptStateEntry>? stored)
    {
        if (stored is null) return;
        foreach (var entry in stored)
        {
            if (!entries.TryGetValue(entry.Id, out var target)) continue;
            target.Versions.Clear();
            target.Versions.AddRange(entry.Versions.Select(version => new PromptVersionDto(version.Version, version.Content, version.CreatedAt, version.SourceVersion)));
            target.Published.Clear();
            target.Published.AddRange(entry.Published.Select(published => new PromptPublishedDto(published.Version, published.Content, published.PublishedFrom, published.PublishedAt, ApprovalReference: published.ApprovalReference, ApprovedBy: published.ApprovedBy)));
        }
    }

    public IReadOnlyList<PromptDto> List()
    {
        lock (gate) return entries.Values.Select(Snapshot).ToArray();
    }

    public PromptDto? Get(string id)
    {
        lock (gate) return entries.TryGetValue(id, out var entry) ? Snapshot(entry) : null;
    }

    public PromptMutationResult AddVersion(string id, PromptVersionRequest request)
    {
        lock (gate)
        {
            if (!entries.TryGetValue(id, out var entry)) return new(null, 404, "prompt_not_found");
            var errors = ValidateContent(request.Content, entry.Schema);
            if (request.ExpectedVersion < 1) errors["expectedVersion"] = ["A positive expectedVersion is required."];
            if (errors.Count != 0) return new(null, 400, "validation_failed", errors);
            return Append(entry, request.Content!, request.ExpectedVersion, null);
        }
    }

    public PromptMutationResult Restore(string id, PromptRestoreRequest request)
    {
        lock (gate)
        {
            if (!entries.TryGetValue(id, out var entry)) return new(null, 404, "prompt_not_found");
            var errors = new Dictionary<string, string[]>();
            if (request.ExpectedVersion < 1) errors["expectedVersion"] = ["A positive expectedVersion is required."];
            if (request.SourceVersion < 1) errors["sourceVersion"] = ["A positive sourceVersion is required."];
            if (errors.Count != 0) return new(null, 400, "validation_failed", errors);
            if (request.ExpectedVersion != entry.Versions[^1].Version) return new(null, 409, "version_conflict");
            var source = entry.Versions.Find(v => v.Version == request.SourceVersion);
            if (source is null) return new(null, 404, "source_version_not_found");
            return Append(entry, source.Content, request.ExpectedVersion, source.Version);
        }
    }

    public PromptMutationResult Publish(string id, int expectedVersion) => Publish(id, new PromptPublishRequest(expectedVersion, "approval://prompt/demo/1", "演示审批人"));
    public PromptMutationResult Publish(string id, PromptPublishRequest request)
    {
        lock (gate)
        {
            if (!entries.TryGetValue(id, out var entry)) return new(null, 404, "prompt_not_found");
            var expectedVersion = request.ExpectedVersion;
            var errors = new Dictionary<string, string[]>();
            if (expectedVersion < 1) errors["expectedVersion"] = ["A positive expectedVersion is required."];
            // Publishing requires an approval record; the shape is checked here, the decision is out of scope.
            if (!ApprovalPattern().IsMatch(request.ApprovalReference ?? string.Empty)) errors["approvalReference"] = ["Approval reference must look like approval://prompt/<id>/<number>."];
            if (string.IsNullOrWhiteSpace(request.ApprovedBy) || request.ApprovedBy.Trim().Length > 64 || request.ApprovedBy.Any(char.IsControl)) errors["approvedBy"] = ["Approver name must be 1–64 characters without control characters."];
            if (errors.Count != 0) return new(null, 400, "validation_failed", errors);
            var current = entry.Versions[^1].Version;
            if (expectedVersion != current) return new(null, 409, "version_conflict");
            // One immutable published revision per draft version; repeats are rejected, not duplicated.
            if (entry.Published.Any(item => item.PublishedFrom == expectedVersion)) return new(null, 409, "already_published");
            // One approval reference may authorise exactly one publish, in this prompt or any other.
            if (entries.Values.SelectMany(candidate => candidate.Published).Any(item => item.ApprovalReference == request.ApprovalReference)) return new(null, 409, "approval_reference_reused");
            entry.Published.Add(new(entry.Published.Count + 1, entry.Versions[^1].Content, expectedVersion, DateTimeOffset.UtcNow, ApprovalReference: request.ApprovalReference, ApprovedBy: request.ApprovedBy!.Trim()));
            Persist();
            return new(Snapshot(entry), 201);
        }
    }

    // Feature binding view: which revision a feature would currently resolve to, without executing anything.
    public IReadOnlyList<PromptBindingDto> Bindings()
    {
        lock (gate) return entries.Values.Select(entry =>
        {
            var latest = entry.Versions[^1];
            var published = entry.Published.Count == 0 ? null : entry.Published[^1];
            var status = published is null ? "unpublished"
                : published.PublishedFrom == latest.Version ? "published-current" : "draft-ahead";
            return new PromptBindingDto(entry.Feature, entry.Id, entry.Name, latest.Version,
                published?.Version ?? 0, published?.PublishedFrom ?? 0, status);
        }).OrderBy(item => item.Feature, StringComparer.Ordinal).ToArray();
    }

    private PromptMutationResult Append(Entry entry, string content, int expectedVersion, int? sourceVersion)
    {
        if (expectedVersion != entry.Versions[^1].Version) return new(null, 409, "version_conflict");
        // Reject instead of silently losing history. Both editing and restore consume one slot.
        if (entry.Versions.Count >= MaxVersions) return new(null, 409, "version_limit_reached");
        entry.Versions.Add(new(expectedVersion + 1, content, DateTimeOffset.UtcNow, sourceVersion));
        Persist();
        return new(Snapshot(entry), 201);
    }

    private static Dictionary<string, string[]> ValidateContent(string? content, PromptVariableDto[] schema)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(content) || content.Length > MaxContentLength)
        {
            errors["content"] = [$"Content must be nonblank and at most {MaxContentLength} characters."];
            return errors;
        }
        var allowed = schema.Select(v => v.Name).ToHashSet(StringComparer.Ordinal);
        var matches = VariablePattern().Matches(content);
        var remainder = VariablePattern().Replace(content, "");
        if (matches.Any(m => !allowed.Contains(m.Groups[1].Value))
            || remainder.Contains("{{", StringComparison.Ordinal) || remainder.Contains("}}", StringComparison.Ordinal)
            || content.Contains("{{{", StringComparison.Ordinal) || content.Contains("}}}", StringComparison.Ordinal))
            errors["content"] = ["Only case-sensitive {{ variable }} placeholders from this feature's schema are allowed; malformed double/triple braces and unknown variables are rejected. Single braces are literal text."];
        // Server-side backstop: prompt text must not carry credential-shaped content either.
        else if (SensitiveContent.Contains(content))
            errors["content"] = ["Prompt content must not contain credential-shaped content."];
        return errors;
    }

    // Called with the gate held: only content state is written, never schemas or samples.
    private void Persist()
    {
        if (state is null) return;
        state.Save(entries.Values.Select(entry => new PromptStateEntry(entry.Id,
            entry.Versions.Select(version => new PromptStateVersion(version.Version, version.Content, version.CreatedAt, version.SourceVersion)).ToArray(),
            entry.Published.Select(published => new PromptStatePublished(published.Version, published.Content, published.PublishedFrom, published.PublishedAt, published.ApprovalReference, published.ApprovedBy)).ToArray())).ToArray());
    }
    private static PromptDto Snapshot(Entry entry)
    {
        var latest = entry.Versions[^1];
        return new(entry.Id, entry.Feature, entry.Name, latest.Version, latest.Content,
            entry.Schema.Select(v => v.Name).ToArray(), entry.Schema.ToArray(),
            entry.Versions.AsEnumerable().Reverse().ToArray(), MaxVersions, MaxContentLength,
            Published: entry.Published.AsEnumerable().Reverse().ToArray(),
            PublishedVersion: entry.Published.Count == 0 ? 0 : entry.Published[^1].Version);
    }

    // Feature coverage compares the feature registry with prompt ownership; gaps are reported, never filled in.
    public PromptFeatureCoverage FeatureCoverage()
    {
        PromptDto[] prompts;
        lock (gate) prompts = entries.Values.Select(Snapshot).ToArray();
        var registered = PromptFeatureRegistry.List();
        var bound = new List<PromptFeatureCoverageItem>();
        var unbound = new List<PromptFeatureCoverageItem>();
        foreach (var feature in registered)
        {
            var owned = prompts.Where(prompt => string.Equals(prompt.Feature, feature.Key, StringComparison.Ordinal))
                .Select(prompt => prompt.Id).OrderBy(id => id, StringComparer.Ordinal).ToArray();
            var item = new PromptFeatureCoverageItem(feature.Key, feature.Label, owned);
            (owned.Length == 0 ? unbound : bound).Add(item);
        }
        var keys = registered.Select(feature => feature.Key).ToHashSet(StringComparer.Ordinal);
        var orphans = prompts.Where(prompt => !keys.Contains(prompt.Feature)).Select(prompt => prompt.Id)
            .OrderBy(id => id, StringComparer.Ordinal).ToArray();
        return new(bound, unbound, orphans);
    }

    // Match ECMAScript whitespace explicitly: .NET \s additionally accepts U+0085 and omits U+FEFF.
    // Required schema flags constrain samples, not which variables a template must reference.
    [GeneratedRegex(@"\Aapproval://prompt/[a-z0-9-]{1,64}/[1-9][0-9]{0,5}\z", RegexOptions.CultureInvariant)]
    private static partial Regex ApprovalPattern();
    [GeneratedRegex(@"\{\{[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*([A-Za-z_][A-Za-z0-9_]*)[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\}\}", RegexOptions.CultureInvariant)]
    private static partial Regex VariablePattern();

    private sealed record Entry(string Id, string Feature, string Name, PromptVariableDto[] Schema,
        List<PromptVersionDto> Versions, List<PromptPublishedDto> Published);
}
