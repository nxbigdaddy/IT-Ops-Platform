using OpsPlatform.Api.Security;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class ApprovalBindingTests
{
    private static readonly DateTimeOffset Now=new(2026,10,10,0,0,0,TimeSpan.Zero);
    private static PendingChange Change=>new("demo-resource",1,new string('a',64),"demo-requester");
    private static ApprovalEvidence Evidence=>new(Change.ResourceId,1,Change.ActionDigest,Change.RequestedBy,"demo-approver",Now.AddMinutes(-1),Now.AddMinutes(10),false,false);
    [Fact] public void ValidSnapshotDoesNotEnableExecution()
    {var result=ApprovalBinding.Validate(Evidence,Change,Now);Assert.True(result.Valid);Assert.False(result.ExecutionEnabled);}
    [Fact] public void ResourceVersionDigestAndRequesterMustMatch()
    {
        foreach(var change in new[]{Change with{ResourceId="other"},Change with{ResourceVersion=2},Change with{ActionDigest=new string('b',64)},Change with{RequestedBy="other"}})
            Assert.False(ApprovalBinding.Validate(Evidence,change,Now).Valid);
    }
    [Fact] public void ExpirationBoundaryAndFutureApprovalRejected()
    {
        Assert.False(ApprovalBinding.Validate(Evidence with{ExpiresAt=Now},Change,Now).Valid);
        Assert.False(ApprovalBinding.Validate(Evidence with{ApprovedAt=Now.AddSeconds(1)},Change,Now).Valid);
        Assert.True(ApprovalBinding.Validate(Evidence with{ExpiresAt=Now.AddTicks(1)},Change,Now).Valid);
    }
    [Fact] public void RevocationConsumptionAndSelfApprovalFailClosed()
    {
        Assert.False(ApprovalBinding.Validate(Evidence with{Revoked=true},Change,Now).Valid);
        Assert.False(ApprovalBinding.Validate(Evidence with{Consumed=true},Change,Now).Valid);
        Assert.False(ApprovalBinding.Validate(Evidence with{ApprovedBy=Change.RequestedBy},Change,Now).Valid);
    }
    [Theory] [InlineData("")] [InlineData("abc")] [InlineData("INVALID-DIGEST")]
    public void InvalidDigestRejected(string digest)=>Assert.False(ApprovalBinding.Validate(Evidence,Change with{ActionDigest=digest},Now).Valid);
    [Fact] public void MissingEvidenceOrChangeDenied()
    {Assert.False(ApprovalBinding.Validate(null,Change,Now).Valid);Assert.False(ApprovalBinding.Validate(Evidence,null,Now).Valid);}
}
