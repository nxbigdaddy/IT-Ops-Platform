using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Persistence;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class MigrationPlanTests
{
    [Fact] public void PlanCoversEveryInMemoryStoreWithoutClaimingExecution()
    {
        var plan=MigrationPlan.List();
        Assert.Equal(8,plan.Count);
        Assert.Equal(plan.Count,plan.Select(step=>step.Id).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(plan.Count,plan.Select(step=>step.Table).Distinct(StringComparer.Ordinal).Count());
        Assert.All(plan,step=>{Assert.False(step.Executed);Assert.False(step.ProductionEnabled);});
        Assert.All(plan,step=>{Assert.NotEmpty(step.KeyColumns);Assert.NotEmpty(step.UniqueConstraints);Assert.False(string.IsNullOrWhiteSpace(step.Purpose));Assert.False(string.IsNullOrWhiteSpace(step.Notes));});
        // Every planned table is uniquely keyed; the ledger and task history need composite uniqueness.
        Assert.All(plan,step=>Assert.All(step.UniqueConstraints,constraint=>Assert.Contains("(",constraint)));
        var ledger=plan.Single(step=>step.Id=="operation-ledger");
        Assert.Contains("ux_operation_identity(scope,operation,key)",ledger.UniqueConstraints);
        Assert.Contains("ux_operation_id(operation_id)",ledger.UniqueConstraints);
        var journal=plan.Single(step=>step.Id=="task-journal");
        Assert.Contains("ux_task_sequence(task_id,sequence)",journal.UniqueConstraints);
        // Each in-memory store introduced so far must appear in the plan.
        foreach(var id in new[]{"feedback-records","prompt-drafts","prompt-versions","prompt-published","task-snapshots","task-journal","operation-ledger"})
            Assert.Contains(plan,step=>step.Id==id);
        Assert.Null(MigrationPlan.Find("unknown"));
        Assert.Null(MigrationPlan.Find(null));
        Assert.Equal("operation-ledger",MigrationPlan.Find("operation-ledger")!.Id);
    }
    [Fact] public async Task PlanRouteIsReadOnlyDemoGatedAndNeverReportsExecution()
    {
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
            var body=await client.GetFromJsonAsync<JsonElement>("/api/v1/migration-plan");
            Assert.Equal("none",body.GetProperty("persistence").GetString());
            Assert.True(body.GetProperty("isDemo").GetBoolean());
            foreach(var step in body.GetProperty("data").EnumerateArray())
            {
                Assert.False(step.GetProperty("executed").GetBoolean());
                Assert.False(step.GetProperty("productionEnabled").GetBoolean());
                Assert.NotEmpty(step.GetProperty("keyColumns").EnumerateArray());
                Assert.NotEmpty(step.GetProperty("uniqueConstraints").EnumerateArray());
            }
            using var foreign=new HttpRequestMessage(HttpMethod.Get,"/api/v1/migration-plan");
            foreign.Headers.Add("Origin","https://foreign.example.invalid");
            Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(foreign)).StatusCode);
            // The plan is read-only: there is no execution endpoint.
            Assert.Equal(HttpStatusCode.MethodNotAllowed,(await client.PostAsync("/api/v1/migration-plan",null)).StatusCode);
        }
        await using(var app=AppBootstrap.Build([],builder=>
        {
            builder.Environment.EnvironmentName="Production";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string,string?>{{"Demo:Enabled","false"}});
            builder.WebHost.UseTestServer();
        }))
        {
            await app.StartAsync();
            using var client=app.GetTestClient();
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.GetAsync("/api/v1/migration-plan")).StatusCode);
        }
    }
}
