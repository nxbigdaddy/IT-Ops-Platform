using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Ai;
using OpsPlatform.Api.Configuration;
using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Services;
using Xunit;

namespace OpsPlatform.Api.Tests;

public sealed class ApiTests
{
    private static async Task<WebApplication> Start(string environment = "Development", bool demo = true, string? provider = null)
    {
        var app = AppBootstrap.Build([], builder =>
        {
            builder.Environment.EnvironmentName = environment;
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Demo:Enabled"] = demo.ToString(), ["Database:Provider"] = provider
            });
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();
        return app;
    }

    [Fact]
    public async Task OperationLedgerExposesSummaryAndReconciliationLookup()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var before=await client.GetFromJsonAsync<JsonElement>("/api/v1/demo-operations");
        Assert.Equal("none",before.GetProperty("persistence").GetString());
        Assert.Equal(500,before.GetProperty("data").GetProperty("capacity").GetInt32());
        var baseline=before.GetProperty("data").GetProperty("count").GetInt32();
        var created=await client.PostAsync("/api/v1/demo-tasks",null);
        var taskId=(await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("task").GetProperty("id").GetGuid();
        var key=$"synthetic-{Guid.NewGuid():N}";
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsJsonAsync($"/api/v1/demo-tasks/{taskId}/transitions",new{Event="Approve",ExpectedVersion=1,IdempotencyKey=key})).StatusCode);
        var after=await client.GetFromJsonAsync<JsonElement>("/api/v1/demo-operations");
        Assert.Equal(baseline+1,after.GetProperty("data").GetProperty("count").GetInt32());
        Assert.Equal(1,after.GetProperty("data").GetProperty("completed").GetInt32());
        Assert.Equal(0,after.GetProperty("data").GetProperty("unknown").GetInt32());
        Assert.Equal(500-baseline-1,after.GetProperty("data").GetProperty("remaining").GetInt32());
        Assert.False(after.GetProperty("data").GetProperty("persistent").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync($"/api/v1/demo-operations/{Guid.NewGuid()}")).StatusCode);
    }
    [Fact]
    public async Task OperationLedgerExposesSummaryAndReconciliationLookupIsGated()
    {
        await using var app=await Start("Production",false);using var client=app.GetTestClient();
        Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.GetAsync("/api/v1/demo-operations")).StatusCode);
        await using var demo=await Start();using var demoClient=demo.GetTestClient();
        using var foreign=new HttpRequestMessage(HttpMethod.Get,"/api/v1/demo-operations");foreign.Headers.Add("Origin","https://foreign.example.invalid");
        Assert.Equal(HttpStatusCode.Forbidden,(await demoClient.SendAsync(foreign)).StatusCode);
    }
    [Fact]
    public async Task DatabasePreflightReturnsCandidatePreconditions()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var valid=await client.PostAsJsonAsync("/api/v1/database-preflight",new DatabaseDeploymentDraft(DatabaseProvider.PostgreSQL,"db-01.invalid","secret://database/demo",2,2,false));
        var body=await valid.Content.ReadFromJsonAsync<JsonElement>();var candidate=body.GetProperty("data").GetProperty("candidate");
        Assert.Equal("PostgreSQL",candidate.GetProperty("name").GetString());
        Assert.True(candidate.GetProperty("packageAvailable").GetBoolean());Assert.False(candidate.GetProperty("singleInstanceOnly").GetBoolean());
        Assert.False(candidate.GetProperty("adapterImplemented").GetBoolean());Assert.False(candidate.GetProperty("liveVerified").GetBoolean());Assert.False(candidate.GetProperty("productionEnabled").GetBoolean());
        var required=candidate.GetProperty("requiredVerification").EnumerateArray().Select(item=>item.GetString()).ToArray();
        Assert.Equal(DatabaseCapabilities.List().Single(item=>item.Provider==DatabaseProvider.PostgreSQL).RequiredVerification,required);
        Assert.Equal(required.Distinct().Count(),required.Length);
        var sqlite=await client.PostAsJsonAsync("/api/v1/database-preflight",new DatabaseDeploymentDraft(DatabaseProvider.Sqlite,"db-01.invalid","secret://database/demo",2,2,false));
        var sqliteBody=await sqlite.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(sqliteBody.GetProperty("data").GetProperty("configurationValid").GetBoolean());
        Assert.True(sqliteBody.GetProperty("data").GetProperty("candidate").GetProperty("singleInstanceOnly").GetBoolean());
        var realHost=await client.PostAsJsonAsync("/api/v1/database-preflight",new DatabaseDeploymentDraft(DatabaseProvider.PostgreSQL,"db-01.internal","secret://database/demo",1,1,false));
        Assert.Equal(HttpStatusCode.BadRequest,realHost.StatusCode);
        var hostText=await realHost.Content.ReadAsStringAsync();
        Assert.Contains("not_documentation_target",hostText);Assert.DoesNotContain("db-01.internal",hostText);
        var unknown=await client.PostAsJsonAsync("/api/v1/database-preflight",new DatabaseDeploymentDraft((DatabaseProvider)99,"db-01.invalid","secret://database/demo",1,1,false));
        var unknownBody=await unknown.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Null,unknownBody.GetProperty("data").GetProperty("candidate").ValueKind);
    }
    [Fact]
    public async Task DatabaseProviderValuesMatchTheCatalogAndThePreflight()
    {
        var values=DatabaseCapabilities.ProviderValues();
        Assert.Equal(4,values.Count);Assert.Equal(values.Select(item=>item.Value).Distinct().Count(),values.Count);
        Assert.Equal(values.Select(item=>item.Name).Distinct().Count(),values.Count);
        Assert.Equal(DatabaseCapabilities.List().Select(item=>item.Name).OrderBy(name=>name),values.Select(item=>item.DisplayName).OrderBy(name=>name));
        Assert.Equal(Enum.GetValues<DatabaseProvider>().Length,values.Count);
        await using var app=await Start();using var client=app.GetTestClient();
        var response=await client.GetAsync("/api/v1/database-provider-values");Assert.Equal(HttpStatusCode.OK,response.StatusCode);
        var body=await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("none",body.GetProperty("persistence").GetString());Assert.Equal(4,body.GetProperty("data").GetArrayLength());
        // Every advertised numeric value must be accepted by the preflight with a minimal valid draft.
        foreach(var item in values)
        {
            var draft=new DatabaseDeploymentDraft((DatabaseProvider)item.Value,"db-01.invalid","secret://database/demo",1,1,false);
            var check=await client.PostAsJsonAsync("/api/v1/database-preflight",draft);
            Assert.Equal(HttpStatusCode.OK,check.StatusCode);
        }
        Assert.Equal(HttpStatusCode.ServiceUnavailable,(await (await Start("Production",false)).GetTestClient().GetAsync("/api/v1/database-provider-values")).StatusCode);
    }
    [Fact]
    public async Task AiProtocolCatalogMatchesTheValuesThePreflightAccepts()
    {
        Assert.Equal(2,AiProtocols.List().Count);
        Assert.Equal(AiProtocols.Accepted.OrderBy(value=>value),AiProtocols.List().Select(item=>item.Protocol).OrderBy(value=>value));
        await using var app=await Start();using var client=app.GetTestClient();
        var response=await client.GetAsync("/api/v1/ai-protocols");Assert.Equal(HttpStatusCode.OK,response.StatusCode);
        var body=await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("none",body.GetProperty("persistence").GetString());Assert.True(body.GetProperty("isDemo").GetBoolean());
        var items=body.GetProperty("data");Assert.Equal(2,items.GetArrayLength());
        foreach(var item in items.EnumerateArray())
        {
            Assert.Contains(item.GetProperty("protocol").GetString(),AiProtocols.Accepted);
            Assert.True(item.GetProperty("adapterImplemented").GetBoolean());
            foreach(var flag in new[]{"transportImplemented","liveVerified","credentialRead"})Assert.False(item.GetProperty(flag).GetBoolean());
            Assert.False(string.IsNullOrWhiteSpace(item.GetProperty("displayName").GetString()));
            Assert.False(string.IsNullOrWhiteSpace(item.GetProperty("requestContract").GetString()));
        }
        // Every advertised protocol must actually pass the preflight when the rest of the draft is valid.
        foreach(var protocol in AiProtocols.Accepted)
        {
            var draft=new OpsPlatform.Api.Ai.AiConnectionDraft(protocol,"https://ai.example.invalid/v1","demo-model","secret://ai/demo",10,100,200);
            var check=await client.PostAsJsonAsync("/api/v1/ai-preflight",draft);
            Assert.Equal(HttpStatusCode.OK,check.StatusCode);
        }
        Assert.Equal(HttpStatusCode.ServiceUnavailable,(await (await Start("Production",false)).GetTestClient().GetAsync("/api/v1/ai-protocols")).StatusCode);
    }
    [Fact]
    public async Task FeedbackIdempotencyKeyPreventsDuplicateRecords()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var key=$"synthetic-{Guid.NewGuid():N}";
        var request=new FeedbackRequest("bug","synthetic idempotent feedback","/integration",key);
        var first=await client.PostAsJsonAsync("/api/v1/feedback",request);
        Assert.Equal(HttpStatusCode.Created,first.StatusCode);
        var created=await first.Content.ReadFromJsonAsync<JsonElement>();var id=created.GetProperty("data").GetProperty("id").GetGuid();
        var replay=await client.PostAsJsonAsync("/api/v1/feedback",request);
        Assert.Equal(HttpStatusCode.OK,replay.StatusCode);
        var replayed=await replay.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(id,replayed.GetProperty("data").GetProperty("id").GetGuid());Assert.Equal("memory",replayed.GetProperty("persistence").GetString());
        var list=await client.GetFromJsonAsync<JsonElement>("/api/v1/feedback");Assert.Equal(1,list.GetProperty("data").GetArrayLength());
        var conflict=await client.PostAsJsonAsync("/api/v1/feedback",new FeedbackRequest("bug","different synthetic body","/integration",key));
        Assert.Equal(HttpStatusCode.Conflict,conflict.StatusCode);Assert.Contains("idempotency_payload_conflict",await conflict.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/feedback",new FeedbackRequest("bug","synthetic","/integration","has space"))).StatusCode);
        var anonymous=await client.PostAsJsonAsync("/api/v1/feedback",new FeedbackRequest("bug","synthetic without key","/integration"));
        Assert.Equal(HttpStatusCode.Created,anonymous.StatusCode);
        var after=await client.GetFromJsonAsync<JsonElement>("/api/v1/feedback");Assert.Equal(2,after.GetProperty("data").GetArrayLength());
    }
    [Fact]
    public async Task FeedbackReplayReportsUnavailableWhenRecordEvicted()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var key=$"synthetic-{Guid.NewGuid():N}";
        var request=new FeedbackRequest("bug","synthetic eviction feedback","/integration",key);
        Assert.Equal(HttpStatusCode.Created,(await client.PostAsJsonAsync("/api/v1/feedback",request)).StatusCode);
        for(var index=0;index<FeedbackService.Capacity;index++)
            Assert.Equal(HttpStatusCode.Created,(await client.PostAsJsonAsync("/api/v1/feedback",new FeedbackRequest("bug",$"filler-{index}","/integration"))).StatusCode);
        var replay=await client.PostAsJsonAsync("/api/v1/feedback",request);
        Assert.Equal(HttpStatusCode.Conflict,replay.StatusCode);
        var body=await replay.Content.ReadAsStringAsync();Assert.Contains("idempotent_result_unavailable",body);Assert.DoesNotContain("synthetic eviction feedback",body);
    }
    [Fact]
    public async Task TaskTransitionIdempotencyKeyReplaysWithoutAdvancing()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var created=await client.PostAsync("/api/v1/demo-tasks",null);
        var body=await created.Content.ReadFromJsonAsync<JsonElement>();var id=body.GetProperty("data").GetProperty("task").GetProperty("id").GetGuid();
        var key=$"synthetic-{Guid.NewGuid():N}";
        var first=await client.PostAsJsonAsync($"/api/v1/demo-tasks/{id}/transitions",new{Event="Approve",ExpectedVersion=1,IdempotencyKey=key});
        Assert.Equal(HttpStatusCode.OK,first.StatusCode);
        var firstBody=await first.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2,firstBody.GetProperty("data").GetProperty("task").GetProperty("snapshot").GetProperty("version").GetInt32());
        Assert.Equal(JsonValueKind.Null,firstBody.GetProperty("data").GetProperty("replayedVersion").ValueKind);
        var replay=await client.PostAsJsonAsync($"/api/v1/demo-tasks/{id}/transitions",new{Event="Approve",ExpectedVersion=1,IdempotencyKey=key});
        Assert.Equal(HttpStatusCode.OK,replay.StatusCode);
        var replayBody=await replay.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("replayed",replayBody.GetProperty("data").GetProperty("code").GetString());
        Assert.Equal(2,replayBody.GetProperty("data").GetProperty("replayedVersion").GetInt32());
        Assert.Equal(2,replayBody.GetProperty("data").GetProperty("task").GetProperty("snapshot").GetProperty("version").GetInt32());
        Assert.Equal("memory",replayBody.GetProperty("persistence").GetString());Assert.False(replayBody.GetProperty("data").GetProperty("executed").GetBoolean());
        var after=await client.GetFromJsonAsync<JsonElement>($"/api/v1/demo-tasks/{id}");Assert.Equal(2,after.GetProperty("data").GetProperty("snapshot").GetProperty("version").GetInt32());
        Assert.Equal(1,(await client.GetFromJsonAsync<JsonElement>($"/api/v1/demo-tasks/{id}/history")).GetProperty("data").GetArrayLength());
        var conflict=await client.PostAsJsonAsync($"/api/v1/demo-tasks/{id}/transitions",new{Event="Cancel",ExpectedVersion=2,IdempotencyKey=key});
        Assert.Equal(HttpStatusCode.Conflict,conflict.StatusCode);Assert.Contains("idempotency_payload_conflict",await conflict.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync($"/api/v1/demo-tasks/{id}/transitions",new{Event="Enqueue",ExpectedVersion=2,IdempotencyKey="has space"})).StatusCode);
    }
    [Fact]
    public async Task RejectedTransitionReleasesItsIdempotencyClaim()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var created=await client.PostAsync("/api/v1/demo-tasks",null);
        var body=await created.Content.ReadFromJsonAsync<JsonElement>();var id=body.GetProperty("data").GetProperty("task").GetProperty("id").GetGuid();
        var key=$"synthetic-{Guid.NewGuid():N}";
        var rejected=await client.PostAsJsonAsync($"/api/v1/demo-tasks/{id}/transitions",new{Event="Enqueue",ExpectedVersion=7,IdempotencyKey=key});
        Assert.Equal(HttpStatusCode.Conflict,rejected.StatusCode);
        var accepted=await client.PostAsJsonAsync($"/api/v1/demo-tasks/{id}/transitions",new{Event="Approve",ExpectedVersion=1,IdempotencyKey=key});
        Assert.Equal(HttpStatusCode.OK,accepted.StatusCode);
        var acceptedBody=await accepted.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("transitioned",acceptedBody.GetProperty("data").GetProperty("code").GetString());
        Assert.Equal(2,acceptedBody.GetProperty("data").GetProperty("task").GetProperty("snapshot").GetProperty("version").GetInt32());
    }
    [Fact]
    public async Task ConnectorPlanPreflightIsOfflineAndGated()
    {
        var items=ConnectorRegistry.List().Select(c=>new ConnectorPlanItem(c.Id,c.Protocols[0],c.PlannedReadCapabilities,$"secret://connector/{c.Id}")).ToArray();
        await using(var app=await Start())
        {
            using var client=app.GetTestClient();
            var response=await client.PostAsJsonAsync("/api/v1/connector-plan-preflight",new ConnectorPlanDraft(items));
            Assert.Equal(HttpStatusCode.OK,response.StatusCode);
            var body=await response.Content.ReadFromJsonAsync<JsonElement>();var data=body.GetProperty("data");
            Assert.Equal("none",body.GetProperty("persistence").GetString());Assert.True(data.GetProperty("configurationValid").GetBoolean());
            Assert.Equal(10,data.GetProperty("validItems").GetInt32());Assert.Equal(10,data.GetProperty("items").GetArrayLength());
            foreach(var flag in new[]{"connectionAttempted","executionAllowed","compatibilityVerified"})Assert.False(data.GetProperty(flag).GetBoolean());
            var mixed=items.ToArray();mixed[0]=new("demo-linux","SNMPv3",["disk"],"secret://connector/demo-linux");
            var rejected=await client.PostAsJsonAsync("/api/v1/connector-plan-preflight",new ConnectorPlanDraft(mixed));
            Assert.Equal(HttpStatusCode.BadRequest,rejected.StatusCode);
            var rejectedBody=await rejected.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(9,rejectedBody.GetProperty("data").GetProperty("validItems").GetInt32());Assert.Equal(1,rejectedBody.GetProperty("data").GetProperty("invalidItems").GetInt32());
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/connector-plan-preflight",new{items=Array.Empty<object>()})).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/connector-plan-preflight",new{})).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/connector-plan-preflight",new{items,execute=true})).StatusCode);
            using var foreign=new HttpRequestMessage(HttpMethod.Post,"/api/v1/connector-plan-preflight"){Content=JsonContent.Create(new ConnectorPlanDraft(items))};foreign.Headers.Add("Origin","https://foreign.example.invalid");
            Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(foreign)).StatusCode);
        }
        await using(var app=await Start("Production",false)){using var client=app.GetTestClient();Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsJsonAsync("/api/v1/connector-plan-preflight",new ConnectorPlanDraft(items))).StatusCode);}
    }
    [Fact]
    public async Task ConnectorPreflightIsOfflineAndGated()
    {
        var draft=new ConnectorReadDraft("demo-linux","SSH allowlist",["disk"],"secret://connector/demo");
        await using(var app=await Start())
        {
            using var client=app.GetTestClient();
            var response=await client.PostAsJsonAsync("/api/v1/connector-preflight",draft);Assert.Equal(HttpStatusCode.OK,response.StatusCode);
            var body=await response.Content.ReadFromJsonAsync<JsonElement>();Assert.Equal("none",body.GetProperty("persistence").GetString());Assert.True(body.GetProperty("isDemo").GetBoolean());
            foreach(var flag in new[]{"connectionAttempted","executionAllowed","compatibilityVerified"})Assert.False(body.GetProperty("data").GetProperty(flag).GetBoolean());
            var registered=body.GetProperty("data").GetProperty("candidate");
            Assert.Equal("demo-linux",registered.GetProperty("id").GetString());
            Assert.Equal("planned",registered.GetProperty("status").GetString());
            Assert.False(registered.GetProperty("implemented").GetBoolean());Assert.False(registered.GetProperty("liveVerified").GetBoolean());Assert.False(registered.GetProperty("writeEnabled").GetBoolean());
            Assert.Contains("disk",registered.GetProperty("plannedReadCapabilities").EnumerateArray().Select(item=>item.GetString()));
            var onboarding=registered.GetProperty("requiredBeforeOnboarding").EnumerateArray().Select(item=>item.GetString()).ToArray();
            Assert.InRange(onboarding.Length,1,8);Assert.All(onboarding,item=>Assert.False(string.IsNullOrWhiteSpace(item)));
            Assert.Equal(onboarding.Length,onboarding.Distinct(StringComparer.Ordinal).Count());
            var unknown=await client.PostAsJsonAsync("/api/v1/connector-preflight",new ConnectorReadDraft("demo-unknown","SSH allowlist",["disk"],"secret://connector/demo"));
            Assert.Equal(HttpStatusCode.BadRequest,unknown.StatusCode);
            Assert.Equal(JsonValueKind.Null,(await unknown.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("candidate").ValueKind);
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/connector-preflight",draft with {Protocol="SNMPv3"})).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/connector-preflight",new{connectorId="demo-linux",protocol="SSH allowlist"})).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/connector-preflight",new{connectorId="demo-linux",protocol="SSH allowlist",capabilities=new[]{"disk"},execute=true})).StatusCode);
            using var foreign=new HttpRequestMessage(HttpMethod.Post,"/api/v1/connector-preflight"){Content=JsonContent.Create(draft)};foreign.Headers.Add("Origin","https://foreign.example.invalid");Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(foreign)).StatusCode);
        }
        await using(var app=await Start("Production",false)){using var client=app.GetTestClient();Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsJsonAsync("/api/v1/connector-preflight",draft)).StatusCode);}
    }
    [Fact]
    public async Task FeedbackRawLengthCannotBeBypassedWithWhitespace()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var rejected=await client.PostAsJsonAsync("/api/v1/feedback",new FeedbackRequest("bug",new string(' ',2000)+"x","/"));
        Assert.Equal(HttpStatusCode.BadRequest,rejected.StatusCode);
        var empty=await client.GetFromJsonAsync<JsonElement>("/api/v1/feedback");Assert.Equal(0,empty.GetProperty("data").GetArrayLength());
        var accepted=await client.PostAsJsonAsync("/api/v1/feedback",new FeedbackRequest("bug",new string(' ',1999)+"x","/"));
        Assert.Equal(HttpStatusCode.Created,accepted.StatusCode);
        var body=await accepted.Content.ReadFromJsonAsync<JsonElement>();Assert.Equal("x",body.GetProperty("data").GetProperty("message").GetString());
    }
    [Fact]
    public async Task FeedbackReceiptLookupReflectsDemoEviction()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        Guid first=Guid.Empty,last=Guid.Empty;
        for(var index=0;index<=FeedbackService.Capacity;index++)
        {
            var created=await client.PostAsJsonAsync("/api/v1/feedback",new FeedbackRequest("bug",$"synthetic-eviction-{index}","/integration"));
            Assert.Equal(HttpStatusCode.Created,created.StatusCode);
            var receipt=await created.Content.ReadFromJsonAsync<JsonElement>();last=receipt.GetProperty("data").GetProperty("id").GetGuid();if(index==0)first=last;
        }
        var missing=await client.GetAsync($"/api/v1/feedback/{first}");Assert.Equal(HttpStatusCode.NotFound,missing.StatusCode);
        var text=await missing.Content.ReadAsStringAsync();Assert.Contains("feedback_not_found",text);Assert.DoesNotContain("synthetic-eviction",text);
        Assert.Equal(HttpStatusCode.OK,(await client.GetAsync($"/api/v1/feedback/{last}")).StatusCode);
        var list=await client.GetFromJsonAsync<JsonElement>("/api/v1/feedback");Assert.Equal(FeedbackService.Capacity,list.GetProperty("data").GetArrayLength());
    }
    [Fact]
    public async Task FeedbackReceiptCanBeReadByIdWithoutPersistenceClaim()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var created=await client.PostAsJsonAsync("/api/v1/feedback",new FeedbackRequest("bug","synthetic receipt lookup","/integration"));
        var receipt=await created.Content.ReadFromJsonAsync<JsonElement>();var item=receipt.GetProperty("data");var id=item.GetProperty("id").GetGuid();
        var response=await client.GetAsync($"/api/v1/feedback/{id}");Assert.Equal(HttpStatusCode.OK,response.StatusCode);
        var body=await response.Content.ReadFromJsonAsync<JsonElement>();Assert.Equal(item.GetRawText(),body.GetProperty("data").GetRawText());Assert.Equal("memory",body.GetProperty("persistence").GetString());
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync($"/api/v1/feedback/{Guid.NewGuid()}")).StatusCode);
        using var foreign=new HttpRequestMessage(HttpMethod.Get,$"/api/v1/feedback/{id}");foreign.Headers.Add("Origin","https://foreign.example.invalid");Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(foreign)).StatusCode);
    }
    [Fact]
    public async Task TaskSnapshotReturnsMatchingStateAndHistory()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var created=await client.PostAsync("/api/v1/demo-tasks",null);var body=await created.Content.ReadFromJsonAsync<JsonElement>();
        var id=body.GetProperty("data").GetProperty("task").GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsJsonAsync($"/api/v1/demo-tasks/{id}/transitions",new{Event="Approve",ExpectedVersion=1})).StatusCode);
        var response=await client.GetAsync($"/api/v1/demo-tasks/{id}/snapshot");Assert.Equal(HttpStatusCode.OK,response.StatusCode);
        var snapshot=await response.Content.ReadFromJsonAsync<JsonElement>();var data=snapshot.GetProperty("data");
        Assert.Equal("memory",snapshot.GetProperty("persistence").GetString());Assert.False(data.GetProperty("task").GetProperty("executed").GetBoolean());
        Assert.Equal(2,data.GetProperty("task").GetProperty("snapshot").GetProperty("version").GetInt32());
        Assert.Equal(1,data.GetProperty("history").GetArrayLength());Assert.Equal(2,data.GetProperty("history")[0].GetProperty("version").GetInt32());
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync($"/api/v1/demo-tasks/{Guid.NewGuid()}/snapshot")).StatusCode);
    }
    [Theory]
    [InlineData("provider")]
    [InlineData("endpoint")]
    [InlineData("model")]
    [InlineData("secretReference")]
    [InlineData("timeoutSeconds")]
    [InlineData("maxOutputTokens")]
    [InlineData("requestBudgetTokens")]
    [InlineData("unknown")]
    public async Task AiDraftRequiresExactFieldsWithoutEcho(string mutation)
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var fields=new Dictionary<string,object>{{"provider","OpenAiCompatible"},{"endpoint","https://ai.example.invalid/v1"},{"model","demo-model"},{"secretReference","secret://ai/demo"},{"timeoutSeconds",10},{"maxOutputTokens",100},{"requestBudgetTokens",200}};
        if(mutation=="unknown")fields.Add("unexpectedSetting","synthetic-diagnostic-marker");else fields.Remove(mutation);
        var response=await client.PostAsJsonAsync("/api/v1/ai-preflight",fields);
        Assert.Equal(HttpStatusCode.BadRequest,response.StatusCode);
        var text=await response.Content.ReadAsStringAsync();Assert.DoesNotContain("secret://ai/demo",text);Assert.DoesNotContain("synthetic-diagnostic-marker",text);
    }
    [Fact]
    public async Task DatabaseDraftRejectsUnknownFieldsWithoutEcho()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var fields=new Dictionary<string,object>{{"provider",0},{"secretReference","secret://database/demo"},{"apiInstances",1},{"workerInstances",0},{"automaticFallback",false},{"unexpectedSetting","synthetic-diagnostic-marker"}};
        var response=await client.PostAsJsonAsync("/api/v1/database-preflight",fields);
        Assert.Equal(HttpStatusCode.BadRequest,response.StatusCode);
        var text=await response.Content.ReadAsStringAsync();Assert.DoesNotContain("synthetic-diagnostic-marker",text);Assert.DoesNotContain("secret://database/demo",text);
    }
    [Theory]
    [InlineData("provider")]
    [InlineData("secretReference")]
    [InlineData("apiInstances")]
    [InlineData("workerInstances")]
    [InlineData("automaticFallback")]
    public async Task DatabaseDraftCannotSilentlyDefaultMissingFields(string missing)
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var fields=new Dictionary<string,object>{{"provider",0},{"secretReference","secret://database/demo"},{"apiInstances",1},{"workerInstances",0},{"automaticFallback",false}};
        fields.Remove(missing);
        var response=await client.PostAsJsonAsync("/api/v1/database-preflight",fields);
        Assert.Equal(HttpStatusCode.BadRequest,response.StatusCode);
        Assert.DoesNotContain("secret://database/demo",await response.Content.ReadAsStringAsync());
    }
    [Theory]
    [InlineData("/api/v1/ai-preflight")]
    [InlineData("/api/v1/database-preflight")]
    public async Task PreflightRoutesRespectDemoAndOriginGates(string path)
    {
        object draft=path.Contains("ai-preflight")
            ? new OpsPlatform.Api.Ai.AiConnectionDraft("OpenAiCompatible","https://ai.example.invalid/v1","demo-model","secret://ai/demo",10,100,200)
            : new DatabaseDeploymentDraft(DatabaseProvider.PostgreSQL,"db-01.invalid","secret://database/demo",1,1,false);
        await using(var disabled=await Start("Production",false))
        {
            using var client=disabled.GetTestClient();
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsJsonAsync(path,draft)).StatusCode);
        }
        await using(var demo=await Start())
        {
            using var client=demo.GetTestClient();
            using var request=new HttpRequestMessage(HttpMethod.Post,path){Content=JsonContent.Create(draft)};
            request.Headers.Add("Origin","https://foreign.example.invalid");
            Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(request)).StatusCode);
            Assert.Equal(HttpStatusCode.OK,(await client.PostAsJsonAsync(path,draft)).StatusCode);
        }
    }
    [Theory]
    [InlineData("Production",false)]
    [InlineData("Development",false)]
    public async Task TaskSnapshotIsUnavailableOutsideEnabledDevelopmentDemo(string environment,bool enabled)
    {
        await using var app=await Start(environment,enabled);using var client=app.GetTestClient();
        Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.GetAsync($"/api/v1/demo-tasks/{Guid.NewGuid()}/snapshot")).StatusCode);
    }
    [Fact]
    public async Task ExistingTaskSnapshotRejectsForeignOrigin()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var created=await client.PostAsync("/api/v1/demo-tasks",null);
        var body=await created.Content.ReadFromJsonAsync<JsonElement>();
        var id=body.GetProperty("data").GetProperty("task").GetProperty("id").GetGuid();
        var path=$"/api/v1/demo-tasks/{id}/snapshot";
        using var request=new HttpRequestMessage(HttpMethod.Get,path);request.Headers.Add("Origin","https://foreign.example.invalid");
        var denied=await client.SendAsync(request);Assert.Equal(HttpStatusCode.Forbidden,denied.StatusCode);
        Assert.DoesNotContain(id.ToString(),await denied.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.OK,(await client.GetAsync(path)).StatusCode);
    }
    [Fact]
    public async Task AiPreflightUsesServerOwnedDemoAllowlistWithoutNetwork()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var draft=new OpsPlatform.Api.Ai.AiConnectionDraft("OpenAiCompatible","https://ai.example.invalid/v1","demo-model","secret://ai/demo",10,100,200);
        var valid=await client.PostAsJsonAsync("/api/v1/ai-preflight",draft);Assert.Equal(HttpStatusCode.OK,valid.StatusCode);
        var body=await valid.Content.ReadFromJsonAsync<JsonElement>();Assert.Equal("none",body.GetProperty("persistence").GetString());
        Assert.False(body.GetProperty("data").GetProperty("networkVerified").GetBoolean());Assert.False(body.GetProperty("data").GetProperty("liveCallEnabled").GetBoolean());
        var rejected=await client.PostAsJsonAsync("/api/v1/ai-preflight",draft with {Endpoint="https://other.example.invalid/v1"});
        Assert.Equal(HttpStatusCode.BadRequest,rejected.StatusCode);var text=await rejected.Content.ReadAsStringAsync();Assert.Contains("host_not_approved",text);Assert.DoesNotContain("other.example.invalid",text);
        var local=await client.PostAsJsonAsync("/api/v1/ai-preflight",draft with {Endpoint="https://127.0.0.1/v1"});Assert.Equal(HttpStatusCode.BadRequest,local.StatusCode);
        var realModel=await client.PostAsJsonAsync("/api/v1/ai-preflight",draft with {Model="gpt-4o"});
        Assert.Equal(HttpStatusCode.BadRequest,realModel.StatusCode);
        var modelText=await realModel.Content.ReadAsStringAsync();
        Assert.Contains("not_reserved_demo_model",modelText);Assert.DoesNotContain("gpt-4o",modelText);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsJsonAsync("/api/v1/ai-preflight",draft with {Model="demo-model-2"})).StatusCode);
    }
    [Fact]
    public async Task DatabasePreflightChecksDraftWithoutConnectionOrPersistence()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var valid=await client.PostAsJsonAsync("/api/v1/database-preflight",new DatabaseDeploymentDraft(DatabaseProvider.PostgreSQL,"db-01.invalid","secret://database/demo",2,2,false));
        Assert.Equal(HttpStatusCode.OK,valid.StatusCode);
        var body=await valid.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("none",body.GetProperty("persistence").GetString());
        Assert.True(body.GetProperty("data").GetProperty("configurationValid").GetBoolean());
        Assert.False(body.GetProperty("data").GetProperty("connectionAttempted").GetBoolean());
        Assert.False(body.GetProperty("data").GetProperty("productionReady").GetBoolean());
        var invalid=await client.PostAsJsonAsync("/api/v1/database-preflight",new DatabaseDeploymentDraft(DatabaseProvider.Sqlite,"db-01.invalid","synthetic-not-a-reference",2,2,true));
        Assert.Equal(HttpStatusCode.BadRequest,invalid.StatusCode);
        var text=await invalid.Content.ReadAsStringAsync();Assert.DoesNotContain("synthetic-not-a-reference",text);Assert.Contains("sqlite_single_instance_only",text);Assert.Contains("forbidden",text);
    }
    [Fact]
    public async Task DemoTaskRoutesSimulateVersionedTransitionsOnly()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var created=await client.PostAsync("/api/v1/demo-tasks",null);Assert.Equal(HttpStatusCode.Created,created.StatusCode);
        var body=await created.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.GetProperty("data").GetProperty("executed").GetBoolean());
        var id=body.GetProperty("data").GetProperty("task").GetProperty("id").GetGuid();
        var read=await client.GetFromJsonAsync<JsonElement>($"/api/v1/demo-tasks/{id}");
        var detail=read.GetProperty("data");
        Assert.True(detail.GetProperty("isDemo").GetBoolean());
        Assert.False(detail.GetProperty("executed").GetBoolean());
        Assert.Equal("memory",detail.GetProperty("persistence").GetString());
        Assert.Equal("state-simulation-only",detail.GetProperty("mode").GetString());
        var url=$"/api/v1/demo-tasks/{id}/transitions";
        Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync(url,new{Event="1",ExpectedVersion=1})).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsJsonAsync(url,new{Event="Approve",ExpectedVersion=1})).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await client.PostAsJsonAsync(url,new{Event="Approve",ExpectedVersion=1})).StatusCode);
        var history=await client.GetFromJsonAsync<JsonElement>($"/api/v1/demo-tasks/{id}/history");Assert.Equal(1,history.GetProperty("data").GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound,(await client.GetAsync($"/api/v1/demo-tasks/{Guid.NewGuid()}")).StatusCode);
        using var foreign=new HttpRequestMessage(HttpMethod.Post,"/api/v1/demo-tasks");foreign.Headers.Add("Origin","https://foreign.invalid");
        Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(foreign)).StatusCode);
    }
    [Fact]
    public async Task DemoTaskTimeoutRequiresExplicitReconciliationOverHttp()
    {
        await using var app=await Start();using var client=app.GetTestClient();
        var created=await client.PostAsync("/api/v1/demo-tasks",null);
        var envelope=await created.Content.ReadFromJsonAsync<JsonElement>();
        var id=envelope.GetProperty("data").GetProperty("task").GetProperty("id").GetGuid();
        var endpoint=$"/api/v1/demo-tasks/{id}/transitions";
        var version=1;
        foreach(var action in new[]{"Approve","Enqueue","Start","Timeout"})
        {
            var response=await client.PostAsJsonAsync(endpoint,new{Event=action,ExpectedVersion=version++});
            Assert.Equal(HttpStatusCode.OK,response.StatusCode);
        }
        var unknown=await client.GetFromJsonAsync<JsonElement>($"/api/v1/demo-tasks/{id}");
        Assert.Equal(7,unknown.GetProperty("data").GetProperty("snapshot").GetProperty("state").GetInt32());
        Assert.Equal(HttpStatusCode.Conflict,(await client.PostAsJsonAsync(endpoint,new{Event="Start",ExpectedVersion=version})).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await client.PostAsJsonAsync(endpoint,new{Event="ReconcileSucceeded",ExpectedVersion=version})).StatusCode);
        var final=await client.GetFromJsonAsync<JsonElement>($"/api/v1/demo-tasks/{id}");
        Assert.Equal(4,final.GetProperty("data").GetProperty("snapshot").GetProperty("state").GetInt32());
        Assert.Equal(6,final.GetProperty("data").GetProperty("snapshot").GetProperty("version").GetInt32());
        Assert.False(final.GetProperty("data").GetProperty("executed").GetBoolean());
        var history=await client.GetFromJsonAsync<JsonElement>($"/api/v1/demo-tasks/{id}/history");
        Assert.Equal(5,history.GetProperty("data").GetArrayLength());
    }
    [Fact]
    public async Task DemoTaskApiDisabledWithoutDemo()
    {
        await using var app=await Start("Production",false);using var client=app.GetTestClient();
        Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsync("/api/v1/demo-tasks",null)).StatusCode);
    }
    [Fact]
    public async Task HealthSeparatesLivenessFromUnconfiguredReadiness()
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
        var response = await client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("notConfigured", body.GetProperty("database").GetProperty("status").GetString());
        Assert.False(body.GetProperty("database").GetProperty("verified").GetBoolean());
    }

    [Theory]
    [InlineData("dashboard")]
    [InlineData("assets")]
    [InlineData("alerts")]
    [InlineData("tickets")]
    [InlineData("connectors")]
    [InlineData("connector-capabilities")]
    [InlineData("connector-capabilities/demo-linux")]
    [InlineData("database-providers")]
    [InlineData("ai-providers")]
    [InlineData("prompt-templates")]
    [InlineData("feedback")]
    public async Task DemoRoutesHaveExplicitEnvelope(string route)
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        var response = await client.GetAsync("/api/v1/" + route);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("isDemo").GetBoolean());
        Assert.True(body.TryGetProperty("data", out _));
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    [InlineData("Development")]
    public async Task WithoutDemoBusinessApiFailsClosed(string environment)
    {
        await using var app = await Start(environment, false);
        using var client = app.GetTestClient();
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/api/v1/assets")).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.PostAsJsonAsync("/api/v1/feedback", new FeedbackRequest("bug", "test", null))).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/api/v1/connector-capabilities")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
    }

    [Fact]
    public async Task CandidateDetailsAreReadOnlyAndExplicitlyUnverified()
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        var body = await client.GetFromJsonAsync<JsonElement>("/api/v1/connector-capabilities/demo-linux");
        var data = body.GetProperty("data");
        Assert.Equal("planned", data.GetProperty("status").GetString());
        Assert.False(data.GetProperty("implemented").GetBoolean());
        Assert.False(data.GetProperty("liveVerified").GetBoolean());
        Assert.False(data.GetProperty("writeEnabled").GetBoolean());
        Assert.True(data.GetProperty("protocols").GetArrayLength() > 0);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/v1/connector-capabilities/unknown")).StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await client.PostAsJsonAsync("/api/v1/connector-capabilities/demo-linux", new {})).StatusCode);
    }

    [Fact]
    public async Task ProductionDemoIsRejectedAtStartup()
        => await Assert.ThrowsAsync<InvalidOperationException>(() => Start("Production", true));

    [Theory]
    [InlineData("PostgreSQL")]
    [InlineData("SqlServer")]
    [InlineData("Sqlite")]
    [InlineData("MySql")]
    public async Task ProvidersNeverFallbackOutsideDemo(string provider)
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() => Start("Production", false, provider));
        await using var app = await Start(provider: provider);
        using var client = app.GetTestClient();
        var response = await client.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Contains("notImplemented", await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("Unknown")]
    [InlineData("0")]
    [InlineData("99")]
    public void InvalidProviderIsRejected(string provider)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["Demo:Enabled"] = "true", ["Database:Provider"] = provider }).Build();
        Assert.Throws<InvalidOperationException>(() => PlatformOptions.Read(config, "Development"));
    }

    [Fact]
    public void SupportMatrixMakesNoUnverifiedClaims()
    {
        var catalog = new DemoCatalogService();
        Assert.All(catalog.DatabaseProviders.Concat(catalog.AiProviders), item =>
        {
            Assert.Equal("planned", item.Status);
            Assert.True(item.Planned);
            Assert.False(item.Implemented);
            Assert.False(item.Verified);
            Assert.False(item.OutboundEnabled);
        });
        Assert.Equal("PostgreSQL", Assert.Single(catalog.DatabaseProviders, p => p.PackageAvailable).Id);
        Assert.True(catalog.Assets.Select(a => a.Kind).Distinct().Count() >= 6);
        Assert.Equal(catalog.Assets.Count, catalog.Dashboard.AssetCount);
    }

    [Fact]
    public async Task FeedbackIsValidatedAndExplicitlyNonPersistent()
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        var invalid = await client.PostAsJsonAsync("/api/v1/feedback", new FeedbackRequest("other", " ", "https://example.invalid"));
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal("application/problem+json", invalid.Content.Headers.ContentType?.MediaType);
        Assert.True((await invalid.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("isDemo").GetBoolean());
        var response = await client.PostAsJsonAsync("/api/v1/feedback", new FeedbackRequest("suggestion", "demo only", "/assets"));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("memory", body.GetProperty("persistence").GetString());
        Assert.False(body.GetProperty("data").GetProperty("isPersistent").GetBoolean());
        var listed = await client.GetFromJsonAsync<JsonElement>("/api/v1/feedback");
        Assert.Equal(1, listed.GetProperty("data").GetArrayLength());
    }

    [Fact]
    public void FeedbackMemoryIsBoundedAndLostWithService()
    {
        var service = new FeedbackService();
        for (var i = 0; i < 205; i++) service.Add(new("bug", $"demo {i}", null));
        Assert.Equal(FeedbackService.Capacity, service.List().Count);
        Assert.Equal("demo 204", service.List()[0].Message);
        Assert.Empty(new FeedbackService().List());
        Assert.NotEmpty(FeedbackService.Validate(new("bug", new string('x', 2001), null)));
    }

    [Fact]
    public async Task DemoRejectsRemoteHostAndCrossOrigin()
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        client.DefaultRequestHeaders.Host = "example.invalid";
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/v1/assets")).StatusCode);
        client.DefaultRequestHeaders.Host = "localhost";
        client.DefaultRequestHeaders.Add("Origin", "https://example.invalid");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/v1/feedback", new FeedbackRequest("bug", "test", null))).StatusCode);
    }

    [Fact]
    public async Task DemoRejectsNonLoopbackPeerEvenWithLocalHostHeader()
    {
        await using var app = await Start();
        var context = await app.GetTestServer().SendAsync(context =>
        {
            context.Request.Method = "GET";
            context.Request.Scheme = "http";
            context.Request.Host = new Microsoft.AspNetCore.Http.HostString("localhost");
            context.Request.Path = "/api/v1/assets";
            context.Connection.RemoteIpAddress = IPAddress.Parse("192.0.2.10");
        });
        Assert.Equal(403, context.Response.StatusCode);
    }

    [Fact]
    public async Task MalformedJsonAndUnknownRoutesUseProblemDetails()
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        var bad = await client.PostAsync("/api/v1/feedback", new StringContent("{", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal("application/problem+json", bad.Content.Headers.ContentType?.MediaType);
        Assert.True((await bad.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("isDemo").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/weatherforecast")).StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await client.PostAsJsonAsync("/api/v1/assets", new { })).StatusCode);
    }
}
