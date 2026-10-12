using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Services;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class JsonFileFeedbackStoreTests : IDisposable
{
    private readonly string folder = Path.Combine(Path.GetTempPath(), $"ops-demo-feedback-{Guid.NewGuid():N}");
    private string File_ => Path.Combine(folder, "feedback.json");
    private static FeedbackDto Record(string label) => new(Guid.NewGuid(), "bug", $"{label} 的合成反馈", "/assets", DateTimeOffset.UtcNow);
    public void Dispose()
    {
        try { if (Directory.Exists(folder)) Directory.Delete(folder, recursive: true); } catch (IOException) { }
    }
    [Fact] public void RecordsSurviveANewStoreInstance()
    {
        var first = new JsonFileFeedbackStore(File_);
        Assert.Empty(first.List());
        first.Add(Record("FB-1")); first.Add(Record("FB-2"));
        Assert.Equal(2, first.Count);
        // A new instance models a process restart: the file must still be readable.
        var second = new JsonFileFeedbackStore(File_);
        var restored = second.List();
        Assert.Equal(2, restored.Count);
        // List() returns newest first, and that order must survive the reload.
        Assert.StartsWith("FB-2", restored[0].Message);Assert.StartsWith("FB-1", restored[1].Message);
        Assert.True(File.Exists(File_));
        Assert.False(File.Exists(File_ + ".tmp"), "the temporary file must not be left behind");
    }
    [Fact] public void CapacityIsEnforcedAndNewestWins()
    {
        var store = new JsonFileFeedbackStore(File_);
        for (var index = 0; index < InMemoryDemoFeedbackStore.Capacity + 5; index++) store.Add(Record($"FB-{index:D3}"));
        Assert.Equal(InMemoryDemoFeedbackStore.Capacity, store.Count);
        var newest = store.List();
        Assert.StartsWith("FB-204", newest[0].Message);
        Assert.DoesNotContain(newest, item => item.Message.StartsWith("FB-000"));
        // The cap must also hold after a reload, not only in memory.
        Assert.Equal(InMemoryDemoFeedbackStore.Capacity, new JsonFileFeedbackStore(File_).Count);
    }
    [Theory]
    [InlineData("{not-json")]
    [InlineData("[]")]
    [InlineData("[{\"id\":\"FB-1\"}]")]
    public void DamagedFilesAreQuarantinedInsteadOfSilentlyDiscarded(string content)
    {
        Directory.CreateDirectory(folder);
        File.WriteAllText(File_, content);
        var store = new JsonFileFeedbackStore(File_);
        Assert.Empty(store.List());
        Assert.True(File.Exists(File_) is false || content == "[]", "a damaged file must be moved aside");
        var quarantined = Directory.GetFiles(folder, "feedback.json.*");
        Assert.NotEmpty(quarantined);
    }
    [Fact] public void MissingDirectoryIsCreatedAndPathIsRequired()
    {
        var nested = Path.Combine(folder, "nested", "deeper", "feedback.json");
        var store = new JsonFileFeedbackStore(nested);
        store.Add(Record("FB-1"));
        Assert.True(File.Exists(nested));
        Assert.Throws<ArgumentException>(() => new JsonFileFeedbackStore("  "));
    }
    [Fact] public async Task ConfiguredFileStoreIsUsedByTheEndpointAndStillReportsNoPersistence()
    {
        Directory.CreateDirectory(folder);
        await using (var app = AppBootstrap.Build([], builder =>
        {
            builder.Environment.EnvironmentName = "Development";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Demo:Enabled"] = "true",
                ["Demo:FeedbackFile"] = File_,
            });
            builder.WebHost.UseTestServer();
        }))
        {
            await app.StartAsync();using var client = app.GetTestClient();
            var created = await client.PostAsJsonAsync("/api/v1/feedback", new FeedbackRequest("bug", "仅自动化验证的合成反馈", "/assets", null));
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
            var body = await created.Content.ReadFromJsonAsync<JsonElement>();
            // The response must not claim durable persistence even though a file now exists.
            Assert.Equal("memory", body.GetProperty("persistence").GetString());
            var list = await client.GetFromJsonAsync<JsonElement>("/api/v1/feedback");
            Assert.Equal("仅自动化验证的合成反馈", list.GetProperty("data")[0].GetProperty("message").GetString());
        }
        // A second host on the same file proves the record outlived the first process.
        await using (var app = AppBootstrap.Build([], builder =>
        {
            builder.Environment.EnvironmentName = "Development";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Demo:Enabled"] = "true",
                ["Demo:FeedbackFile"] = File_,
            });
            builder.WebHost.UseTestServer();
        }))
        {
            await app.StartAsync();using var client = app.GetTestClient();
            var list = await client.GetFromJsonAsync<JsonElement>("/api/v1/feedback");
            Assert.Equal(1, list.GetProperty("data").GetArrayLength());
            Assert.Equal(HttpStatusCode.ServiceUnavailable, (await app.GetTestClient().GetAsync("/health/ready")).StatusCode);
        }
    }
}
