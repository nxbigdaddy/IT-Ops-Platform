using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Contracts;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class PromptPublishTests
{
    private static async Task<WebApplication> Start()
    {
        var app=AppBootstrap.Build([],builder=>
        {
            builder.Environment.EnvironmentName="Development";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string,string?>{{"Demo:Enabled","true"}});
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();return app;
    }
    [Fact] public async Task PublishingAppendsImmutableRevisionWithoutChangingDrafts()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var initial=await client.GetFromJsonAsync<JsonElement>("/api/v1/prompts/alert-explanation");
        Assert.Equal(0,initial.GetProperty("data").GetProperty("publishedVersion").GetInt32());
        Assert.Equal(0,initial.GetProperty("data").GetProperty("published").GetArrayLength());
        var published=await client.PostAsJsonAsync("/api/v1/prompts/alert-explanation/publish",new PromptPublishRequest(1, "approval://prompt/demo/1", "演示审批人"));
        Assert.Equal(HttpStatusCode.Created,published.StatusCode);
        var publishedBody=await published.Content.ReadFromJsonAsync<JsonElement>();
        var body=publishedBody.GetProperty("data");Assert.Equal(1,body.GetProperty("publishedVersion").GetInt32());
        Assert.Equal(1,body.GetProperty("currentVersion").GetInt32());Assert.Equal(1,body.GetProperty("versions").GetArrayLength());
        var revision=body.GetProperty("published")[0];
        Assert.Equal(1,revision.GetProperty("version").GetInt32());Assert.Equal(1,revision.GetProperty("publishedFrom").GetInt32());
        Assert.Equal("published",revision.GetProperty("status").GetString());
        Assert.Equal(body.GetProperty("content").GetString(),revision.GetProperty("content").GetString());
        Assert.False(body.GetProperty("modelExecutionEnabled").GetBoolean());
        var again=await client.PostAsJsonAsync("/api/v1/prompts/alert-explanation/publish",new PromptPublishRequest(1, "approval://prompt/demo/1", "演示审批人"));
        Assert.Equal(HttpStatusCode.Conflict,again.StatusCode);Assert.Contains("already_published",await again.Content.ReadAsStringAsync());
        var stale=await client.PostAsJsonAsync("/api/v1/prompts/alert-explanation/publish",new PromptPublishRequest(9, "approval://prompt/demo/9", "演示审批人"));
        Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/prompts/alert-explanation/publish",new PromptPublishRequest(0, "approval://prompt/demo/0", "演示审批人"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await client.PostAsJsonAsync("/api/v1/prompts/unknown-id/publish",new PromptPublishRequest(1, "approval://prompt/demo/1", "演示审批人"))).StatusCode);
    }
    [Fact] public async Task EachNewDraftVersionCanBePublishedOnce()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        Assert.Equal(HttpStatusCode.Created,(await client.PostAsJsonAsync("/api/v1/prompts/ticket-summary/versions",new PromptVersionRequest("总结工单 {{ticket_id}} 的 {{ticket_details}}；新增待确认项。",1))).StatusCode);
        var first=await client.PostAsJsonAsync("/api/v1/prompts/ticket-summary/publish",new PromptPublishRequest(2, "approval://prompt/demo/2", "演示审批人"));
        Assert.Equal(HttpStatusCode.Created,first.StatusCode);
        var after=await client.GetFromJsonAsync<JsonElement>("/api/v1/prompts/ticket-summary");
        Assert.Equal(1,after.GetProperty("data").GetProperty("publishedVersion").GetInt32());Assert.Equal(1,after.GetProperty("data").GetProperty("published").GetArrayLength());
        Assert.Equal(2,after.GetProperty("data").GetProperty("published")[0].GetProperty("publishedFrom").GetInt32());
        Assert.Equal(HttpStatusCode.Created,(await client.PostAsJsonAsync("/api/v1/prompts/ticket-summary/restore",new PromptRestoreRequest(2,2))).StatusCode);
        var second=await client.PostAsJsonAsync("/api/v1/prompts/ticket-summary/publish",new PromptPublishRequest(3, "approval://prompt/demo/3", "演示审批人"));
        Assert.Equal(HttpStatusCode.Created,second.StatusCode);
        var body=await second.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2,body.GetProperty("data").GetProperty("publishedVersion").GetInt32());
        Assert.Equal(2,body.GetProperty("data").GetProperty("published").GetArrayLength());
        // Newest published revision is returned first and records the draft version it copied.
        Assert.Equal(3,body.GetProperty("data").GetProperty("published")[0].GetProperty("publishedFrom").GetInt32());
        Assert.Equal(2,body.GetProperty("data").GetProperty("published")[1].GetProperty("publishedFrom").GetInt32());
    }
}
