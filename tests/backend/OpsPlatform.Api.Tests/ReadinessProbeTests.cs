using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Xunit;
namespace OpsPlatform.Api.Tests;
// Readiness must stay negative and must explain why, component by component, without leaking paths.
public sealed class ReadinessProbeTests
{
    [Fact] public void MemoryModeReportsMissingPersistenceAsABlocker()
    {
        var report = OpsPlatform.Api.Persistence.ReadinessProbe.Evaluate(null, true);
        Assert.False(report.Ready);
        Assert.Equal("notReady", report.Status);
        Assert.Contains(report.Checks, check => check.Name == "persistence" && check.Status == "notConfigured" && !check.Verified);
        Assert.Contains(report.Blockers, blocker => blocker.Contains("未配置任何持久化存储", StringComparison.Ordinal));
        // Authentication, migrations and the network posture are always negative in this prototype.
        Assert.All(new[] { "authentication", "migrations", "externalNetwork" }, name =>
        {
            var check = report.Checks.Single(candidate => candidate.Name == name);
            Assert.False(check.Verified, name);
            Assert.False(string.IsNullOrWhiteSpace(check.Detail), name);
        });
        Assert.Contains(report.Blockers, blocker => blocker.Contains("身份认证", StringComparison.Ordinal));
        Assert.Contains(report.Blockers, blocker => blocker.Contains("迁移", StringComparison.Ordinal));
        Assert.Contains("永远为否", report.Note);
    }
    [Fact] public void RelationalModeCanProbeTheDatabaseAndIsStillNotReady()
    {
        var folder = Path.Combine(Path.GetTempPath(), $"ops-demo-ready-{Guid.NewGuid():N}");
        var database = Path.Combine(folder, "demo.db");
        try
        {
            Directory.CreateDirectory(folder);
            using (var context = new OpsPlatform.Api.Persistence.Relational.OpsPlatformDbContext(OpsPlatform.Api.Persistence.Relational.OpsPlatformDbContext.OptionsFor(database)))
                context.Database.EnsureCreated();
            var reachable = OpsPlatform.Api.Persistence.ReadinessProbe.Evaluate(database, true);
            Assert.False(reachable.Ready);
            var check = reachable.Checks.Single(candidate => candidate.Name == "persistence");
            Assert.Equal("demoDatabaseReachable", check.Status);
            Assert.True(check.Verified);
            // Reachability never turns into readiness, and the detail never contains the path.
            Assert.Contains(reachable.Blockers, blocker => blocker.Contains("不是生产存储", StringComparison.Ordinal));
            Assert.DoesNotContain(database, JsonSerializer.Serialize(reachable));
            Assert.DoesNotContain("demo.db", JsonSerializer.Serialize(reachable));
            // An unusable path is reported as unavailable rather than as an exception.
            var broken = OpsPlatform.Api.Persistence.ReadinessProbe.Evaluate(Path.Combine(folder, "missing", "demo.db"), true);
            Assert.False(broken.Ready);
            Assert.False(broken.Checks.Single(candidate => candidate.Name == "persistence").Verified);
            Assert.DoesNotContain("原始错误正文", JsonSerializer.Serialize(broken.Checks).Replace("不展示原始错误正文", string.Empty));
        }
        finally { try { if (Directory.Exists(folder)) Directory.Delete(folder, true); } catch (IOException) { } }
    }
    [Fact] public async Task TheRouteAnswers503WithBlockersAndInBothModes()
    {
        await using (var app = Start(null, "Development", true))
        {
            using var client = app.GetTestClient();
            var response = await client.GetAsync("/health/ready");
            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
            var body = JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());
            Assert.Equal("notReady", body.GetProperty("status").GetString());
            Assert.False(body.GetProperty("ready").GetBoolean());
            Assert.True(body.GetProperty("checks").GetArrayLength() >= 5);
            Assert.True(body.GetProperty("blockers").GetArrayLength() >= 3);
            Assert.True(body.GetProperty("isDemo").GetBoolean());
            Assert.Equal("alive", (await client.GetStringAsync("/health/live")).Contains("alive") ? "alive" : "dead");
        }
        await using (var app = Start(null, "Production", false))
        {
            using var client = app.GetTestClient();
            var response = await client.GetAsync("/health/ready");
            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
            var body = JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync());
            Assert.Equal("closed", body.GetProperty("checks").EnumerateArray().Single(check => check.GetProperty("name").GetString() == "demoApi").GetProperty("status").GetString());
        }
    }
    private static WebApplication Start(string? databasePath, string environment, bool demo)
    {
        var app = AppBootstrap.Build([], builder =>
        {
            builder.Environment.EnvironmentName = environment;
            builder.Configuration.Sources.Clear();
            var settings = new Dictionary<string, string?> { ["Demo:Enabled"] = demo.ToString() };
            if (databasePath is not null) settings["Demo:SqlitePath"] = databasePath;
            builder.Configuration.AddInMemoryCollection(settings);
            builder.WebHost.UseTestServer();
        });
        app.StartAsync().GetAwaiter().GetResult();
        return app;
    }
}
