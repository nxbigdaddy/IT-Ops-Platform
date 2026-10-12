namespace OpsPlatform.Api.Security;

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record ApprovalDraft([property: System.Text.Json.Serialization.JsonRequired] string? Scenario);

public sealed record ApprovalScenario(string Id, string Label, string Description, bool Valid, string Code, IReadOnlyList<ApprovalRule> Rules)
{
    // Evaluating the rules never authorises a change, in any scenario.
    public bool ExecutionEnabled => false;
    public bool ProductionEnabled => false;
}
// Synthetic fixtures only. Every verdict below is produced by running ApprovalBinding on fixed demo inputs.
public static class ApprovalScenarios
{
    public const string ResourceId = "demo-resource";
    public const string Requester = "demo-requester";
    public const string Approver = "demo-approver";
    private const string DigestA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private const string DigestB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private static readonly DateTimeOffset Now = new(2026, 10, 10, 9, 0, 0, TimeSpan.Zero);
    private static PendingChange Change(int version = 1, string digest = DigestA) => new(ResourceId, version, digest, Requester);
    private static ApprovalEvidence Evidence(int version = 1, string digest = DigestA, bool revoked = false, bool consumed = false,
        string? approvedBy = Approver, int approvedOffsetMinutes = -5, int expiresOffsetMinutes = 25) =>
        new(ResourceId, version, digest, Requester, approvedBy ?? string.Empty, Now.AddMinutes(approvedOffsetMinutes),
            Now.AddMinutes(expiresOffsetMinutes), revoked, consumed);
    public static IReadOnlyList<ApprovalScenario> List()
    {
        (string Id, string Label, string Description, ApprovalEvidence? Evidence, PendingChange? Change)[] cases =
        [
            ("valid", "有效审批快照", "所有人、时间与绑定均匹配；仅表示快照自洽。", Evidence(), Change()),
            ("missing", "缺少审批", "没有审批证据时直接拒绝。", null, Change()),
            ("revoked", "审批已撤销", "撤销后的审批不得再使用。", Evidence(revoked: true), Change()),
            ("consumed", "审批已使用", "同一份审批不能被重复消费。", Evidence(consumed: true), Change()),
            ("self-approval", "申请人自批", "审批人必须与申请人不同。", Evidence(approvedBy: Requester), Change()),
            ("digest-mismatch", "动作摘要不符", "审批绑定的动作摘要与当前变更不一致。", Evidence(), Change(digest: DigestB)),
            ("version-mismatch", "资源版本不符", "审批针对的资源版本与当前变更不一致。", Evidence(version: 2), Change()),
            ("expired", "审批已过期", "超过有效期后审批失效。", Evidence(expiresOffsetMinutes: -1), Change()),
            ("not-yet-valid", "审批时间在未来", "生效时间晚于当前时间的审批无效。", Evidence(approvedOffsetMinutes: 5), Change()),
            ("malformed-change", "变更本身不合法", "资源标识、版本或摘要不合法时先拒绝变更。", Evidence(), new PendingChange("", 0, "not-a-digest", Requester)),
        ];
        return cases.Select(item =>
        {
            var diagnosis = ApprovalBinding.Diagnose(item.Evidence, item.Change, Now);
            return new ApprovalScenario(item.Id, item.Label, item.Description, diagnosis.Valid, diagnosis.Code, diagnosis.Rules);
        }).ToArray();
    }
    public static ApprovalScenario? Find(string? id) => id is null ? null : List().FirstOrDefault(item => item.Id == id);
}
