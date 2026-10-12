using OpsPlatform.Api.Security;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class ExecutionPreflightTests
{
    private static readonly DateTimeOffset Now=new(2026,10,10,0,0,0,TimeSpan.Zero);
    private static AuthorizationContext Actor=>new("operator",OperationsRole.Operator,["site-a"]);
    private static ExecutionSnapshot Snapshot=>new("site-a","requester",new("asset-a",1,"inspect",new Dictionary<string,string>{{"scope","demo"}}));
    private static ApprovalEvidence Approval=>new("asset-a",1,OperationDigest.Compute(Snapshot.Draft),"requester","approver",Now.AddMinutes(-1),Now.AddMinutes(5),false,false);
    [Fact] public void EligibleSnapshotNeverExecutesOrConsumes()
    {var result=ExecutionPreflight.Evaluate(Actor,Snapshot,Approval,Now);Assert.True(result.EligibleSnapshot);Assert.False(result.ExecutionEnabled);Assert.False(result.ApprovalConsumed);}
    [Fact] public void RoleAndScopeAreNotBypassedByValidApproval()
    {Assert.False(ExecutionPreflight.Evaluate(Actor with{Role=OperationsRole.Viewer},Snapshot,Approval,Now).EligibleSnapshot);Assert.False(ExecutionPreflight.Evaluate(Actor,Snapshot with{SiteId="site-b"},Approval,Now).EligibleSnapshot);}
    [Fact] public void ChangedParametersInvalidateApprovalWithoutCallerProvidedDigest()
    {var changed=Snapshot with{Draft=Snapshot.Draft with{Parameters=new Dictionary<string,string>{{"scope","changed"}}}};Assert.False(ExecutionPreflight.Evaluate(Actor,changed,Approval,Now).EligibleSnapshot);}
    [Fact] public void RevokedConsumedExpiredAndSelfApprovalAreRejected()
    {foreach(var approval in new[]{Approval with{Revoked=true},Approval with{Consumed=true},Approval with{ExpiresAt=Now},Approval with{ApprovedBy="requester"}}) Assert.False(ExecutionPreflight.Evaluate(Actor,Snapshot,approval,Now).EligibleSnapshot);}
    [Fact] public void MissingAndInvalidInputsFailClosed()
    {Assert.False(ExecutionPreflight.Evaluate(null,Snapshot,Approval,Now).EligibleSnapshot);Assert.False(ExecutionPreflight.Evaluate(Actor,null,Approval,Now).EligibleSnapshot);Assert.False(ExecutionPreflight.Evaluate(Actor,Snapshot,null,Now).EligibleSnapshot);Assert.False(ExecutionPreflight.Evaluate(Actor,Snapshot with{Draft=Snapshot.Draft with{ResourceVersion=0}},Approval,Now).EligibleSnapshot);}
}
