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
public sealed class AuthorizationScenarioTests
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
    [Fact] public void ScenariosCoverRolesSitesAndApprovalIndependence()
    {
        var scenarios=AuthorizationScenarios.List();
        Assert.Equal(14,scenarios.Count);
        Assert.Equal(scenarios.Count,scenarios.Select(item=>item.Id).Distinct(StringComparer.Ordinal).Count());
        Assert.All(scenarios,item=>{Assert.False(item.ExecutionEnabled);Assert.False(item.ProductionEnabled);Assert.NotEmpty(item.Rules);});
        var codes=scenarios.ToDictionary(item=>item.Id,item=>item.Code);
        Assert.Equal("allowed",codes["viewer-read-in-scope"]);
        Assert.Equal("allowed",codes["operator-edit-allowed"]);
        Assert.Equal("allowed",codes["approver-approve-allowed"]);
        Assert.Equal("allowed",codes["request-approved-allowed"]);
        Assert.Equal("role_denied",codes["viewer-edit-denied"]);
        Assert.Equal("role_denied",codes["operator-approve-denied"]);
        Assert.Equal("role_denied",codes["viewer-request-denied"]);
        Assert.Equal("site_scope_denied",codes["site-outside-scope"]);
        Assert.Equal("self_approval_denied",codes["approver-self-approval"]);
        Assert.Equal("independent_approval_required",codes["request-without-approval"]);
        Assert.Equal("independent_approval_required",codes["request-self-approved"]);
        Assert.Equal("unknown_permission",codes["unknown-role"]);
        Assert.Equal("identity_required",codes["missing-identity"]);
        Assert.Equal("resource_required",codes["missing-resource"]);
        Assert.All(scenarios.Where(item=>item.Allowed),item=>Assert.Equal("allowed",item.Code));
        Assert.All(scenarios.Where(item=>!item.Allowed),item=>Assert.NotEqual("allowed",item.Code));
        // Each denial points at a specific rule, so the review panel can name the failed precondition.
        Assert.All(scenarios.Where(item=>!item.Allowed),item=>Assert.Contains(item.Rules,rule=>!rule.Passed));
        Assert.Equal(OperationsRole.Administrator.ToString(),scenarios.Single(item=>item.Id=="site-outside-scope").Role);
        Assert.Null(AuthorizationScenarios.Find("unknown"));
        Assert.Null(AuthorizationScenarios.Find(null));
    }
    [Fact] public void DiagnoseKeepsTheOriginalDecisionCodes()
    {
        // Explicit spot checks against Evaluate, which must stay consistent with Diagnose.
        Assert.Equal("allowed",OperationAuthorization.Evaluate(new("a",OperationsRole.Viewer,["site-a"]),new("site-a","r",false,""),OperationsAction.Read).Code);
        Assert.Equal("identity_required",OperationAuthorization.Evaluate(new(" ",OperationsRole.Viewer,["site-a"]),new("site-a","r",false,""),OperationsAction.Read).Code);
        Assert.Equal("resource_required",OperationAuthorization.Evaluate(new("a",OperationsRole.Viewer,["site-a"]),null,OperationsAction.Read).Code);
        Assert.Equal("unknown_permission",OperationAuthorization.Evaluate(new("a",(OperationsRole)99,["site-a"]),new("site-a","r",false,""),OperationsAction.Read).Code);
        Assert.Equal("site_scope_denied",OperationAuthorization.Evaluate(new("a",OperationsRole.Administrator,["site-a"]),new("site-b","r",false,""),OperationsAction.Read).Code);
        Assert.Equal("role_denied",OperationAuthorization.Evaluate(new("a",OperationsRole.Viewer,["site-a"]),new("site-a","r",false,""),OperationsAction.EditDraft).Code);
        Assert.Equal("self_approval_denied",OperationAuthorization.Evaluate(new("r",OperationsRole.Approver,["site-a"]),new("site-a","r",false,""),OperationsAction.ApproveChange).Code);
        Assert.Equal("independent_approval_required",OperationAuthorization.Evaluate(new("a",OperationsRole.Operator,["site-a"]),new("site-a","r",false,""),OperationsAction.RequestExecution).Code);
        Assert.Equal("allowed",OperationAuthorization.Evaluate(new("a",OperationsRole.Operator,["site-a"]),new("site-a","r",true,"o"),OperationsAction.RequestExecution).Code);
        var decision=OperationAuthorization.Evaluate(new("a",OperationsRole.Operator,["site-a"]),new("site-a","r",true,"o"),OperationsAction.RequestExecution);
        Assert.False(decision.ExecutionEnabled);
        var diagnosis=OperationAuthorization.Diagnose(new("a",OperationsRole.Operator,["site-a"]),new("site-a","r",true,"o"),OperationsAction.RequestExecution);
        Assert.True(diagnosis.Allowed);Assert.Equal(decision.Code,diagnosis.Code);Assert.False(diagnosis.ExecutionEnabled);
        Assert.All(diagnosis.Rules,rule=>Assert.True(rule.Passed));
    }
    [Fact] public async Task AuthorizationRoutesAreDemoOnlyAndNeverAuthoriseExecution()
    {
        await using(var app=await Start())
        {
            using var client=app.GetTestClient();
            var list=await client.GetFromJsonAsync<JsonElement>("/api/v1/authorization-scenarios");
            Assert.Equal("none",list.GetProperty("persistence").GetString());
            Assert.Equal(14,list.GetProperty("data").GetArrayLength());
            foreach(var item in list.GetProperty("data").EnumerateArray())
            {
                Assert.False(item.GetProperty("executionEnabled").GetBoolean());
                Assert.False(item.GetProperty("productionEnabled").GetBoolean());
                Assert.NotEmpty(item.GetProperty("role").GetString()!);
                Assert.NotEmpty(item.GetProperty("action").GetString()!);
            }
            var denied=await client.PostAsJsonAsync("/api/v1/authorization-preflight",new AuthorizationDraft("site-outside-scope"));
            Assert.Equal(HttpStatusCode.OK,denied.StatusCode);
            var body=await denied.Content.ReadFromJsonAsync<JsonElement>();
            Assert.False(body.GetProperty("data").GetProperty("allowed").GetBoolean());
            Assert.Equal("site_scope_denied",body.GetProperty("data").GetProperty("code").GetString());
            Assert.False(body.GetProperty("data").GetProperty("executionEnabled").GetBoolean());
            var unknown=await client.PostAsJsonAsync("/api/v1/authorization-preflight",new AuthorizationDraft("unknown"));
            Assert.Equal(HttpStatusCode.BadRequest,unknown.StatusCode);
            Assert.Equal(JsonValueKind.Null,(await unknown.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").ValueKind);
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/authorization-preflight",new{scenario="viewer-read-in-scope",grant=true})).StatusCode);
            using var foreign=new HttpRequestMessage(HttpMethod.Get,"/api/v1/authorization-scenarios");foreign.Headers.Add("Origin","https://foreign.example.invalid");
            Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(foreign)).StatusCode);
        }
        await using(var app=await Start("Production",false))
        {
            using var client=app.GetTestClient();
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.GetAsync("/api/v1/authorization-scenarios")).StatusCode);
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsJsonAsync("/api/v1/authorization-preflight",new AuthorizationDraft("viewer-read-in-scope"))).StatusCode);
        }
    }
}
