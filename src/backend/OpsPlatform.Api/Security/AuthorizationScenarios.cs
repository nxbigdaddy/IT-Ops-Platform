namespace OpsPlatform.Api.Security;

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record AuthorizationDraft([property: System.Text.Json.Serialization.JsonRequired] string? Scenario);

public sealed record AuthorizationScenario(string Id, string Label, string Description, string Role, string Action,
    string SiteId, bool Allowed, string Code, IReadOnlyList<AuthorizationRule> Rules)
{
    // A scenario decision is never an execution ticket, in any combination.
    public bool ExecutionEnabled => false;
    public bool ProductionEnabled => false;
}
// Synthetic fixtures only; every verdict below is produced by running OperationAuthorization.
public static class AuthorizationScenarios
{
    private const string SiteA = "site-a";
    private const string SiteB = "site-b";
    private const string Requester = "demo-requester";
    private const string Other = "demo-other";
    private static AuthorizationContext Actor(string id, OperationsRole role, string[] sites) => new(id, role, sites);
    private static OperationResource Resource(string site, bool approved = false, string? approvedBy = null) =>
        new(site, Requester, approved, approvedBy ?? string.Empty);
    public static IReadOnlyList<AuthorizationScenario> List()
    {
        (string Id, string Label, string Description, AuthorizationContext? Actor, OperationResource? Resource, OperationsAction Action)[] cases =
        [
            ("viewer-read-in-scope", "观察者读取本站点", "只读且站点在范围内的最小权限。", Actor("demo-viewer", OperationsRole.Viewer, [SiteA]), Resource(SiteA), OperationsAction.Read),
            ("viewer-edit-denied", "观察者编辑草稿", "观察者不能编辑草稿。", Actor("demo-viewer", OperationsRole.Viewer, [SiteA]), Resource(SiteA), OperationsAction.EditDraft),
            ("operator-edit-allowed", "运维编辑本站点草稿", "运维可在授权站点编辑草稿。", Actor("demo-operator", OperationsRole.Operator, [SiteA]), Resource(SiteA), OperationsAction.EditDraft),
            ("site-outside-scope", "站点超出授权范围", "站点不在范围内时拒绝，管理员也没有旁路。", Actor("demo-admin", OperationsRole.Administrator, [SiteA]), Resource(SiteB), OperationsAction.Read),
            ("approver-approve-allowed", "审批人批准他人申请", "审批人可批准他人提交的变更。", Actor("demo-approver", OperationsRole.Approver, [SiteA]), Resource(SiteA), OperationsAction.ApproveChange),
            ("approver-self-approval", "审批人批准自己的申请", "禁止自批，即使角色允许审批。", Actor(Requester, OperationsRole.Approver, [SiteA]), Resource(SiteA), OperationsAction.ApproveChange),
            ("operator-approve-denied", "运维尝试审批", "审批需要审批人角色。", Actor("demo-operator", OperationsRole.Operator, [SiteA]), Resource(SiteA), OperationsAction.ApproveChange),
            ("request-without-approval", "未批准就请求执行", "执行请求必须有独立来源的批准。", Actor("demo-operator", OperationsRole.Operator, [SiteA]), Resource(SiteA), OperationsAction.RequestExecution),
            ("request-self-approved", "自批后请求执行", "批准人不能是申请人本人。", Actor("demo-operator", OperationsRole.Operator, [SiteA]), Resource(SiteA, true, Requester), OperationsAction.RequestExecution),
            ("request-approved-allowed", "已被他人批准后请求执行", "满足角色、站点与独立批准后可提交执行请求。", Actor("demo-operator", OperationsRole.Operator, [SiteA]), Resource(SiteA, true, Other), OperationsAction.RequestExecution),
            ("viewer-request-denied", "观察者请求执行", "观察者不能请求执行。", Actor("demo-viewer", OperationsRole.Viewer, [SiteA]), Resource(SiteA, true, Other), OperationsAction.RequestExecution),
            ("unknown-role", "未知角色", "枚举外的角色直接拒绝。", Actor("demo-unknown", (OperationsRole)99, [SiteA]), Resource(SiteA), OperationsAction.Read),
            ("missing-identity", "缺少身份", "没有身份标识时拒绝。", Actor(" ", OperationsRole.Operator, [SiteA]), Resource(SiteA), OperationsAction.Read),
            ("missing-resource", "缺少资源", "资源与站点缺失时拒绝。", Actor("demo-operator", OperationsRole.Operator, [SiteA]), null, OperationsAction.Read),
        ];
        return cases.Select(item =>
        {
            var diagnosis = OperationAuthorization.Diagnose(item.Actor, item.Resource, item.Action);
            return new AuthorizationScenario(item.Id, item.Label, item.Description, item.Actor?.Role.ToString() ?? "unknown",
                item.Action.ToString(), item.Resource?.SiteId ?? string.Empty, diagnosis.Allowed, diagnosis.Code, diagnosis.Rules);
        }).ToArray();
    }
    public static AuthorizationScenario? Find(string? id) => id is null ? null : List().FirstOrDefault(item => item.Id == id);
}
