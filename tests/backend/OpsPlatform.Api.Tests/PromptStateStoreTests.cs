using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Persistence;
using OpsPlatform.Api.Services;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class PromptStateStoreTests : IDisposable
{
    private readonly string folder = Path.Combine(Path.GetTempPath(), $"ops-demo-prompts-{Guid.NewGuid():N}");
    private string File_ => Path.Combine(folder, "prompts.json");
    private const string Template = "根据 {{asset_name}} 的 {{alert_summary}} 区分事实与假设；无依据时明确无法确认，不执行操作。";
    public void Dispose()
    {
        try { if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true); } catch (IOException) { }
    }
    [Fact] public void StoredStateIsAppliedToTheService()
    {
        var store = new JsonFilePromptStateStore(File_);
        store.Save([new PromptStateEntry("alert-explanation", [new PromptStateVersion(5, "恢复自存储的内容", DateTimeOffset.UtcNow, 2)], [])]);
        var service = new PromptService(store);
        var prompt = service.Get("alert-explanation")!;
        Assert.Equal(5, prompt.CurrentVersion);
        Assert.Equal("恢复自存储的内容", prompt.Content);
        Assert.Equal(5, prompt.Versions[0].Version);
    }
    [Fact] public void StoreRoundTripsWithoutQuarantine()
    {
        var store = new JsonFilePromptStateStore(File_);
        Assert.Null(store.Load());
        store.Save([new PromptStateEntry("alert-explanation", [new PromptStateVersion(2, "跨进程草稿", DateTimeOffset.UtcNow, 1)], [])]);
        var loaded = store.Load();
        Assert.NotNull(loaded);
        Assert.Single(loaded!);
        Assert.Equal(2, loaded[0].Versions[0].Version);
        Assert.Equal("跨进程草稿", loaded[0].Versions[0].Content);
        Assert.Equal(1, loaded[0].Versions[0].SourceVersion);
        Assert.DoesNotContain(Directory.GetFiles(folder).Select(Path.GetFileName), name => name!.Contains("prompts.json.", StringComparison.Ordinal));
    }
    [Fact] public void VersionsAndPublishedRevisionsSurviveANewInstance()
    {
        var first = new PromptService(new JsonFilePromptStateStore(File_));
        var initial = first.Get("alert-explanation")!;
        Assert.Equal(1, initial.CurrentVersion);
        Assert.Equal(201, first.AddVersion("alert-explanation", new PromptVersionRequest(Template + "（本地补充）", 1)).StatusCode);
        Assert.Equal(201, first.Publish("alert-explanation", new PromptPublishRequest(2, "approval://prompt/demo/2", "演示审批人")).StatusCode);
        // A new instance models a process restart: draft version and published revision must both be intact.
        var persisted = new JsonFilePromptStateStore(File_).Load();
        Assert.NotNull(persisted);
        Assert.Equal(2, persisted!.Single(entry => entry.Id == "alert-explanation").Versions[^1].Version);
        var second = new PromptService(new JsonFilePromptStateStore(File_));
        var restored = second.Get("alert-explanation")!;
        Assert.Equal(2, restored.CurrentVersion);
        Assert.EndsWith("（本地补充）", restored.Content);
        Assert.Single(restored.Published);
        // The published revision carries its own number (1) and records the draft version it came from (2).
        Assert.Equal(1, restored.PublishedVersion);
        Assert.Equal(2, restored.Published[0].PublishedFrom);
        // The immutable publish rule must still hold after a reload: the same draft cannot be published twice.
        Assert.Equal(409, second.Publish("alert-explanation", new PromptPublishRequest(2, "approval://prompt/demo/3", "演示审批人")).StatusCode);
        // Untouched prompts keep their seeded content.
        Assert.Equal(1, second.Get("ticket-summary")!.CurrentVersion);
        Assert.False(File.Exists(File_ + ".tmp"), "the temporary file must not be left behind");
    }
    [Fact] public void SchemasStayCodeOwnedAndUnknownIdsAreIgnored()
    {
        var store = new JsonFilePromptStateStore(File_);
        store.Save([
            new PromptStateEntry("alert-explanation",[new PromptStateVersion(1, "注入的变量 {{injected_secret_variable}}", DateTimeOffset.UtcNow, null)],[]),
            new PromptStateEntry("not-a-real-prompt",[new PromptStateVersion(1, "未知提示词", DateTimeOffset.UtcNow, null)],[]),
        ]);
        var service = new PromptService(store);
        var prompt = service.Get("alert-explanation")!;
        // Content is restored, but the allowed variables still come from code, never from the file.
        Assert.Equal(["asset_name", "alert_summary", "severity"], prompt.Variables);
        Assert.Equal(1, prompt.CurrentVersion);
        Assert.DoesNotContain("injected_secret_variable", prompt.Variables);
        // A stored version whose content violates the current placeholder rules is still refused on edit.
        var rejected = service.AddVersion("alert-explanation", new PromptVersionRequest("使用 {{injected_secret_variable}}", 1));
        Assert.Equal(400, rejected.StatusCode);
        Assert.NotNull(rejected.Errors);
        // Unknown ids are not revived by the store.
        Assert.Null(service.Get("not-a-real-prompt"));
        Assert.Equal(3, service.List().Count);
    }
    [Theory]
    [InlineData("{not-json")]
    [InlineData("[{\"id\":\"alert-explanation\",\"versions\":[],\"published\":[]}]")]
    [InlineData("[{\"id\":\"alert-explanation\",\"versions\":[{\"version\":0,\"content\":\"x\",\"createdAt\":\"2026-10-10T00:00:00+00:00\",\"sourceVersion\":null}],\"published\":[]}]")]
    public void DamagedFilesAreQuarantinedAndSeedsRemain(string content)
    {
        Directory.CreateDirectory(folder);
        File.WriteAllText(File_, content);
        var service = new PromptService(new JsonFilePromptStateStore(File_));
        Assert.Equal(1, service.Get("alert-explanation")!.CurrentVersion);
        Assert.Equal(Template, service.Get("alert-explanation")!.Content);
        Assert.NotEmpty(Directory.GetFiles(folder, "prompts.json.*"));
    }
    [Fact] public async Task ConfiguredStateFileKeepsDraftsAcrossHostsAndIsReported()
    {
        Directory.CreateDirectory(folder);
        await using (var app = await Start())
        {
            using var client = app.GetTestClient();
            var added = await client.PostAsJsonAsync("/api/v1/prompts/alert-explanation/versions", new PromptVersionRequest(Template + "（跨进程）", 1));
            Assert.Equal(HttpStatusCode.Created, added.StatusCode);
            Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/v1/prompts/alert-explanation/publish", new PromptPublishRequest(2, "approval://prompt/demo/2", "演示审批人"))).StatusCode);
        }
        await using (var app = await Start())
        {
            using var client = app.GetTestClient();
            var prompt = await client.GetFromJsonAsync<JsonElement>("/api/v1/prompts/alert-explanation");
            Assert.Equal(2, prompt.GetProperty("data").GetProperty("currentVersion").GetInt32());
            Assert.Equal(1, prompt.GetProperty("data").GetProperty("publishedVersion").GetInt32());
            // The storage-mode view must now report the prompt state as file backed, still without claiming durability.
            var modes = await client.GetFromJsonAsync<JsonElement>("/api/v1/storage-modes");
            var ports = modes.GetProperty("data").GetProperty("ports");
            Assert.Equal("development-file", ports[3].GetProperty("implementation").GetString());
            Assert.True(ports[3].GetProperty("configuredByFile").GetBoolean());
            Assert.False(ports[3].GetProperty("durable").GetBoolean());
            Assert.False(modes.GetProperty("data").GetProperty("productionReady").GetBoolean());
            var raw = await (await client.GetAsync("/api/v1/storage-modes")).Content.ReadAsStringAsync();
            Assert.DoesNotContain(folder, raw);
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
                ["Demo:PromptStateFile"] = File_,
            });
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();
        return app;
    }
}
