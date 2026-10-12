using OpsPlatform.Api.Contracts;

namespace OpsPlatform.Api.Services;

// Planned product features that are expected to own a prompt. Planning data only: a feature listed here
// may intentionally have no prompt yet, and that gap is reported instead of hidden.
public sealed record PromptFeature(string Key, string Label, string Notes);
public sealed record PromptFeatureCoverageItem(string Feature, string Label, string[] PromptIds);
public sealed record PromptFeatureCoverage(IReadOnlyList<PromptFeatureCoverageItem> Bound,
    IReadOnlyList<PromptFeatureCoverageItem> Unbound, IReadOnlyList<string> OrphanPrompts)
{
    public bool ModelExecutionEnabled => false;
    public bool ProductionEnabled => false;
    public string Notes => "覆盖核对只比较功能登记与提示词归属；未实现审批、发布生效或模型调用。";
}
public static class PromptFeatureRegistry
{
    public static IReadOnlyList<PromptFeature> List() =>
    [
        new("alerts","告警解释","把已知告警信息解释为事实与假设，不执行操作。"),
        new("tickets","工单摘要","总结工单已知信息与待人工确认项。"),
        new("inspection","巡检报告","依据巡检观察结果生成摘要并标注缺失数据。"),
        new("knowledge-search","知识检索问答","计划中的知识库问答功能，尚未登记提示词。"),
        new("change-summary","变更摘要","计划中的变更单摘要功能，尚未登记提示词。"),
    ];
}
