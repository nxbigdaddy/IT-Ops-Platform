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
public sealed class PromptBindingTests
{
    private static async Task<WebApplication> Start(string environment="Development",bool demo=true)
    {
        var app=AppBootstrap.Build([],builder=>
        {
            builder.Environment.EnvironmentName=environment;
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string,string?>{{"Demo:Enabled",demo.ToString()}});
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();return app;
    }
    [Fact] public void BindingStatusTracksTheLatestPublishedRevisionOnly()
    {
        var service=new PromptService();
        var initial=service.Bindings();
        Assert.Equal(3,initial.Count);Assert.Equal(initial.Select(item=>item.Feature).Distinct().Count(),initial.Count);
        Assert.All(initial,item=>Assert.Equal("unpublished",item.BindingStatus));
        Assert.All(initial,item=>Assert.Equal(0,item.PublishedVersion));Assert.All(initial,item=>Assert.False(item.ModelExecutionEnabled));
        var target=initial.Single(item=>item.PromptId=="alert-explanation");
        Assert.Equal(1,target.CurrentVersion);Assert.False(string.IsNullOrWhiteSpace(target.Notes));
        var publishResult=service.Publish(target.PromptId, new PromptPublishRequest(1, "approval://prompt/demo/1", "演示审批人"));
        Assert.Equal(201,publishResult.StatusCode);        var published=service.Bindings().Single(item=>item.PromptId==target.PromptId);
        Assert.Equal("published-current",published.BindingStatus);Assert.Equal(1,published.PublishedVersion);Assert.Equal(1,published.PublishedFrom);
        // A newer draft makes the feature resolve to a revision that is no longer the latest draft.
        Assert.Equal(201,service.AddVersion(target.PromptId,new PromptVersionRequest("根据 {{asset_name}} 的 {{alert_summary}} 区分事实与假设；补充说明。",1)).StatusCode);
        var ahead=service.Bindings().Single(item=>item.PromptId==target.PromptId);
        Assert.Equal("draft-ahead",ahead.BindingStatus);Assert.Equal(1,ahead.PublishedVersion);Assert.Equal(2,ahead.CurrentVersion);
    }
    [Fact] public async Task BindingRouteIsDemoOnlyAndConsistentWithTheCatalog()
    {
        await using(var app=await Start())
        {
            using var client=app.GetTestClient();
            var prompts=await client.GetFromJsonAsync<JsonElement>("/api/v1/prompts");
            var bindings=await client.GetFromJsonAsync<JsonElement>("/api/v1/prompt-bindings");
            Assert.Equal("memory",bindings.GetProperty("persistence").GetString());
            var ids=prompts.GetProperty("data").EnumerateArray().Select(item=>item.GetProperty("id").GetString()).OrderBy(value=>value).ToArray();
            var bound=bindings.GetProperty("data").EnumerateArray().Select(item=>item.GetProperty("promptId").GetString()).OrderBy(value=>value).ToArray();
            Assert.Equal(ids,bound);
            foreach(var item in bindings.GetProperty("data").EnumerateArray())
            {
                Assert.Contains(item.GetProperty("bindingStatus").GetString(),new[]{"unpublished","published-current","draft-ahead"});
                Assert.False(item.GetProperty("modelExecutionEnabled").GetBoolean());
                Assert.True(item.GetProperty("currentVersion").GetInt32()>=1);
            }
            using var foreign=new HttpRequestMessage(HttpMethod.Get,"/api/v1/prompt-bindings");foreign.Headers.Add("Origin","https://foreign.example.invalid");
            Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(foreign)).StatusCode);
        }
        await using(var app=await Start("Production",false)){using var client=app.GetTestClient();Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.GetAsync("/api/v1/prompt-bindings")).StatusCode);}
    }
}
