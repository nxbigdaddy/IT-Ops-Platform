namespace OpsPlatform.Api.Security;

public enum OperationsRole { Viewer, Operator, Approver, Administrator }
public enum OperationsAction { Read, EditDraft, ApproveChange, RequestExecution }
public sealed record AuthorizationContext(string ActorId, OperationsRole Role, string[] AllowedSiteIds);
public sealed record OperationResource(string SiteId, string RequestedBy, bool Approved, string? ApprovedBy);
public sealed record AuthorizationDecision(bool Allowed, string Code)
{
    // A decision is not an execution ticket or a substitute for authenticated middleware.
    public bool ExecutionEnabled => false;
}
public sealed record AuthorizationRule(string Name, bool Passed);
public sealed record AuthorizationDiagnosis(bool Allowed, string Code, IReadOnlyList<AuthorizationRule> Rules)
{
    public bool ExecutionEnabled => false;
}
public static class OperationAuthorization
{
    public static AuthorizationDecision Evaluate(AuthorizationContext? actor, OperationResource? resource, OperationsAction action)
    {
        var diagnosis = Diagnose(actor, resource, action);
        return new(diagnosis.Allowed, diagnosis.Code);
    }
    // Same rules with per-rule results; the first failing rule in evaluation order decides the code.
    public static AuthorizationDiagnosis Diagnose(AuthorizationContext? actor, OperationResource? resource, OperationsAction action)
    {
        static AuthorizationDiagnosis Deny(string code, params AuthorizationRule[] rules) => new(false, code, rules);
        if (actor is null || string.IsNullOrWhiteSpace(actor.ActorId))
            return Deny("identity_required", new AuthorizationRule("identityPresent", false));
        if (resource is null || string.IsNullOrWhiteSpace(resource.SiteId) || string.IsNullOrWhiteSpace(resource.RequestedBy))
            return Deny("resource_required", new AuthorizationRule("identityPresent", true), new AuthorizationRule("resourceWellFormed", false));
        if (!Enum.IsDefined(actor.Role) || !Enum.IsDefined(action))
            return Deny("unknown_permission", new AuthorizationRule("identityPresent", true), new AuthorizationRule("resourceWellFormed", true), new AuthorizationRule("knownPermission", false));
        var rules = new List<AuthorizationRule>
        {
            new("identityPresent", true),
            new("resourceWellFormed", true),
            new("knownPermission", true),
            // No wildcard, case folding, administrator bypass, or inferred site membership.
            new("siteScopeAllows", actor.AllowedSiteIds is not null && actor.AllowedSiteIds.Contains(resource.SiteId, StringComparer.Ordinal)),
        };
        if (!rules[^1].Passed) return new(false, "site_scope_denied", rules);
        var roleAllows = action switch
        {
            OperationsAction.Read => true,
            OperationsAction.EditDraft or OperationsAction.RequestExecution => actor.Role is OperationsRole.Operator or OperationsRole.Administrator,
            OperationsAction.ApproveChange => actor.Role is OperationsRole.Approver or OperationsRole.Administrator,
            _ => false,
        };
        rules.Add(new("roleAllowsAction", roleAllows));
        if (action is OperationsAction.Read) return new(true, "allowed", rules);
        if (!roleAllows) return new(false, "role_denied", rules);
        if (action is OperationsAction.EditDraft) return new(true, "allowed", rules);
        if (action is OperationsAction.ApproveChange)
        {
            var independent = actor.ActorId != resource.RequestedBy;
            rules.Add(new("independentApprover", independent));
            return independent ? new(true, "allowed", rules) : new(false, "self_approval_denied", rules);
        }
        var approved = resource.Approved && !string.IsNullOrWhiteSpace(resource.ApprovedBy) && resource.ApprovedBy != resource.RequestedBy;
        rules.Add(new("independentApproval", approved));
        return approved ? new(true, "allowed", rules) : new(false, "independent_approval_required", rules);
    }
}
