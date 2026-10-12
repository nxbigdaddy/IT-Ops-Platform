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
public sealed class ExecutionScenarioTests
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
    [Fact] public void StagesShowWhereTheCombinedGateStops()
    {
        var scenarios=ExecutionScenarios.List();
        Assert.Equal(11,scenarios.Count);
        Assert.Equal(scenarios.Count,scenarios.Select(item=>item.Id).Distinct(StringComparer.Ordinal).Count());
        Assert.All(scenarios,item=>{Assert.False(item.ExecutionEnabled);Assert.False(item.ApprovalConsumed);Assert.False(item.ProductionEnabled);Assert.NotEmpty(item.Stages);});
        var byId=scenarios.ToDictionary(item=>item.Id);
        Assert.True(byId["all-gates-pass"].Eligible);
        Assert.Equal("valid_snapshot_only",byId["all-gates-pass"].Code);
        Assert.All(byId["all-gates-pass"].Stages,stage=>Assert.True(stage.Passed));
        // Authorization failures stop before any digest work.
        foreach(var id in new[]{"site-outside-scope","viewer-request","no-approval","self-approved"})
        {
            Assert.False(byId[id].Eligible);
            Assert.Equal(2,byId[id].Stages.Count);
            Assert.False(byId[id].Stages[1].Passed);
            Assert.DoesNotContain(byId[id].Stages,stage=>stage.Name=="digestComputed");
        }
        Assert.Equal("site_scope_denied",byId["site-outside-scope"].Code);
        Assert.Equal("role_denied",byId["viewer-request"].Code);
        Assert.Equal("independent_approval_required",byId["no-approval"].Code);
        Assert.Equal("independent_approval_required",byId["self-approved"].Code);
        // The malformed draft passes authorization but cannot be canonicalised.
        Assert.Equal("invalid_operation_draft",byId["malformed-draft"].Code);
        Assert.Equal(3,byId["malformed-draft"].Stages.Count);
        Assert.False(byId["malformed-draft"].Stages[2].Passed);
        Assert.False(byId["malformed-draft"].Eligible);
        // Approval failures reach the binding stage.
        foreach(var id in new[]{"approval-expired","approval-revoked","approval-consumed","digest-mismatch","version-mismatch"})
        {
            Assert.False(byId[id].Eligible);
            Assert.Equal(4,byId[id].Stages.Count);
            Assert.True(byId[id].Stages[2].Passed);
            Assert.False(byId[id].Stages[3].Passed);
        }
        Assert.Equal("approval_time_invalid",byId["approval-expired"].Code);
        Assert.Equal("approval_revoked",byId["approval-revoked"].Code);
        Assert.Equal("approval_consumed",byId["approval-consumed"].Code);
        Assert.Equal("approval_binding_mismatch",byId["digest-mismatch"].Code);
        Assert.Equal("approval_binding_mismatch",byId["version-mismatch"].Code);
        Assert.Null(ExecutionScenarios.Find("unknown"));
        Assert.Null(ExecutionScenarios.Find(null));
    }
    [Fact] public void ScenarioVerdictsEqualTheCombinedPreflight()
    {
        // A scenario may never disagree with the real gate it claims to describe.
        var cases=ExecutionScenarios.List();
        Assert.Contains(cases,item=>item.Id=="all-gates-pass"&&item.Eligible);
        Assert.Contains(cases,item=>item.Id=="digest-mismatch"&&!item.Eligible);
        var eligible=cases.Single(item=>item.Id=="all-gates-pass");
        Assert.Equal(4,eligible.Stages.Count);
        Assert.All(eligible.Stages,stage=>Assert.True(stage.Passed));
        // Re-running the underlying gate for the pass scenario keeps producing the same code.
        Assert.Equal(eligible.Code,ExecutionPreflight.Evaluate(
            new("demo-operator",OperationsRole.Operator,["site-a"]),
            new("site-a","demo-requester",new OperationDraft("demo-target",1,"inspect",new Dictionary<string,string>(StringComparer.Ordinal){["a"]="one",["b"]="two"})),
            new("demo-target",1,OperationDigest.Compute(new OperationDraft("demo-target",1,"inspect",new Dictionary<string,string>(StringComparer.Ordinal){["a"]="one",["b"]="two"})),"demo-requester","demo-other",
                new DateTimeOffset(2026,10,10,8,55,0,TimeSpan.Zero),new DateTimeOffset(2026,10,10,9,25,0,TimeSpan.Zero),false,false),
            new DateTimeOffset(2026,10,10,9,0,0,TimeSpan.Zero)).Code);
    }
    [Fact] public async Task ExecutionRoutesAreDemoOnlyAndNeverEnableExecution()
    {
        await using(var app=await Start())
        {
            using var client=app.GetTestClient();
            var list=await client.GetFromJsonAsync<JsonElement>("/api/v1/execution-scenarios");
            Assert.Equal("none",list.GetProperty("persistence").GetString());
            Assert.Equal(11,list.GetProperty("data").GetArrayLength());
            foreach(var item in list.GetProperty("data").EnumerateArray())
            {
                Assert.False(item.GetProperty("executionEnabled").GetBoolean());
                Assert.False(item.GetProperty("approvalConsumed").GetBoolean());
                Assert.False(item.GetProperty("productionEnabled").GetBoolean());
                Assert.NotEmpty(item.GetProperty("stages").EnumerateArray());
            }
            var pass=await client.PostAsJsonAsync("/api/v1/execution-preflight",new ExecutionDraft("all-gates-pass"));
            Assert.Equal(HttpStatusCode.OK,pass.StatusCode);
            var body=await pass.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(body.GetProperty("data").GetProperty("eligible").GetBoolean());
            Assert.False(body.GetProperty("data").GetProperty("executionEnabled").GetBoolean());
            var unknown=await client.PostAsJsonAsync("/api/v1/execution-preflight",new ExecutionDraft("unknown"));
            Assert.Equal(HttpStatusCode.BadRequest,unknown.StatusCode);
            Assert.Equal(JsonValueKind.Null,(await unknown.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").ValueKind);
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/execution-preflight",new{scenario="all-gates-pass",execute=true})).StatusCode);
            using var foreign=new HttpRequestMessage(HttpMethod.Get,"/api/v1/execution-scenarios");foreign.Headers.Add("Origin","https://foreign.example.invalid");
            Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(foreign)).StatusCode);
        }
        await using(var app=await Start("Production",false))
        {
            using var client=app.GetTestClient();
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.GetAsync("/api/v1/execution-scenarios")).StatusCode);
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsJsonAsync("/api/v1/execution-preflight",new ExecutionDraft("all-gates-pass"))).StatusCode);
        }
    }
}
