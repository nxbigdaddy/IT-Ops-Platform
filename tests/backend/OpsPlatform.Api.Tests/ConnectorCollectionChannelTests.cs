using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Configuration;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class ConnectorCollectionChannelTests
{
    [Fact] public void EveryMatrixRowIsCoveredAndNothingIsClaimedAsImplemented()
    {
        var catalog = ConnectorCollectionChannels.List();
        Assert.False(catalog.Implemented);Assert.False(catalog.LiveVerified);Assert.False(catalog.WriteEnabled);
        Assert.False(string.IsNullOrWhiteSpace(catalog.Notes));
        var covered = catalog.Channels.SelectMany(channel => channel.CoversMatrixRows).ToHashSet(StringComparer.Ordinal);
        // Coverage is exact: every declared row is covered, and no channel invents a row that the matrix lacks.
        Assert.Equal(ConnectorCollectionChannels.MatrixRows.OrderBy(row => row, StringComparer.Ordinal), covered.OrderBy(row => row, StringComparer.Ordinal));
        Assert.All(catalog.Channels, channel =>
        {
            Assert.False(string.IsNullOrWhiteSpace(channel.Id));
            Assert.False(string.IsNullOrWhiteSpace(channel.Label));
            Assert.False(string.IsNullOrWhiteSpace(channel.Deployment));
            Assert.NotEmpty(channel.Prerequisites);
            Assert.All(channel.Prerequisites, prerequisite => Assert.False(string.IsNullOrWhiteSpace(prerequisite)));
            Assert.NotEmpty(channel.CoversMatrixRows);
            Assert.Contains(channel.Status, new[] { "planned", "manual-only" });
        });
        Assert.Equal(catalog.Channels.Count, catalog.Channels.Select(channel => channel.Id).Distinct(StringComparer.Ordinal).Count());
        // Only the manual channel may avoid an agent, and every automated channel must name a credential reference.
        Assert.All(catalog.Channels.Where(channel => channel.Status == "planned"), channel =>
            Assert.Contains(channel.Prerequisites, prerequisite => prerequisite.Contains("引用", StringComparison.Ordinal)));
        Assert.Equal(["manual-registry"], catalog.Channels.Where(channel => channel.Status == "manual-only").Select(channel => channel.Id).ToArray());
        Assert.Equal(["agentless-snmp", "worker-linux-ssh", "worker-windows", "vendor-read-api", "restricted-sql", "manual-registry"], catalog.Channels.Select(channel => channel.Id).ToArray());
        // Every protocol a registered candidate declares must be carried by at least one channel, and no channel
        // may invent a protocol the registry does not use. This is the drift check between the two catalogs.
        var registryProtocols = OpsPlatform.Api.Configuration.ConnectorRegistry.List()
            .SelectMany(candidate => candidate.Protocols).ToHashSet(StringComparer.Ordinal);
        var channelProtocols = catalog.Channels.SelectMany(channel => channel.Protocols).ToHashSet(StringComparer.Ordinal);
        Assert.All(catalog.Channels, channel =>
        {
            Assert.NotEmpty(channel.Protocols);
            Assert.All(channel.Protocols, protocol => Assert.Contains(protocol, registryProtocols));
        });
        Assert.Empty(registryProtocols.Except(channelProtocols, StringComparer.Ordinal));
        Assert.Equal(registryProtocols.OrderBy(value => value, StringComparer.Ordinal), channelProtocols.OrderBy(value => value, StringComparer.Ordinal));
    }
    [Fact] public void EveryCandidateProtocolHasAChannel()
    {
        var catalog = ConnectorCollectionChannels.List();
        // A candidate may spread its protocols across channels (for example printer SNMP plus Windows Worker),
        // so the check is per protocol, not per candidate.
        foreach (var candidate in OpsPlatform.Api.Configuration.ConnectorRegistry.List())
            foreach (var protocol in candidate.Protocols)
                Assert.Contains(catalog.Channels, channel => channel.Protocols.Contains(protocol, StringComparer.Ordinal));
    }
    [Fact] public async Task RouteIsGatedAndReadOnly()
    {
        await using var app = AppBootstrap.Build([], builder =>
        {
            builder.Environment.EnvironmentName = "Development";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Demo:Enabled"] = "true" });
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();using var client = app.GetTestClient();
        var response = await client.GetAsync("/api/v1/connector-collection-channels");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());
        Assert.True(body.GetProperty("isDemo").GetBoolean());Assert.Equal("none", body.GetProperty("persistence").GetString());
        var data = body.GetProperty("data");
        Assert.False(data.GetProperty("implemented").GetBoolean());Assert.False(data.GetProperty("liveVerified").GetBoolean());Assert.False(data.GetProperty("writeEnabled").GetBoolean());
        Assert.Equal(6, data.GetProperty("channels").GetArrayLength());
        // The route must not echo any address or credential-shaped text.
        var raw = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("://", raw.Replace("https://tools.ietf.org", string.Empty, StringComparison.Ordinal));
        using var foreign = new HttpRequestMessage(HttpMethod.Get, "/api/v1/connector-collection-channels");
        foreign.Headers.Add("Origin", "https://foreign.example.invalid");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(foreign)).StatusCode);
        await using var production = AppBootstrap.Build([], builder =>
        {
            builder.Environment.EnvironmentName = "Production";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Demo:Enabled"] = "false" });
            builder.WebHost.UseTestServer();
        });
        await production.StartAsync();
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await production.GetTestClient().GetAsync("/api/v1/connector-collection-channels")).StatusCode);
    }
}
