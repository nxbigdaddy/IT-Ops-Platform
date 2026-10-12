using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Ai;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class AiResponseScenarioTests
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
    [Fact] public void EveryFixtureVerdictComesFromTheRealParser()
    {
        var scenarios=AiResponseScenarios.List();
        Assert.Equal(15,scenarios.Count);
        Assert.Equal(scenarios.Count,scenarios.Select(item=>item.Id).Distinct(StringComparer.Ordinal).Count());
        Assert.All(scenarios,item=>{Assert.False(item.LiveCallPerformed);Assert.False(item.TransportImplemented);Assert.False(item.ProductionEnabled);});
        Assert.All(scenarios,item=>Assert.Contains(item.Protocol,new[]{"OpenAiCompatible","Anthropic"}));
        var accepted=scenarios.Where(item=>item.Accepted).ToArray();
        Assert.Equal(2,accepted.Length);
        Assert.All(accepted,item=>{Assert.Equal("accepted",item.Code);Assert.False(string.IsNullOrWhiteSpace(item.OutputPreview));Assert.True(item.InputTokens>0);Assert.True(item.OutputTokens>0);});
        var rejected=scenarios.Where(item=>!item.Accepted).ToArray();
        Assert.Equal(13,rejected.Length);
        Assert.All(rejected,item=>{Assert.NotEqual("accepted",item.Code);Assert.Null(item.OutputPreview);Assert.Equal(0,item.InputTokens);});
        // The rejection codes come from the adapters, so they must stay meaningful and distinct where expected.
        var codes=rejected.ToDictionary(item=>item.Id,item=>item.Code);
        Assert.Equal("unsupported_object",codes["openai-object-mismatch"]);
        Assert.Equal("unsupported_role",codes["openai-role-mismatch"]);
        Assert.Equal("inconsistent_usage",codes["openai-usage-inconsistent"]);
        Assert.Equal("unsupported_stop_reason",codes["openai-stop-unsupported"]);
        Assert.Equal("invalid_output_length",codes["openai-empty-output"]);
        Assert.Equal("tools_not_supported",codes["openai-tool-call"]);
        Assert.Equal("provider_error_not_supported",codes["openai-provider-error"]);
        Assert.Equal("duplicate_property",codes["openai-duplicate-property"]);
        Assert.Equal("invalid_json",codes["openai-invalid-json"]);
        Assert.Equal("unsupported_type",codes["anthropic-type-mismatch"]);
        Assert.Equal("unsupported_stop_reason",codes["anthropic-stop-unsupported"]);
        Assert.Equal("provider_error_not_supported",codes["anthropic-provider-error"]);
        Assert.Null(AiResponseScenarios.Find("unknown"));
        Assert.Null(AiResponseScenarios.Find(null));
    }
    [Fact] public async Task ScenarioRoutesAreDemoOnlyAndNeverClaimALiveCall()
    {
        await using(var app=await Start())
        {
            using var client=app.GetTestClient();
            var list=await client.GetFromJsonAsync<JsonElement>("/api/v1/ai-response-scenarios");
            Assert.Equal("none",list.GetProperty("persistence").GetString());
            Assert.Equal(15,list.GetProperty("data").GetArrayLength());
            foreach(var item in list.GetProperty("data").EnumerateArray())
            {
                Assert.False(item.GetProperty("liveCallPerformed").GetBoolean());
                Assert.False(item.GetProperty("transportImplemented").GetBoolean());
                Assert.False(item.GetProperty("productionEnabled").GetBoolean());
            }
            var accepted=await client.PostAsJsonAsync("/api/v1/ai-response-preflight",new AiResponseDraft("openai-valid"));
            Assert.Equal(HttpStatusCode.OK,accepted.StatusCode);
            var body=await accepted.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(body.GetProperty("data").GetProperty("accepted").GetBoolean());
            Assert.False(body.GetProperty("data").GetProperty("liveCallPerformed").GetBoolean());
            var rejected=await client.PostAsJsonAsync("/api/v1/ai-response-preflight",new AiResponseDraft("openai-tool-call"));
            Assert.Equal(HttpStatusCode.OK,rejected.StatusCode);
            var rejectedBody=await rejected.Content.ReadFromJsonAsync<JsonElement>();
            Assert.False(rejectedBody.GetProperty("data").GetProperty("accepted").GetBoolean());
            Assert.Equal("tools_not_supported",rejectedBody.GetProperty("data").GetProperty("code").GetString());
            // Rejected fixtures must not echo the fixture payload back to the caller.
            Assert.DoesNotContain("tool_calls",await rejected.Content.ReadAsStringAsync());
            var unknown=await client.PostAsJsonAsync("/api/v1/ai-response-preflight",new AiResponseDraft("unknown"));
            Assert.Equal(HttpStatusCode.BadRequest,unknown.StatusCode);
            Assert.Equal(JsonValueKind.Null,(await unknown.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").ValueKind);
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/ai-response-preflight",new{scenario="openai-valid",send=true})).StatusCode);
            using var foreign=new HttpRequestMessage(HttpMethod.Get,"/api/v1/ai-response-scenarios");foreign.Headers.Add("Origin","https://foreign.example.invalid");
            Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(foreign)).StatusCode);
        }
        await using(var app=await Start("Production",false))
        {
            using var client=app.GetTestClient();
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.GetAsync("/api/v1/ai-response-scenarios")).StatusCode);
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsJsonAsync("/api/v1/ai-response-preflight",new AiResponseDraft("openai-valid"))).StatusCode);
        }
    }
}
