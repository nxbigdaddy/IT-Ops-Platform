using OpsPlatform.Api.Configuration;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class ConnectorReadIntentTests
{
    [Fact] public void AllRegisteredCandidatesAllowOnlyOfflineMembershipChecks()
    {
        foreach(var candidate in ConnectorRegistry.List())
        {
            var check=ConnectorReadIntent.Check(new(candidate.Id,candidate.Protocols[0],candidate.PlannedReadCapabilities,"secret://connector/demo"));
            Assert.True(check.ConfigurationValid);Assert.False(check.ConnectionAttempted);Assert.False(check.ExecutionAllowed);Assert.False(check.CompatibilityVerified);
        }
    }
    [Fact] public void MixedCandidateProtocolAndCapabilitiesAreRejected()
    {
        var result=ConnectorReadIntent.Check(new("demo-linux","SNMPv3",["interfaces"],"secret://connector/demo"));
        Assert.False(result.ConfigurationValid);Assert.Contains(result.Errors,e=>e.Field=="protocol"&&e.Code=="not_registered");Assert.Contains(result.Errors,e=>e.Field=="capabilities"&&e.Code=="not_registered");
    }
    [Fact] public void InvalidNamesCountsAndDuplicatesAreRejectedWithoutEcho()
    {
        Assert.False(ConnectorReadIntent.Check(null).ConfigurationValid);
        Assert.False(ConnectorReadIntent.Check(new("unknown","SSH allowlist",["disk"],"secret://connector/demo")).ConfigurationValid);
        Assert.False(ConnectorReadIntent.Check(new("demo-linux","SSH allowlist",[],"secret://connector/demo")).ConfigurationValid);
        Assert.False(ConnectorReadIntent.Check(new("demo-linux","SSH allowlist",Enumerable.Repeat("disk",17).ToArray(),"secret://connector/demo")).ConfigurationValid);
        Assert.Contains(ConnectorReadIntent.Check(new("demo-linux","SSH allowlist",["disk","disk"],"secret://connector/demo")).Errors,e=>e.Code=="duplicate");
        Assert.False(ConnectorReadIntent.Check(new("demo-linux","ssh allowlist",["disk"],"secret://connector/demo")).ConfigurationValid);
        Assert.False(ConnectorReadIntent.Check(new("demo-linux","SSH allowlist",[null!],"secret://connector/demo")).ConfigurationValid);
    }
}
