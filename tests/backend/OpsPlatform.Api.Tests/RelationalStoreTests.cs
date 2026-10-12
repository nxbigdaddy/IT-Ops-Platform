using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Persistence;
using OpsPlatform.Api.Persistence.Relational;
using OpsPlatform.Api.Tasks;
using OpsPlatform.Api.Services;
using OpsPlatform.Api.Services;
using Xunit;
namespace OpsPlatform.Api.Tests;
// Real relational persistence: a SQLite file with real transactions and a real unique index. It stays
// development-only (no migrations, retention or audit), but uniqueness and durability are the database's job.
public sealed class RelationalStoreTests : IDisposable
{
    private readonly string folder = Path.Combine(Path.GetTempPath(), $"ops-demo-sqlite-{Guid.NewGuid():N}");
    private string DatabasePath => Path.Combine(folder, "demo.db");
    private DbContextOptions<OpsPlatformDbContext> Options => OpsPlatformDbContext.OptionsFor(DatabasePath);
    public RelationalStoreTests()
    {
        Directory.CreateDirectory(folder);
        using var context = new OpsPlatformDbContext(Options);
        context.Database.EnsureCreated();
    }
    public void Dispose()
    {
        try { if (Directory.Exists(folder)) Directory.Delete(folder, true); } catch (IOException) { }
    }
    private static FeedbackDto Feedback(string message) => new(Guid.NewGuid(), "bug", message, "/assets", DateTimeOffset.UtcNow);
    private static IdempotencyIdentity Identity(string key, char digest = 'a') => new("demo:actor", "feedback.submit", key, new string(digest, 64));
    [Fact] public void FeedbackIsDurableAndOrderedNewestFirst()
    {
        var store = new RelationalFeedbackStore(Options);
        store.Add(Feedback("第一条"));
        Thread.Sleep(5);
        store.Add(Feedback("第二条"));
        // A second store instance over the same file models a process restart.
        var reopened = new RelationalFeedbackStore(Options);
        var list = reopened.List();
        Assert.Equal(2, list.Count);
        Assert.Equal("第二条", list[0].Message);
        Assert.Equal("第一条", list[1].Message);
        Assert.True(File.Exists(DatabasePath));
    }
    [Fact] public void CapacityIsTrimmedInsideATransaction()
    {
        var store = new RelationalFeedbackStore(Options);
        for (var index = 0; index < InMemoryDemoFeedbackStore.Capacity + 3; index++) store.Add(Feedback($"FB-{index:D3}"));
        using var context = new OpsPlatformDbContext(Options);
        Assert.Equal(InMemoryDemoFeedbackStore.Capacity, context.Feedback.Count());
        var list = store.List();
        Assert.Equal(InMemoryDemoFeedbackStore.Capacity, list.Count);
        Assert.Equal($"FB-{InMemoryDemoFeedbackStore.Capacity + 2:D3}", list[0].Message);
        Assert.DoesNotContain(list, item => item.Message == "FB-000");
    }
    [Fact] public void TheDatabaseEnforcesOneClaimPerIdempotencyKey()
    {
        var ledger = new RelationalOperationLedger(Options);
        var operationId = Guid.NewGuid();
        Assert.Equal(OperationOutcome.Claimed, ledger.Claim(Identity("key-1"), operationId).Outcome);
        // Same key, different digest: the row already exists, so this is a payload conflict, not a new claim.
        Assert.Equal(OperationOutcome.PayloadConflict, ledger.Claim(Identity("key-1", 'b'), Guid.NewGuid()).Outcome);
        Assert.Equal(OperationOutcome.PendingConflict, ledger.Claim(Identity("key-1"), Guid.NewGuid()).Outcome);
        // A second ledger instance (new process) sees the same row.
        Assert.Equal(OperationOutcome.PendingConflict, new RelationalOperationLedger(Options).Claim(Identity("key-1"), Guid.NewGuid()).Outcome);
        using var context = new OpsPlatformDbContext(Options);
        Assert.Equal(1, context.Ledger.Count());
        // The unique index itself must reject a duplicate insert, not only the application's pre-check.
        context.Ledger.Add(new LedgerRow
        {
            Scope = "demo:actor", Operation = "feedback.submit", Key = "key-1", Digest = new string('a', 64),
            OperationId = Guid.NewGuid(), State = "pending", ResultVersion = 0,
        });
        Assert.Throws<DbUpdateException>(() => context.SaveChanges());
    }
    [Fact] public void CompletionAndReplayFollowTheLedgerContract()
    {
        var ledger = new RelationalOperationLedger(Options);
        var operationId = Guid.NewGuid();
        Assert.True(ledger.Claim(Identity("key-2"), operationId).MayExecute);
        Assert.True(ledger.Complete(Identity("key-2"), operationId, 3, "record-1"));
        var replay = ledger.Claim(Identity("key-2"), Guid.NewGuid());
        Assert.Equal(OperationOutcome.ReplayCompleted, replay.Outcome);
        Assert.False(replay.MayExecute);Assert.False(replay.AutomaticRetryAllowed);
        Assert.Equal(3, replay.Record!.ResultVersion);Assert.Equal("record-1", replay.Record.ResultReference);
        // Completion is conditional: a foreign operation id must not resolve someone else's claim.
        Assert.True(ledger.Claim(Identity("key-3"), Guid.NewGuid()).MayExecute);
        Assert.False(ledger.Complete(Identity("key-3"), operationId, 9));
        Assert.False(ledger.Complete(Identity("key-2"), operationId, 4));
        Assert.Equal(OperationOutcome.ReplayCompleted, ledger.Claim(Identity("key-2"), Guid.NewGuid()).Outcome);
        var unknownId = Guid.NewGuid();
        ledger.Claim(Identity("key-4"), unknownId);
        Assert.True(ledger.MarkUnknown(Identity("key-4"), unknownId));
        Assert.True(ledger.Claim(Identity("key-4"), Guid.NewGuid()).ReconciliationRequired);
        // Release only removes unresolved rows, never a completed one.
        Assert.True(ledger.Release(Identity("key-4"), unknownId));
        Assert.Equal(OperationOutcome.Claimed, ledger.Claim(Identity("key-4"), Guid.NewGuid()).Outcome);
        Assert.False(ledger.Release(Identity("key-2"), operationId));
        var summary = ledger.Summary();
        // key-2 completed, key-3 claimed, key-4 re-claimed after release: three rows remain.
        Assert.Equal(3, summary.Count);Assert.Equal(1, summary.Completed);Assert.Equal(2, summary.Pending);
        Assert.Equal(DemoOperationLedger.Capacity - 3, summary.Remaining);
    }
    [Fact] public void TaskStateAndJournalSurviveAndCasIsEnforcedByTheDatabase()
    {
        var store = new RelationalTaskStore(Options);
        var created = store.Create();
        Assert.Equal(201, created.Status);
        var id = created.Task!.Id;
        Assert.Equal(TaskState.AwaitingApproval, created.Task.Snapshot.State);
        Assert.Equal(200, store.Apply(id, TaskEvent.Approve, 1).Status);
        Assert.Equal(200, store.Apply(id, TaskEvent.Enqueue, 2).Status);
        // A second store instance models a restart: version, state and journal must be intact.
        var reopened = new RelationalTaskStore(Options);
        var read = reopened.Read(id);
        Assert.NotNull(read);
        Assert.Equal(TaskState.Queued, read!.Task.Snapshot.State);
        Assert.Equal(3, read.Task.Snapshot.Version);
        Assert.Equal([TaskEvent.Approve, TaskEvent.Enqueue], read.History.Select(entry => entry.Event).ToArray());
        Assert.Equal([1L, 2L], read.History.Select(entry => entry.Sequence).ToArray());
        // A stale expectation must not advance the row, and must not append journal noise either.
        var stale = reopened.Apply(id, TaskEvent.Approve, 1);
        Assert.Equal(409, stale.Status);
        Assert.Equal("version_conflict", stale.Code);
        Assert.Equal(3, stale.Task!.Snapshot.Version);
        // The rejected attempt must not append a journal row: the two accepted transitions remain.
        Assert.Equal(2, reopened.Read(id)!.History.Count);
        // Two writers racing on the same expectation: the conditional update lets exactly one through.
        // Queued -> Cancel is accepted, and the second writer must lose the race.
        var left = new RelationalTaskStore(Options);
        var right = new RelationalTaskStore(Options);
        var leftResult = left.Apply(id, TaskEvent.Cancel, 3);
        var rightResult = right.Apply(id, TaskEvent.Cancel, 3);
        Assert.Equal(200, leftResult.Status);
        Assert.Equal(409, rightResult.Status);
        Assert.Equal("version_conflict", rightResult.Code);
        Assert.Equal(TaskState.Cancelled, left.Read(id)!.Task.Snapshot.State);
        Assert.Equal(3, left.Read(id)!.History.Count);
        Assert.Equal(404, left.Apply(Guid.NewGuid(), TaskEvent.Approve, 1).Status);
    }
    [Fact] public void TaskCapacityIsEnforced()
    {
        var store = new RelationalTaskStore(Options);
        for (var index = 0; index < DemoTaskStore.Capacity; index++) Assert.Equal(201, store.Create().Status);
        Assert.Equal(409, store.Create().Status);
        using var context = new OpsPlatformDbContext(Options);
        Assert.Equal(DemoTaskStore.Capacity, context.Tasks.Count());
    }
    [Fact] public void PromptVersionsAndPublishedRevisionsSurviveWithTheirApproval()
    {
        const string template = "根据 {{asset_name}} 的 {{alert_summary}} 区分事实与假设；无依据时明确无法确认，不执行操作。";
        var store = new RelationalPromptStateStore(Options);
        Assert.Null(store.Load());
        var first = new PromptService(store);
        Assert.Equal(201, first.AddVersion("alert-explanation", new PromptVersionRequest(template + "（库内补充）", 1)).StatusCode);
        Assert.Equal(201, first.Publish("alert-explanation", new PromptPublishRequest(2, "approval://prompt/alert-explanation/11", "演示审批人")).StatusCode);
        // A new service over the same database models a restart; the schema still comes from code.
        var second = new PromptService(new RelationalPromptStateStore(Options));
        var restored = second.Get("alert-explanation")!;
        Assert.Equal(2, restored.CurrentVersion);
        Assert.EndsWith("（库内补充）", restored.Content);
        Assert.Equal(["asset_name", "alert_summary", "severity"], restored.Variables);
        Assert.Single(restored.Published!);
        Assert.Equal("approval://prompt/alert-explanation/11", restored.Published![0].ApprovalReference);
        Assert.Equal("演示审批人", restored.Published![0].ApprovedBy);
        Assert.Equal(2, restored.Published[0].PublishedFrom);
        // Unchanged prompts keep their seeds, and an unknown id can never be revived from the database.
        Assert.Equal(1, second.Get("ticket-summary")!.CurrentVersion);
        Assert.Null(second.Get("not-a-real-prompt"));
        using var context = new OpsPlatformDbContext(Options);
        Assert.Equal(2, context.PromptVersions.Count(row => row.PromptId == "alert-explanation"));
        Assert.Single(context.PromptPublished);
        // The unique index refuses a duplicate version instead of overwriting history.
        context.PromptVersions.Add(new PromptVersionRow { PromptId = "alert-explanation", Version = 2, Content = "重复版本", CreatedAtUnixMs = 1 });
        Assert.Throws<DbUpdateException>(() => context.SaveChanges());
    }
    [Fact] public void TheRouteUsesTheRelationalStoresAndStillClaimsNoPersistence()
    {
        var app = AppBootstrap.Build([], builder =>
        {
            builder.Environment.EnvironmentName = "Development";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Demo:Enabled"] = "true",
                ["Demo:SqlitePath"] = DatabasePath,
            });
            builder.WebHost.UseTestServer();
        });
        app.StartAsync().GetAwaiter().GetResult();
        using var client = app.GetTestClient();
        var created = client.PostAsJsonAsync("/api/v1/feedback", new FeedbackRequest("bug", "仅自动化验证的合成反馈", "/assets", "sqlite-key-1")).GetAwaiter().GetResult();
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        // The replay of the same key answers 200 without inserting a second row.
        Assert.Equal(HttpStatusCode.OK, client.PostAsJsonAsync("/api/v1/feedback", new FeedbackRequest("bug", "仅自动化验证的合成反馈", "/assets", "sqlite-key-1")).GetAwaiter().GetResult().StatusCode);
        var list = client.GetFromJsonAsync<JsonElement>("/api/v1/feedback").GetAwaiter().GetResult();
        Assert.Equal(1, list.GetProperty("data").GetArrayLength());
        // The response contract still refuses to claim durable persistence: a database exists, but the API does not promise it.
        // The list route reports the demo envelope's storage mode; either way it must not claim durability.
        Assert.Contains(list.GetProperty("persistence").GetString(), new[] { "none", "memory" });
        Assert.True(list.GetProperty("isDemo").GetBoolean());
        var modes = client.GetFromJsonAsync<JsonElement>("/api/v1/storage-modes").GetAwaiter().GetResult();
        Assert.False(modes.GetProperty("data").GetProperty("anyDurable").GetBoolean());
        Assert.False(modes.GetProperty("data").GetProperty("productionReady").GetBoolean());
    }
}
