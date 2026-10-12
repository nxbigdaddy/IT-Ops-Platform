using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpsPlatform.Api.Persistence;
using Xunit;
namespace OpsPlatform.Api.Tests;
// A recording double replaces the in-memory ledger, proving the endpoints depend on the port only.
public sealed class RecordingLedger : IOperationLedger
{
    private readonly DemoOperationLedger inner=new();
    public List<string> Calls { get; }=[];
    public List<Guid> ClaimedIds { get; }=[];
    public Guid? FirstClaimedId => ClaimedIds.Count>0?ClaimedIds[0]:null;
    public int Count=>inner.Count;
    public DemoOperationSummary Summary(){Calls.Add("summary");return inner.Summary();}
    public OperationRecord? Find(Guid operationId){Calls.Add($"find:{operationId}");return inner.Find(operationId);}
    public OperationRecord? Get(IdempotencyIdentity identity){Calls.Add("get");return inner.Get(identity);}
    public OperationClaim Claim(IdempotencyIdentity identity,Guid operationId){Calls.Add($"claim:{identity.Key}");ClaimedIds.Add(operationId);return inner.Claim(identity,operationId);}
    public bool Complete(IdempotencyIdentity identity,Guid operationId,int resultVersion,string? resultReference=null){Calls.Add($"complete:{identity.Key}");return inner.Complete(identity,operationId,resultVersion,resultReference);}
    public bool Release(IdempotencyIdentity identity,Guid operationId){Calls.Add("release");return inner.Release(identity,operationId);}
    public bool MarkUnknown(IdempotencyIdentity identity,Guid operationId){Calls.Add($"unknown:{identity.Key}");return inner.MarkUnknown(identity,operationId);}
}
public sealed class OperationLedgerPortTests
{
    private static async Task<WebApplication> Start(RecordingLedger ledger,string environment="Development",bool demo=true)
    {
        var app=AppBootstrap.Build([],builder=>
        {
            builder.Environment.EnvironmentName=environment;
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string,string?>{{"Demo:Enabled",demo.ToString()}});
            builder.WebHost.UseTestServer();
            builder.Services.AddSingleton<IOperationLedger>(ledger);
        });
        await app.StartAsync();return app;
    }
    [Fact] public async Task EndpointsUseTheLedgerPortInsteadOfTheConcreteStore()
    {
        var ledger=new RecordingLedger();
        await using var app=await Start(ledger);using var client=app.GetTestClient();
        var summary=await client.GetFromJsonAsync<JsonElement>("/api/v1/demo-operations");
        Assert.Equal(500,summary.GetProperty("data").GetProperty("capacity").GetInt32());
        Assert.Contains("summary",ledger.Calls);
        // A transition must claim before executing and complete afterwards; the double records both.
        var created=await client.PostAsync("/api/v1/demo-tasks",null);
        var taskId=(await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("task").GetProperty("id").GetGuid();
        var key=$"synthetic-port-{Guid.NewGuid():N}";
        var transition=await client.PostAsJsonAsync($"/api/v1/demo-tasks/{taskId}/transitions",new{Event="Approve",ExpectedVersion=1,IdempotencyKey=key});
        Assert.Equal(HttpStatusCode.OK,transition.StatusCode);
        Assert.Contains(ledger.Calls,call=>call==$"claim:{key}");
        Assert.Contains(ledger.Calls,call=>call==$"complete:{key}");
        // The reconciliation lookup goes through the same port.
        Assert.NotNull(ledger.FirstClaimedId);
        var lookup=await client.GetAsync($"/api/v1/demo-operations/{ledger.FirstClaimedId}");
        Assert.Equal(HttpStatusCode.OK,lookup.StatusCode);
        Assert.Contains(ledger.Calls,call=>call==$"find:{ledger.FirstClaimedId}");
        // Replaying the same key claims again only to detect the replay; it must never complete twice.
        var replay=await client.PostAsJsonAsync($"/api/v1/demo-tasks/{taskId}/transitions",new{Event="Approve",ExpectedVersion=1,IdempotencyKey=key});
        Assert.Equal(HttpStatusCode.OK,replay.StatusCode);
        Assert.True(ledger.Calls.Count(call=>call==$"claim:{key}")>=1);
        Assert.Equal(1,ledger.Calls.Count(call=>call==$"complete:{key}"));
        Assert.Equal(1,ledger.Count);
        // The recorded result stays at the first completion; the replay never advanced it.
        var record=ledger.Find(ledger.FirstClaimedId!.Value);
        Assert.NotNull(record);Assert.Equal(2,record!.ResultVersion);Assert.True(record.Completed);
    }
    [Fact] public async Task LedgerPortIsOptionalAndProductionStillRefuses()
    {
        // The default registration must satisfy the port on its own.
        await using(var app=await Start(new RecordingLedger()))
        {
            using var client=app.GetTestClient();
            Assert.Equal(HttpStatusCode.OK,(await client.GetAsync("/api/v1/demo-operations")).StatusCode);
        }
        await using(var app=await Start(new RecordingLedger(),"Production",false))
        {
            using var client=app.GetTestClient();
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.GetAsync("/api/v1/demo-operations")).StatusCode);
        }
        // A released claim must be reclaimable by the durable store contract as well.
        var ledger=new DemoOperationLedger();
        var identity=new IdempotencyIdentity("demo:actor","feedback.submit","synthetic-release",new string('a',64));
        var operationId=Guid.NewGuid();
        Assert.True(ledger.Claim(identity,operationId).MayExecute);
        Assert.True(ledger.Release(identity,operationId));
        Assert.True(ledger.Claim(identity,Guid.NewGuid()).MayExecute);
        Assert.Equal(1,ledger.Count);
    }
}
