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
public sealed class JsonFileOperationLedgerTests : IDisposable
{
    private readonly string folder = Path.Combine(Path.GetTempPath(), $"ops-demo-ledger-{Guid.NewGuid():N}");
    private string File_ => Path.Combine(folder, "ledger.json");
    private static IdempotencyIdentity Identity(string key, char digest = 'a') => new("demo:actor", "feedback.submit", key, new string(digest, 64));
    public void Dispose()
    {
        try { if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true); } catch (IOException) { }
    }
    [Fact] public void ACompletedClaimStillReplaysAfterANewInstanceStarts()
    {
        var first = new JsonFileOperationLedger(File_);
        var operationId = Guid.NewGuid();
        Assert.True(first.Claim(Identity("key-1"), operationId).MayExecute);
        Assert.True(first.Complete(Identity("key-1"), operationId, 3, "record-1"));
        // A new instance models a process restart: the same key must still be recognised as a replay.
        var second = new JsonFileOperationLedger(File_);
        var replay = second.Claim(Identity("key-1"), Guid.NewGuid());
        Assert.Equal(OperationOutcome.ReplayCompleted, replay.Outcome);
        Assert.False(replay.MayExecute);
        Assert.False(replay.AutomaticRetryAllowed);
        Assert.Equal(operationId, replay.Record!.OperationId);
        Assert.Equal(3, replay.Record.ResultVersion);
        Assert.Equal("record-1", replay.Record.ResultReference);
        Assert.Equal(1, second.Count);
        Assert.False(File.Exists(File_ + ".tmp"), "the temporary file must not be left behind");
    }
    [Fact] public void PendingUnknownAndPayloadConflictsSurviveRestart()
    {
        var first = new JsonFileOperationLedger(File_);
        var pendingId = Guid.NewGuid();
        first.Claim(Identity("pending"), pendingId);
        var unknownId = Guid.NewGuid();
        first.Claim(Identity("unknown"), unknownId);
        first.MarkUnknown(Identity("unknown"), unknownId);
        first.Claim(Identity("conflict"), Guid.NewGuid());
        var second = new JsonFileOperationLedger(File_);
        Assert.Equal(OperationOutcome.PendingConflict, second.Claim(Identity("pending"), Guid.NewGuid()).Outcome);
        Assert.Equal(OperationOutcome.ReplayUnknown, second.Claim(Identity("unknown"), Guid.NewGuid()).Outcome);
        Assert.True(second.Claim(Identity("unknown"), Guid.NewGuid()).ReconciliationRequired);
        Assert.Equal(OperationOutcome.PayloadConflict, second.Claim(Identity("conflict", 'b'), Guid.NewGuid()).Outcome);
        var summary = second.Summary();
        Assert.Equal(3, summary.Count);Assert.Equal(2, summary.Pending);Assert.Equal(1, summary.Unknown);Assert.Equal(0, summary.Completed);
        // Releasing a pending claim removes it durably, so the key can be claimed again after a restart.
        Assert.True(second.Release(Identity("pending"), pendingId));
        var third = new JsonFileOperationLedger(File_);
        Assert.Equal(2, third.Count);
        Assert.True(third.Claim(Identity("pending"), Guid.NewGuid()).MayExecute);
    }
    [Fact] public void CapacityAndLookupsBehaveLikeTheInMemoryLedger()
    {
        var store = new JsonFileOperationLedger(File_);
        for (var index = 0; index < DemoOperationLedger.Capacity; index++) Assert.True(store.Claim(Identity($"key-{index:D3}"), Guid.NewGuid()).MayExecute);
        Assert.Equal(OperationOutcome.CapacityReached, store.Claim(Identity("key-overflow"), Guid.NewGuid()).Outcome);
        Assert.Equal(DemoOperationLedger.Capacity, new JsonFileOperationLedger(File_).Count);
        var reloaded = new JsonFileOperationLedger(File_);
        var found = reloaded.Get(Identity("key-007"));
        Assert.NotNull(found);Assert.Equal(found!.OperationId, reloaded.Find(found.OperationId)!.OperationId);
        Assert.Null(reloaded.Find(Guid.NewGuid()));
        Assert.Throws<ArgumentException>(() => reloaded.Find(Guid.Empty));
    }
    [Theory]
    [InlineData("{not-json")]
    [InlineData("[{\"scope\":\"a\",\"operation\":\"b\",\"key\":\"c\",\"digest\":\"short\",\"operationId\":\"00000000-0000-0000-0000-000000000000\",\"state\":\"pending\",\"resultVersion\":0}]")]
    [InlineData("[{\"scope\":\"a\",\"operation\":\"b\",\"key\":\"c\",\"digest\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"operationId\":\"11111111-1111-1111-1111-111111111111\",\"state\":\"done\",\"resultVersion\":0}]")]
    public void DamagedFilesAreQuarantined(string content)
    {
        Directory.CreateDirectory(folder);
        File.WriteAllText(File_, content);
        var store = new JsonFileOperationLedger(File_);
        Assert.Equal(0, store.Count);
        Assert.NotEmpty(Directory.GetFiles(folder, "ledger.json.*"));
    }
    [Fact] public async Task ConfiguredLedgerKeepsIdempotencyAcrossHosts()
    {
        Directory.CreateDirectory(folder);
        var key = $"synthetic-persisted-{Guid.NewGuid():N}";
        var request = new { Category = "bug", Message = "仅自动化验证的合成反馈（持久化幂等）", Page = "/integration", IdempotencyKey = key };
        string firstReceipt;
        await using (var app = await Start())
        {
            using var client = app.GetTestClient();
            var created = await client.PostAsJsonAsync("/api/v1/feedback", request);
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
            firstReceipt = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("id").GetString()!;
            var summary = await client.GetFromJsonAsync<JsonElement>("/api/v1/demo-operations");
            Assert.Equal(1, summary.GetProperty("data").GetProperty("completed").GetInt32());
        }
        // Second host on the same files: the replay must be answered from the persisted ledger and must NOT
        // create a second record, even though the process is new.
        await using (var app = await Start())
        {
            using var client = app.GetTestClient();
            var summary = await client.GetFromJsonAsync<JsonElement>("/api/v1/demo-operations");
            Assert.Equal(1, summary.GetProperty("data").GetProperty("count").GetInt32());
            Assert.Equal("none", summary.GetProperty("persistence").GetString());
            var replay = await client.PostAsJsonAsync("/api/v1/feedback", request);
            Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
            var replayBody = await replay.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(firstReceipt, replayBody.GetProperty("data").GetProperty("id").GetString());
            var list = await client.GetFromJsonAsync<JsonElement>("/api/v1/feedback");
            Assert.Equal(1, list.GetProperty("data").GetArrayLength());
            // A different digest on the same key must be a payload conflict, not a silent second write.
            var conflicting = await client.PostAsJsonAsync("/api/v1/feedback", new { Category = "bug", Message = "同键但不同内容", Page = "/integration", IdempotencyKey = key });
            Assert.Equal(HttpStatusCode.Conflict, conflicting.StatusCode);
        }
    }
    private async Task<WebApplication> Start()
    {
        var app = AppBootstrap.Build([], builder =>
        {
            builder.Environment.EnvironmentName = "Development";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Demo:Enabled"] = "true",
                ["Demo:OperationLedgerFile"] = File_,
                ["Demo:FeedbackFile"] = Path.Combine(folder, "feedback.json"),
            });
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();
        return app;
    }
}
