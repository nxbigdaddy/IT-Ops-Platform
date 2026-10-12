using OpsPlatform.Api.Security;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class OperationAuthorizationTests
{
    private static AuthorizationContext Actor(OperationsRole role)=>new("demo-actor",role,["demo-site"]);
    private static OperationResource Resource=>new("demo-site","demo-requester",false,null);
    [Theory] [InlineData(OperationsRole.Viewer)] [InlineData(OperationsRole.Operator)] [InlineData(OperationsRole.Approver)] [InlineData(OperationsRole.Administrator)]
    public void KnownRolesReadOnlyInsideTheirScope(OperationsRole role)
    {
        Assert.True(OperationAuthorization.Evaluate(Actor(role),Resource,OperationsAction.Read).Allowed);
        Assert.False(OperationAuthorization.Evaluate(Actor(role),Resource with{SiteId="other"},OperationsAction.Read).Allowed);
    }
    [Fact] public void ViewerCannotEditApproveOrExecute()
    {foreach(var action in new[]{OperationsAction.EditDraft,OperationsAction.ApproveChange,OperationsAction.RequestExecution}) Assert.False(OperationAuthorization.Evaluate(Actor(OperationsRole.Viewer),Resource,action).Allowed);}
    [Fact] public void OperatorCannotApproveAndApproverCannotEdit()
    {Assert.False(OperationAuthorization.Evaluate(Actor(OperationsRole.Operator),Resource,OperationsAction.ApproveChange).Allowed);Assert.False(OperationAuthorization.Evaluate(Actor(OperationsRole.Approver),Resource,OperationsAction.EditDraft).Allowed);}
    [Theory] [InlineData(OperationsRole.Administrator)] [InlineData(OperationsRole.Approver)]
    public void SelfApprovalDeniedEvenForAdministrator(OperationsRole role)
    {Assert.False(OperationAuthorization.Evaluate(Actor(role),Resource with{RequestedBy="demo-actor"},OperationsAction.ApproveChange).Allowed);Assert.True(OperationAuthorization.Evaluate(Actor(role),Resource,OperationsAction.ApproveChange).Allowed);}
    [Fact] public void ExecutionRequiresIndependentApprovalAndDoesNotEnableExecution()
    {
        var actor=Actor(OperationsRole.Operator);
        Assert.False(OperationAuthorization.Evaluate(actor,Resource,OperationsAction.RequestExecution).Allowed);
        Assert.False(OperationAuthorization.Evaluate(actor,Resource with{Approved=true,ApprovedBy="demo-requester"},OperationsAction.RequestExecution).Allowed);
        var result=OperationAuthorization.Evaluate(actor,Resource with{Approved=true,ApprovedBy="demo-reviewer"},OperationsAction.RequestExecution);
        Assert.True(result.Allowed);Assert.False(result.ExecutionEnabled);
    }
    [Fact] public void NullUnknownAndWildcardFailClosed()
    {
        Assert.False(OperationAuthorization.Evaluate(null,Resource,OperationsAction.Read).Allowed);
        Assert.False(OperationAuthorization.Evaluate(Actor(OperationsRole.Viewer),null,OperationsAction.Read).Allowed);
        Assert.False(OperationAuthorization.Evaluate(Actor((OperationsRole)99),Resource,OperationsAction.Read).Allowed);
        Assert.False(OperationAuthorization.Evaluate(Actor(OperationsRole.Administrator),Resource,(OperationsAction)99).Allowed);
        Assert.False(OperationAuthorization.Evaluate(Actor(OperationsRole.Administrator) with{AllowedSiteIds=["*"]},Resource,OperationsAction.Read).Allowed);
    }
}
