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
public sealed class ConnectorTargetScopeTests
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
    [Fact] public void OnlyDocumentationTargetsAreAccepted()
    {
        var mixed=new ConnectorTargetScopeDraft(["srv-a.invalid","db-b.example","192.0.2.10","198.51.100.7","203.0.113.9","2001:db8::1"]);
        var ok=ConnectorTargetScope.Check(mixed);
        Assert.True(ok.ConfigurationValid);Assert.Empty(ok.Errors);Assert.Equal(6,ok.Accepted);
        Assert.False(ok.ConnectionAttempted);Assert.False(ok.ExecutionAllowed);Assert.True(ok.SyntheticOnly);
        var rejected=new ConnectorTargetScopeDraft(["srv-a.invalid","real-host.internal","10.0.0.5","8.8.8.8","srv-c.invalid","srv-c.invalid","Srv-D.invalid"," srv-e.invalid","srv-f.invalid "]);
        var check=ConnectorTargetScope.Check(rejected);
        Assert.False(check.ConfigurationValid);Assert.Equal(2,check.Accepted);
        Assert.Contains(check.Errors,error=>error.Index==1&&error.Code=="not_documentation_target");
        Assert.Contains(check.Errors,error=>error.Index==2&&error.Code=="not_documentation_target");
        Assert.Contains(check.Errors,error=>error.Index==3&&error.Code=="not_documentation_target");
        Assert.Contains(check.Errors,error=>error.Index==5&&error.Code=="duplicate");
        Assert.Contains(check.Errors,error=>error.Index==6&&error.Code=="normalization_required");
        Assert.Contains(check.Errors,error=>error.Index==7&&error.Code=="normalization_required");
        Assert.Contains(check.Errors,error=>error.Index==8&&error.Code=="normalization_required");
    }
    [Fact] public void BoundsAndEmptyInputsAreRejected()
    {
        Assert.Contains(ConnectorTargetScope.Check(null).Errors,error=>error.Code=="required");
        Assert.Contains(ConnectorTargetScope.Check(new((string?[]?)null)).Errors,error=>error.Code=="required");
        Assert.Contains(ConnectorTargetScope.Check(new([])).Errors,error=>error.Code=="count_out_of_range");
        var oversized=Enumerable.Range(0,ConnectorTargetScope.MaxHosts+1).Select(index=>$"host-{index}.invalid").ToArray();
        Assert.Contains(ConnectorTargetScope.Check(new(oversized)).Errors,error=>error.Code=="count_out_of_range");
        var atLimit=Enumerable.Range(0,ConnectorTargetScope.MaxHosts).Select(index=>$"host-{index}.invalid").ToArray();
        Assert.True(ConnectorTargetScope.Check(new(atLimit)).ConfigurationValid);
        Assert.Contains(ConnectorTargetScope.Check(new(["a".PadRight(ConnectorTargetScope.MaxHostLength+1,'a')+".invalid"])).Errors,error=>error.Code=="too_long");
        Assert.Contains(ConnectorTargetScope.Check(new(["srv-a.invalid",""])).Errors,error=>error.Index==1&&error.Code=="required");
        Assert.Contains(ConnectorTargetScope.Check(new(["srv-a.invalid","srv_a.invalid"])).Errors,error=>error.Code=="not_documentation_target");
        Assert.Contains(ConnectorTargetScope.Check(new(["srv-a.invalid","srv-a.com"])).Errors,error=>error.Code=="not_documentation_target");
    }
    [Fact] public void CollectionWindowMustStayInsideTheBoundedPolicy()
    {
        // Absent window parameters keep the previous behaviour: hosts alone are valid.
        Assert.True(ConnectorTargetScope.Check(new(["srv-a.invalid"])).ConfigurationValid);
        Assert.True(ConnectorTargetScope.Check(new(["srv-a.invalid"],300,2,30)).ConfigurationValid);
        Assert.Equal(ConnectorTargetScope.MinIntervalSeconds,60);
        foreach(var draft in new[]
        {
            new ConnectorTargetScopeDraft(["srv-a.invalid"],59,2,30),
            new ConnectorTargetScopeDraft(["srv-a.invalid"],86401,2,30),
            new ConnectorTargetScopeDraft(["srv-a.invalid"],300,0,30),
            new ConnectorTargetScopeDraft(["srv-a.invalid"],300,9,30),
            new ConnectorTargetScopeDraft(["srv-a.invalid"],300,2,4),
            new ConnectorTargetScopeDraft(["srv-a.invalid"],300,2,301),
            new ConnectorTargetScopeDraft(["srv-a.invalid"],300,2,300),
            new ConnectorTargetScopeDraft(["srv-a.invalid"],300,2,600),
        })
        {
            var check=ConnectorTargetScope.Check(draft);
            Assert.False(check.ConfigurationValid,$"should reject window {draft.IntervalSeconds}/{draft.Concurrency}/{draft.TimeoutSeconds}");
            Assert.False(string.IsNullOrWhiteSpace(check.Notes));
        }
        Assert.Contains(ConnectorTargetScope.Check(new(["srv-a.invalid"],300,2,300)).Errors,error=>error.Code=="timeout_not_below_interval");
        Assert.Contains(ConnectorTargetScope.Check(new(["srv-a.invalid"],300,2,600)).Errors,error=>error.Code=="out_of_range");
        Assert.Contains(ConnectorTargetScope.Check(new(["srv-a.invalid"],30,2,10)).Errors,error=>error.Field=="intervalSeconds");
        // A window problem must not silently accept hosts either: the whole draft is invalid.
        Assert.Contains(ConnectorTargetScope.Check(new(["srv-a.invalid","real-host.internal"],300,2,600)).Errors,error=>error.Code=="not_documentation_target");
    }
    [Fact] public void ConnectorIntentRequiresASyntheticSecretReference()
    {
        ConnectorReadDraft Draft(string? reference) => new("demo-linux","SSH allowlist",["disk"],reference);
        Assert.True(ConnectorReadIntent.Check(Draft("secret://connector/demo")).ConfigurationValid);
        Assert.True(ConnectorReadIntent.Check(Draft("secret://connector/demo-linux_01")).ConfigurationValid);
        foreach(var reference in new string?[]{null,"","secret://database/demo","secret://connector/","secret://connector/UPPER","secret://connector/demo/extra","password=DemoSecret123","secret://connector/"+new string('a',65)})
        {
            var check=ConnectorReadIntent.Check(Draft(reference));
            Assert.False(check.ConfigurationValid,$"should reject reference {reference ?? "(null)"}");
            Assert.Contains(check.Errors,error=>error.Field=="secretReference"&&error.Code=="reference_required");
            Assert.False(check.ConnectionAttempted);Assert.False(check.ExecutionAllowed);
        }
        Assert.False(string.IsNullOrWhiteSpace(ConnectorReadIntent.Check(Draft("secret://connector/demo")).Notes));
    }
    [Fact] public async Task RouteIsDemoOnlyAndNeverEchoesTargets()
    {
        await using(var app=await Start())
        {
            using var client=app.GetTestClient();
            var response=await client.PostAsJsonAsync("/api/v1/connector-target-scope",new ConnectorTargetScopeDraft(["srv-a.invalid","192.0.2.1"]));
            Assert.Equal(HttpStatusCode.OK,response.StatusCode);
            var body=await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("none",body.GetProperty("persistence").GetString());Assert.True(body.GetProperty("isDemo").GetBoolean());
            Assert.Equal(2,body.GetProperty("data").GetProperty("accepted").GetInt32());
            foreach(var flag in new[]{"connectionAttempted","executionAllowed"})Assert.False(body.GetProperty("data").GetProperty(flag).GetBoolean());
            Assert.True(body.GetProperty("data").GetProperty("syntheticOnly").GetBoolean());
            var rejected=await client.PostAsJsonAsync("/api/v1/connector-target-scope",new ConnectorTargetScopeDraft(["srv-a.invalid","real-host.internal"]));
            Assert.Equal(HttpStatusCode.BadRequest,rejected.StatusCode);
            var text=await rejected.Content.ReadAsStringAsync();
            Assert.DoesNotContain("real-host.internal",text);Assert.DoesNotContain("srv-a.invalid",text);
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/connector-target-scope",new{hosts=new[]{"srv-a.invalid"},connect=true})).StatusCode);
            using var foreign=new HttpRequestMessage(HttpMethod.Post,"/api/v1/connector-target-scope"){Content=JsonContent.Create(new ConnectorTargetScopeDraft(["srv-a.invalid"]))};
            foreign.Headers.Add("Origin","https://foreign.example.invalid");Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(foreign)).StatusCode);
        }
        await using(var app=await Start("Production",false)){using var client=app.GetTestClient();Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsJsonAsync("/api/v1/connector-target-scope",new ConnectorTargetScopeDraft(["srv-a.invalid"]))).StatusCode);}
    }
}
