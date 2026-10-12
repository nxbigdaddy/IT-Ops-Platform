using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Tasks;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class JsonFileTaskStoreTests : IDisposable
{
    private readonly string folder = Path.Combine(Path.GetTempPath(), $"ops-demo-tasks-{Guid.NewGuid():N}");
    private string File_ => Path.Combine(folder, "tasks.json");
    public void Dispose()
    {
        try { if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true); } catch (IOException) { }
    }
    [Fact] public void StateAndJournalSurviveANewInstance()
    {
        var first = new JsonFileTaskStore(File_);
        var created = first.Create();
        var id = created.Task!.Id;
        Assert.Equal(TaskState.AwaitingApproval, created.Task.Snapshot.State);
        Assert.Equal(200, first.Apply(id, TaskEvent.Approve, 1).Status);
        Assert.Equal(200, first.Apply(id, TaskEvent.Enqueue, 2).Status);
        // A new instance models a process restart: version, state and history must be intact.
        var second = new JsonFileTaskStore(File_);
        var read = second.Read(id);
        Assert.NotNull(read);
        Assert.Equal(TaskState.Queued, read!.Task.Snapshot.State);
        Assert.Equal(3, read.Task.Snapshot.Version);
        Assert.Equal(2, read.History.Count);
        Assert.Equal(TaskEvent.Approve, read.History[0].Event);
        Assert.Equal(TaskEvent.Enqueue, read.History[1].Event);
        Assert.Equal([1L, 2L], read.History.Select(entry => entry.Sequence).ToArray());
        Assert.Equal(1, second.Count);
        Assert.False(File.Exists(File_ + ".tmp"), "the temporary file must not be left behind");
    }
    [Fact] public void CompareAndSwapStillRejectsStaleVersionsAfterRestart()
    {
        var first = new JsonFileTaskStore(File_);
        var id = first.Create().Task!.Id;
        Assert.Equal(200, first.Apply(id, TaskEvent.Approve, 1).Status);
        var second = new JsonFileTaskStore(File_);
        // The persisted version is 2, so replaying the old expectation must fail with a CAS conflict.
        var stale = second.Apply(id, TaskEvent.Approve, 1);
        Assert.Equal(409, stale.Status);
        Assert.Equal("version_conflict", stale.Code);
        Assert.Equal(2, stale.Task!.Snapshot.Version);
        Assert.Single(second.History(id));
        // An unknown action for the current state is rejected without corrupting the file.
        Assert.Equal(409, second.Apply(id, TaskEvent.Succeed, 2).Status);
        Assert.Equal(200, new JsonFileTaskStore(File_).Apply(id, TaskEvent.Enqueue, 2).Status);
    }
    [Fact] public void CapacityAndMissingTasksBehaveLikeTheInMemoryStore()
    {
        var store = new JsonFileTaskStore(File_);
        for (var index = 0; index < DemoTaskStore.Capacity; index++) Assert.Equal(201, store.Create().Status);
        Assert.Equal(409, store.Create().Status);
        Assert.Equal(DemoTaskStore.Capacity, new JsonFileTaskStore(File_).Count);
        var missing = Guid.NewGuid();
        Assert.Null(store.Get(missing));
        Assert.Null(store.Read(missing));
        Assert.Equal(404, store.Apply(missing, TaskEvent.Approve, 1).Status);
    }
    [Theory]
    [InlineData("{not-json")]
    [InlineData("{\"tasks\":{\"11111111-1111-1111-1111-111111111111\":{\"state\":\"Succeeded\",\"version\":0}},\"journal\":[]}")]
    [InlineData("{\"tasks\":{},\"journal\":[{\"sequence\":0,\"taskId\":\"11111111-1111-1111-1111-111111111111\",\"event\":\"Approve\",\"from\":0,\"to\":1,\"version\":2}]}")]
    public void DamagedFilesAreQuarantined(string content)
    {
        Directory.CreateDirectory(folder);
        File.WriteAllText(File_, content);
        var store = new JsonFileTaskStore(File_);
        Assert.Equal(0, store.Count);
        Assert.NotEmpty(Directory.GetFiles(folder, "tasks.json.*"));
    }
    [Fact] public async Task ConfiguredTaskFileKeepsReplayWorkingAcrossHosts()
    {
        Directory.CreateDirectory(folder);
        var key = $"synthetic-task-{Guid.NewGuid():N}";
        Guid taskId;
        await using (var app = await Start())
        {
            using var client = app.GetTestClient();
            var created = await client.PostAsync("/api/v1/demo-tasks", null);
            taskId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("task").GetProperty("id").GetGuid();
            Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync($"/api/v1/demo-tasks/{taskId}/transitions", new { Event = "Approve", ExpectedVersion = 1, IdempotencyKey = key })).StatusCode);
        }
        // Second host on the same files: the task and its ledger entry both survived, so the replay is answered
        // instead of executing a second transition.
        await using (var app = await Start())
        {
            using var client = app.GetTestClient();
            var replay = await client.PostAsJsonAsync($"/api/v1/demo-tasks/{taskId}/transitions", new { Event = "Approve", ExpectedVersion = 1, IdempotencyKey = key });
            Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
            var snapshot = await client.GetFromJsonAsync<JsonElement>($"/api/v1/demo-tasks/{taskId}");
            Assert.Equal(2, snapshot.GetProperty("data").GetProperty("snapshot").GetProperty("version").GetInt32());
            var history = await client.GetFromJsonAsync<JsonElement>($"/api/v1/demo-tasks/{taskId}/history");
            Assert.Equal(1, history.GetProperty("data").GetArrayLength());
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
                ["Demo:TaskFile"] = File_,
                ["Demo:OperationLedgerFile"] = Path.Combine(folder, "ledger.json"),
            });
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();
        return app;
    }
}
