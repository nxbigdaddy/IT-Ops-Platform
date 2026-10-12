namespace OpsPlatform.Api.Security;

public sealed record ExecutionSnapshot(string SiteId, string RequestedBy, OperationDraft Draft);
public sealed record ExecutionPreflightResult(bool EligibleSnapshot, string Code)
{
    public bool ExecutionEnabled => false;
    public bool ApprovalConsumed => false;
}
public static class ExecutionPreflight
{
    // All arguments must be trusted server-side snapshots. No execution or persistence occurs.
    public static ExecutionPreflightResult Evaluate(AuthorizationContext? actor, ExecutionSnapshot? snapshot,
        ApprovalEvidence? approval, DateTimeOffset now)
    {
        if(snapshot is null) return new(false,"resource_required");
        var permission=OperationAuthorization.Evaluate(actor,new(snapshot.SiteId,snapshot.RequestedBy,
            approval is not null,approval?.ApprovedBy),OperationsAction.RequestExecution);
        if(!permission.Allowed) return new(false,permission.Code);
        string digest;
        try { digest=OperationDigest.Compute(snapshot.Draft); }
        catch(ArgumentException) { return new(false,"invalid_operation_draft"); }
        var binding=ApprovalBinding.Validate(approval,new(snapshot.Draft.ResourceId,snapshot.Draft.ResourceVersion,digest,snapshot.RequestedBy),now);
        return new(binding.Valid,binding.Code);
    }
}
