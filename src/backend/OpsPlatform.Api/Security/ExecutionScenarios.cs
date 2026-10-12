namespace OpsPlatform.Api.Security;

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record ExecutionDraft([property: System.Text.Json.Serialization.JsonRequired] string? Scenario);

public sealed record ExecutionStage(string Name, bool Passed);
public sealed record ExecutionScenario(string Id, string Label, string Description, bool Eligible, string Code,
    IReadOnlyList<ExecutionStage> Stages)
{
    // Even an eligible snapshot is not an execution ticket.
    public bool ExecutionEnabled => false;
    public bool ApprovalConsumed => false;
    public bool ProductionEnabled => false;
}
// Synthetic fixtures only. Verdicts come from ExecutionPreflight.Evaluate; stages show where it stopped.
public static class ExecutionScenarios
{
    private const string SiteA = "site-a";
    private const string SiteB = "site-b";
    private const string Requester = "demo-requester";
    private const string Other = "demo-other";
    private const string DigestA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private static readonly DateTimeOffset Now = new(2026, 10, 10, 9, 0, 0, TimeSpan.Zero);
    private static OperationDraft Draft(string action = "inspect", int version = 1) =>
        new("demo-target", version, action, new Dictionary<string, string>(StringComparer.Ordinal) { ["a"] = "one", ["b"] = "two" });
    private static ExecutionSnapshot Snapshot(string site = SiteA) => new(site, Requester, Draft());
    private static ApprovalEvidence Approval(string digest, string approvedBy = Other, bool revoked = false, bool consumed = false,
        int approvedOffsetMinutes = -5, int expiresOffsetMinutes = 25) =>
        new("demo-target", 1, digest, Requester, approvedBy, Now.AddMinutes(approvedOffsetMinutes), Now.AddMinutes(expiresOffsetMinutes), revoked, consumed);
    private static AuthorizationContext Actor(OperationsRole role = OperationsRole.Operator, string[]? sites = null) =>
        new("demo-operator", role, sites ?? [SiteA]);
    public static IReadOnlyList<ExecutionScenario> List()
    {
        var properDigest = OperationDigest.Compute(Draft());
        (string Id, string Label, string Description, AuthorizationContext? Actor, ExecutionSnapshot? Snapshot, ApprovalEvidence? Approval)[] cases =
        [
            ("all-gates-pass", "三道门禁全部通过", "授权、摘要重算与审批绑定都通过；仅表示快照自洽。", Actor(), Snapshot(), Approval(properDigest)),
            ("site-outside-scope", "站点越权", "第一道门禁即拒绝，后续不再评估。", Actor(sites: [SiteA]), Snapshot(SiteB), Approval(properDigest)),
            ("viewer-request", "观察者请求执行", "角色不允许请求执行。", Actor(OperationsRole.Viewer), Snapshot(), Approval(properDigest)),
            ("no-approval", "没有审批证据", "缺少审批时在执行授权处即被拒。", Actor(), Snapshot(), null),
            ("self-approved", "自批后请求执行", "批准人等于申请人时被拒。", Actor(), Snapshot(), Approval(properDigest, approvedBy: Requester)),
            ("approval-expired", "审批已过期", "授权通过但审批有效期已过。", Actor(), Snapshot(), Approval(properDigest, expiresOffsetMinutes: -1)),
            ("approval-revoked", "审批已撤销", "授权通过但审批已撤销。", Actor(), Snapshot(), Approval(properDigest, revoked: true)),
            ("approval-consumed", "审批已被使用", "同一份审批不能重复消费。", Actor(), Snapshot(), Approval(properDigest, consumed: true)),
            ("digest-mismatch", "审批摘要是另一套参数", "调用方传入的摘要与当前草稿重算结果不一致。", Actor(), Snapshot(), Approval(DigestA)),
            ("version-mismatch", "审批版本与草稿不符", "审批绑定的是另一个资源版本。", Actor(), Snapshot(), new ApprovalEvidence("demo-target", 2, properDigest, Requester, Other, Now.AddMinutes(-5), Now.AddMinutes(25), false, false)),
            ("malformed-draft", "草稿本身无法规范化", "资源标识不合法时摘要无法重算。", Actor(), new ExecutionSnapshot(SiteA, Requester, new OperationDraft("bad id", 1, "inspect", new Dictionary<string, string>())), Approval(properDigest)),
        ];
        return cases.Select(item =>
        {
            var result = ExecutionPreflight.Evaluate(item.Actor, item.Snapshot, item.Approval, Now);
            return new ExecutionScenario(item.Id, item.Label, item.Description, result.EligibleSnapshot, result.Code, Stages(item.Actor, item.Snapshot, item.Approval));
        }).ToArray();
    }
    // Stages mirror Evaluate's order; they never decide the code, which always comes from Evaluate itself.
    private static IReadOnlyList<ExecutionStage> Stages(AuthorizationContext? actor, ExecutionSnapshot? snapshot, ApprovalEvidence? approval)
    {
        if (snapshot is null) return [new("resourcePresent", false)];
        var permission = OperationAuthorization.Diagnose(actor,
            new(snapshot.SiteId, snapshot.RequestedBy, approval is not null, approval?.ApprovedBy), OperationsAction.RequestExecution);
        var stages = new List<ExecutionStage> { new("resourcePresent", true), new("authorization", permission.Allowed) };
        if (!permission.Allowed) return stages;
        string digest;
        try { digest = OperationDigest.Compute(snapshot.Draft); }
        catch (ArgumentException) { stages.Add(new("digestComputed", false)); return stages; }
        stages.Add(new("digestComputed", true));
        var binding = ApprovalBinding.Diagnose(approval, new(snapshot.Draft.ResourceId, snapshot.Draft.ResourceVersion, digest, snapshot.RequestedBy), Now);
        stages.Add(new("approvalBinding", binding.Valid));
        return stages;
    }
    public static ExecutionScenario? Find(string? id) => id is null ? null : List().FirstOrDefault(item => item.Id == id);
}
