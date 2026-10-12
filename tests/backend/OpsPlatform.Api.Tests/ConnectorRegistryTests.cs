using OpsPlatform.Api.Configuration;
using OpsPlatform.Api.Services;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class ConnectorRegistryTests
{
    [Fact] public void UniqueCandidatesNeverClaimWorkingConnections()
    {
        var list=ConnectorRegistry.List();Assert.Equal(10,list.Count);Assert.Equal(list.Count,list.Select(x=>x.Id).Distinct().Count());
        Assert.All(list,c=>{Assert.Equal("planned",c.Status);Assert.False(c.Implemented);Assert.False(c.LiveVerified);Assert.False(c.WriteEnabled);Assert.NotEmpty(c.Protocols);Assert.NotEmpty(c.TargetFamilies);Assert.NotEmpty(c.PlannedReadCapabilities);Assert.Contains("candidates only",c.Evidence);});
    }
    [Theory] [InlineData("demo-snmp")] [InlineData("demo-directory")] [InlineData("demo-endpoint")] [InlineData("demo-virtualization")] [InlineData("demo-backup")]
    public void LegacyIdsRemainStable(string id)=>Assert.NotNull(ConnectorRegistry.Find(id));
    [Fact] public void TargetDatabaseMonitoringIsNotPlatformStorage()
    {Assert.Equal("DatabaseTarget",ConnectorRegistry.Find("demo-db-monitor")!.Category);Assert.Equal(4,DatabaseCapabilities.List().Count);}
    [Fact] public void UnknownAndCommandLikeIdsHaveNoFallback()
    {Assert.Null(ConnectorRegistry.Find("unknown"));Assert.Null(ConnectorRegistry.Find(";shutdown"));}
    [Fact] public void ApiProjectionAndSnapshotsAreIsolated()
    {
        var original=ConnectorRegistry.List();original[0].Protocols[0]="tampered";Assert.DoesNotContain("tampered",ConnectorRegistry.List()[0].Protocols);
        var api=new DemoCatalogService().Connectors;Assert.Equal(10,api.Count);Assert.All(api,c=>{Assert.False(c.OutboundEnabled);Assert.False(c.Verified);Assert.False(c.Implemented);});
    }
}
