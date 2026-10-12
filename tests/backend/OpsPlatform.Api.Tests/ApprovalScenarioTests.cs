using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Security;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class ApprovalScenarioTests
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
    [Fact] public void EveryScenarioIsProducedByEvaluatingTheRules()
    {
        var scenarios=ApprovalScenarios.List();
        Assert.Equal(10,scenarios.Count);
        Assert.Equal(scenarios.Count,scenarios.Select(item=>item.Id).Distinct(StringComparer.Ordinal).Count());
        Assert.All(scenarios,item=>Assert.False(item.ExecutionEnabled));
        Assert.All(scenarios,item=>Assert.False(item.ProductionEnabled));
        Assert.All(scenarios,item=>Assert.NotEmpty(item.Rules));
        Assert.All(scenarios,item=>Assert.False(string.IsNullOrWhiteSpace(item.Label)||string.IsNullOrWhiteSpace(item.Description)));
        var codes=scenarios.ToDictionary(item=>item.Id,item=>item.Code);
        Assert.Equal("valid_snapshot_only",codes["valid"]);
        Assert.Equal("approval_required",codes["missing"]);
        Assert.Equal("approval_revoked",codes["revoked"]);
        Assert.Equal("approval_consumed",codes["consumed"]);
        Assert.Equal("independent_approval_required",codes["self-approval"]);
        Assert.Equal("approval_binding_mismatch",codes["digest-mismatch"]);
        Assert.Equal("approval_binding_mismatch",codes["version-mismatch"]);
        Assert.Equal("approval_time_invalid",codes["expired"]);
        Assert.Equal("approval_time_invalid",codes["not-yet-valid"]);
        Assert.Equal("invalid_change",codes["malformed-change"]);
        Assert.True(scenarios.Single(item=>item.Id=="valid").Valid);
        Assert.All(scenarios.Where(item=>item.Id!="valid"),item=>Assert.False(item.Valid));
        // Exactly one rule fails in each rejection scenario, so the panel can point at a specific precondition.
        foreach(var item in scenarios.Where(item=>item.Id is not "valid" and not "missing"))
        {
            Assert.Contains(item.Rules,rule=>!rule.Passed);
            Assert.Single(item.Rules,rule=>!rule.Passed);
        }
        Assert.Null(ApprovalScenarios.Find("unknown"));
        Assert.Null(ApprovalScenarios.Find(null));
    }
    [Fact] public async Task ScenarioRoutesAreDemoOnlyAndNeverAuthoriseExecution()
    {
        await using(var app=await Start())
        {
            using var client=app.GetTestClient();
            var list=await client.GetFromJsonAsync<JsonElement>("/api/v1/approval-scenarios");
            Assert.Equal("none",list.GetProperty("persistence").GetString());
            Assert.Equal(10,list.GetProperty("data").GetArrayLength());
            foreach(var item in list.GetProperty("data").EnumerateArray())
            {
                Assert.False(item.GetProperty("executionEnabled").GetBoolean());
                Assert.False(item.GetProperty("productionEnabled").GetBoolean());
                Assert.True(item.GetProperty("rules").GetArrayLength()>=1);
            }
            var valid=await client.PostAsJsonAsync("/api/v1/approval-preflight",new ApprovalDraft("valid"));
            Assert.Equal(HttpStatusCode.OK,valid.StatusCode);
            var body=await valid.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("valid_snapshot_only",body.GetProperty("data").GetProperty("code").GetString());
            Assert.False(body.GetProperty("data").GetProperty("executionEnabled").GetBoolean());
            var unknown=await client.PostAsJsonAsync("/api/v1/approval-preflight",new ApprovalDraft("unknown"));
            Assert.Equal(HttpStatusCode.BadRequest,unknown.StatusCode);
            Assert.Equal(JsonValueKind.Null,(await unknown.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").ValueKind);
            // Unknown request fields are rejected instead of silently ignored.
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/approval-preflight",new{scenario="valid",execute=true})).StatusCode);
            using var foreign=new HttpRequestMessage(HttpMethod.Get,"/api/v1/approval-scenarios");foreign.Headers.Add("Origin","https://foreign.example.invalid");
            Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(foreign)).StatusCode);
        }
        await using(var app=await Start("Production",false))
        {
            using var client=app.GetTestClient();
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.GetAsync("/api/v1/approval-scenarios")).StatusCode);
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsJsonAsync("/api/v1/approval-preflight",new ApprovalDraft("valid"))).StatusCode);
        }
    }
}
