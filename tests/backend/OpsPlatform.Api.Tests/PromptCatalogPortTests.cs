using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Services;
using Xunit;
namespace OpsPlatform.Api.Tests;
// A catalog double proves the read endpoints depend on the port, while writes still use the rule owner.
public sealed class FixedPromptCatalog : IPromptCatalog
{
    public List<string> Calls { get; }=[];
    public IReadOnlyList<PromptDto> List(){Calls.Add("list");return [Prompt()];}
    public PromptDto? Get(string id){Calls.Add($"get:{id}");return id=="demo-prompt"?Prompt():null;}
    public IReadOnlyList<PromptBindingDto> Bindings(){Calls.Add("bindings");return [new("demo-feature","demo-prompt","演示提示词",1,0,0,"unpublished")];}
    public PromptFeatureCoverage FeatureCoverage(){Calls.Add("coverage");return new([new("demo-feature","演示功能",["demo-prompt"])],[],[]);}
    private static PromptDto Prompt()=>new("demo-prompt","demo-feature","演示提示词",1,"仅演示内容",
        ["asset_name"],[new("asset_name","string","演示资产","演示主机",true)],
        [new(1,"仅演示内容",DateTimeOffset.Parse("2026-10-10T00:00:00+00:00"))],
        PromptService.MaxVersions,PromptService.MaxContentLength,
        PublishedVersion:0);
}
public sealed class PromptCatalogPortTests
{
    private static async Task<WebApplication> Start(FixedPromptCatalog catalog,string environment="Development",bool demo=true)
    {
        var app=AppBootstrap.Build([],builder=>
        {
            builder.Environment.EnvironmentName=environment;
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string,string?>{{"Demo:Enabled",demo.ToString()}});
            builder.WebHost.UseTestServer();
            builder.Services.AddSingleton<IPromptCatalog>(catalog);
        });
        await app.StartAsync();return app;
    }
    [Fact] public async Task ReadEndpointsUseTheCatalogPortWhileWritesKeepTheRuleOwner()
    {
        var catalog=new FixedPromptCatalog();
        await using var app=await Start(catalog);using var client=app.GetTestClient();
        var list=await client.GetFromJsonAsync<JsonElement>("/api/v1/prompts");
        Assert.Equal("demo-prompt",list.GetProperty("data")[0].GetProperty("id").GetString());
        Assert.Contains("list",catalog.Calls);
        var single=await client.GetFromJsonAsync<JsonElement>("/api/v1/prompts/demo-prompt");
        Assert.Equal("demo-prompt",single.GetProperty("data").GetProperty("id").GetString());
        Assert.Contains("get:demo-prompt",catalog.Calls);
        var bindings=await client.GetFromJsonAsync<JsonElement>("/api/v1/prompt-bindings");
        Assert.Equal("demo-feature",bindings.GetProperty("data")[0].GetProperty("feature").GetString());
        Assert.Contains("bindings",catalog.Calls);
        // An unknown id is a 404 from the port, not a fabricated prompt.
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync("/api/v1/prompts/other")).StatusCode);
        // Writes still go through the rule owner: the seeded real catalog, not the double.
        var write=await client.PostAsJsonAsync("/api/v1/prompts/alert-explanation/versions",new PromptVersionRequest("根据 {{asset_name}} 的 {{alert_summary}} 区分事实与假设；补充。",1));
        Assert.Equal(HttpStatusCode.Created,write.StatusCode);
        // The double is read-only, so its own state never reflects the write.
        var after=await client.GetFromJsonAsync<JsonElement>("/api/v1/prompts");
        Assert.Single(after.GetProperty("data").EnumerateArray());
    }
    [Fact] public async Task CatalogPortIsDemoGatedAndDefaultsToTheSeededCatalog()
    {
        await using(var app=await Start(new FixedPromptCatalog(),"Production",false))
        {
            using var client=app.GetTestClient();
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.GetAsync("/api/v1/prompts")).StatusCode);
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.GetAsync("/api/v1/prompt-bindings")).StatusCode);
        }
        // Without a substitute the default registration must still serve the seeded catalog.
        await using(var app=AppBootstrap.Build([],builder=>
        {
            builder.Environment.EnvironmentName="Development";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string,string?>{{"Demo:Enabled","true"}});
            builder.WebHost.UseTestServer();
        }))
        {
            await app.StartAsync();
            using var client=app.GetTestClient();
            var list=await client.GetFromJsonAsync<JsonElement>("/api/v1/prompts");
            Assert.Equal(3,list.GetProperty("data").GetArrayLength());
        }
    }
}
