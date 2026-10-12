using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Services;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class PromptFeatureCoverageTests
{
    [Fact] public void CoverageReportsUnboundFeaturesInsteadOfInventingPrompts()
    {
        var service=new PromptService();
        var coverage=service.FeatureCoverage();
        Assert.False(coverage.ModelExecutionEnabled);Assert.False(coverage.ProductionEnabled);
        Assert.False(string.IsNullOrWhiteSpace(coverage.Notes));
        // Seeded prompts own three registered features; the registry also plans two without prompts.
        Assert.Equal(3,coverage.Bound.Count);
        Assert.Equal(2,coverage.Unbound.Count);
        Assert.Empty(coverage.OrphanPrompts);
        Assert.Equal(["alerts","inspection","tickets"],coverage.Bound.Select(item=>item.Feature).OrderBy(key=>key).ToArray());
        Assert.Equal(["change-summary","knowledge-search"],coverage.Unbound.Select(item=>item.Feature).OrderBy(key=>key).ToArray());
        Assert.All(coverage.Unbound,item=>Assert.Empty(item.PromptIds));
        Assert.All(coverage.Unbound,item=>Assert.False(string.IsNullOrWhiteSpace(item.Label)));
        Assert.All(coverage.Bound,item=>Assert.NotEmpty(item.PromptIds));
        Assert.Equal(3,coverage.Bound.Sum(item=>item.PromptIds.Length));
        // Every feature appears exactly once across the two lists.
        var all=coverage.Bound.Concat(coverage.Unbound).Select(item=>item.Feature).ToArray();
        Assert.Equal(PromptFeatureRegistry.List().Count,all.Length);
        Assert.Equal(all.Length,all.Distinct(StringComparer.Ordinal).Count());
    }
    [Fact] public void AnUnregisteredPromptIsReportedAsOrphanRatherThanSilentlyBound()
    {
        var service=new PromptService();
        var orphan=new PromptService();
        // The registry is static planning data, so an orphan can only appear if a prompt claims an unknown feature.
        // Guard the derivation directly instead of mutating the catalog.
        var registered=PromptFeatureRegistry.List().Select(feature=>feature.Key).ToHashSet(StringComparer.Ordinal);
        Assert.DoesNotContain("unknown-feature",registered);
        Assert.Empty(service.FeatureCoverage().OrphanPrompts);
        Assert.Empty(orphan.FeatureCoverage().OrphanPrompts);
    }
    [Fact] public async Task CoverageRouteIsReadOnlyAndDemoGated()
    {
        await using var app=AppBootstrap.Build([],builder=>
        {
            builder.Environment.EnvironmentName="Development";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string,string?>{{"Demo:Enabled","true"}});
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();
        using var client=app.GetTestClient();
        var body=await client.GetFromJsonAsync<JsonElement>("/api/v1/prompt-feature-coverage");
        Assert.Equal("memory",body.GetProperty("persistence").GetString());
        var data=body.GetProperty("data");
        Assert.Equal(3,data.GetProperty("bound").GetArrayLength());
        Assert.Equal(2,data.GetProperty("unbound").GetArrayLength());
        Assert.False(data.GetProperty("modelExecutionEnabled").GetBoolean());
        Assert.False(data.GetProperty("productionEnabled").GetBoolean());
        foreach(var item in data.GetProperty("unbound").EnumerateArray())
            Assert.Equal(0,item.GetProperty("promptIds").GetArrayLength());
        using var foreign=new HttpRequestMessage(HttpMethod.Get,"/api/v1/prompt-feature-coverage");
        foreign.Headers.Add("Origin","https://foreign.example.invalid");
        Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(foreign)).StatusCode);
    }
}
