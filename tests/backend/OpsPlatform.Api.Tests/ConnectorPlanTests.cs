using OpsPlatform.Api.Configuration;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class ConnectorPlanTests
{
    private static ConnectorPlanItem[] SelfCheck() => ConnectorRegistry.List()
        .Select(c=>new ConnectorPlanItem(c.Id,c.Protocols[0],c.PlannedReadCapabilities,$"secret://connector/{c.Id}")).ToArray();
    [Fact] public void RegistryDeclarationsAreSelfConsistent()
    {
        var result=ConnectorPlan.Check(new(SelfCheck()));
        Assert.True(result.ConfigurationValid);Assert.Equal(10,result.ValidItems);Assert.Equal(0,result.InvalidItems);Assert.Empty(result.Errors);
        Assert.False(result.ConnectionAttempted);Assert.False(result.ExecutionAllowed);Assert.False(result.CompatibilityVerified);
        Assert.Equal(Enumerable.Range(0,10),result.Items.Select(item=>item.Index));
    }
    [Fact] public void PerItemErrorsAreReportedWithoutFailingOthers()
    {
        var items=SelfCheck();items[3]=new("demo-linux","SNMPv3",["disk"],"secret://connector/demo-linux");items[5]=new("unknown-id","SNMPv3",["disk"],"secret://connector/demo-linux");
        var result=ConnectorPlan.Check(new(items));
        Assert.False(result.ConfigurationValid);Assert.Equal(8,result.ValidItems);Assert.Equal(2,result.InvalidItems);Assert.Empty(result.Errors);
        Assert.Contains(result.Items[3].Errors,error=>error.Field=="protocol"&&error.Code=="not_registered");
        Assert.Contains(result.Items[5].Errors,error=>error.Field=="connectorId"&&error.Code=="unknown_candidate");
        Assert.All(result.Items.Where(item=>item.Index!=3&&item.Index!=5),item=>Assert.True(item.ConfigurationValid));
    }
    [Fact] public void BoundsRejectEmptyOversizedAndMissingPlans()
    {
        Assert.Contains(ConnectorPlan.Check(null).Errors,error=>error.Code=="required");
        Assert.Contains(ConnectorPlan.Check(new((ConnectorPlanItem[]?)null)).Errors,error=>error.Code=="count_out_of_range");
        Assert.Contains(ConnectorPlan.Check(new([])).Errors,error=>error.Code=="count_out_of_range");
        var oversized=Enumerable.Range(0,ConnectorPlan.MaxItems+1).Select(_=>SelfCheck()[0]).ToArray();
        Assert.Contains(ConnectorPlan.Check(new(oversized)).Errors,error=>error.Code=="count_out_of_range");
        Assert.True(ConnectorPlan.Check(new(Enumerable.Range(0,ConnectorPlan.MaxItems).Select(_=>SelfCheck()[0]).ToArray())).ConfigurationValid);
        Assert.False(ConnectorPlan.Check(new([null!])).ConfigurationValid);
    }
}
