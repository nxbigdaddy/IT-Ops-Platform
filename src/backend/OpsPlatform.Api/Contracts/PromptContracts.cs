namespace OpsPlatform.Api.Contracts;

public sealed record PromptVersionRequest(string? Content, int ExpectedVersion);
public sealed record PromptRestoreRequest(int SourceVersion, int ExpectedVersion);
// Publishing must carry an approval record. The reference is a synthetic pointer; without authentication this is a
// process check, not a security control, and it never stands in for a real approval system.
public sealed record PromptPublishRequest(int ExpectedVersion, string? ApprovalReference = null, string? ApprovedBy = null);
// Binding status only: it never enables model execution or implies approval.
public sealed record PromptBindingDto(string Feature, string PromptId, string Name, int CurrentVersion,
    int PublishedVersion, int PublishedFrom, string BindingStatus)
{
    public bool ModelExecutionEnabled => false;
    public string Notes => "绑定状态仅描述草稿与发布修订的关系；未实现审批、发布生效或模型调用。";
}
public sealed record PromptVariableDto(string Name, string Type, string Description, string Example, bool Required = false);
public sealed record PromptVersionDto(int Version, string Content, DateTimeOffset CreatedAt,
    int? SourceVersion = null, string Status = "draft");
// Append-only published revision. Publishing copies the draft; it never rewrites drafts or history.
public sealed record PromptPublishedDto(int Version, string Content, int PublishedFrom, DateTimeOffset PublishedAt,
    string Status = "published", string? ApprovalReference = null, string? ApprovedBy = null);
public sealed record PromptDto(string Id, string Feature, string Name, int CurrentVersion,
    string Content, IReadOnlyList<string> Variables, IReadOnlyList<PromptVariableDto> Schema,
    IReadOnlyList<PromptVersionDto> Versions, int MaxVersions, int MaxContentLength,
    string Status = "draft", bool ModelExecutionEnabled = false,
    string Notes = "仅开发演示草稿；内存数据重启丢失。未实现审批、发布、模型调用或生产持久化。",
    IReadOnlyList<PromptPublishedDto>? Published = null, int PublishedVersion = 0);
public sealed record PromptMutationResult(PromptDto? Data, int StatusCode,
    string? Code = null, Dictionary<string, string[]>? Errors = null);
