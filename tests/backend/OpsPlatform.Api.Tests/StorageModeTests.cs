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
public sealed class StorageModeTests
{
    [Fact] public void ReportDescribesEveryPortWithoutClaimingDurability()
    {
        var memory = StorageModeCatalog.Report(false, false, false);
        Assert.Equal(4, memory.Ports.Count);
        Assert.All(memory.Ports, entry =>
        {
            Assert.Equal("memory", entry.Implementation);
            Assert.False(entry.ConfiguredByFile);Assert.False(entry.Durable);Assert.False(entry.ProductionReady);
            Assert.NotEmpty(entry.Limits);
        });
        Assert.False(memory.AnyDurable);Assert.False(memory.ProductionReady);
        var configured = StorageModeCatalog.Report(true, true, true);
        Assert.All(configured.Ports.Take(3), entry => Assert.Equal("development-file", entry.Implementation));
        // Even with every file configured, the report must not claim durability or production readiness.
        Assert.All(configured.Ports, entry => Assert.False(entry.Durable));
        Assert.False(configured.ProductionReady);
        Assert.Equal("memory", configured.Ports[3].Implementation);
        // A relational deployment must be reported as such, and still without a durability claim.
        var relational = StorageModeCatalog.Report(false, false, false, false, relational: true);
        Assert.All(relational.Ports, entry => Assert.Equal("sqlite", entry.Implementation));
        Assert.All(relational.Ports, entry => Assert.False(entry.Durable));
        Assert.False(relational.ProductionReady);
        Assert.Contains(relational.Ports[1].Limits, limit => limit.Contains("唯一索引", StringComparison.Ordinal));
        // The provider is reported, and a PostgreSQL configuration stays non-durable too.
        var postgres = StorageModeCatalog.Report(false, false, false, false, relational: true, provider: "postgres", postgresConfigured: true);
        Assert.All(postgres.Ports, entry => Assert.Equal("postgres", entry.Implementation));
        Assert.Contains(postgres.Ports[0].Limits, limit => limit.Contains("PostgreSQL", StringComparison.Ordinal));
        Assert.All(postgres.Ports, entry => Assert.False(entry.Durable));Assert.False(postgres.ProductionReady);
        Assert.Equal(["IDemoFeedbackStore", "IOperationLedger", "IDemoTaskStore", "IPromptCatalog"], configured.Ports.Select(entry => entry.Port).ToArray());
    }
    [Fact] public async Task RouteReportsModesWithoutExposingPaths()
    {
        var folder = Path.Combine(Path.GetTempPath(), $"ops-demo-modes-{Guid.NewGuid():N}");
        try
        {
            await using var app = AppBootstrap.Build([], builder =>
            {
                builder.Environment.EnvironmentName = "Development";
                builder.Configuration.Sources.Clear();
                builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Demo:Enabled"] = "true",
                    ["Demo:FeedbackFile"] = Path.Combine(folder, "feedback.json"),
                    ["Demo:OperationLedgerFile"] = Path.Combine(folder, "ledger.json"),
                });
                builder.WebHost.UseTestServer();
            });
            await app.StartAsync();using var client = app.GetTestClient();
            var response = await client.GetAsync("/api/v1/storage-modes");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var raw = await response.Content.ReadAsStringAsync();
            // Configured paths must never be echoed back to a client.
            Assert.DoesNotContain(folder, raw);
            Assert.DoesNotContain("feedback.json", raw);
            var body = JsonSerializer.Deserialize<JsonElement>(raw);
            Assert.True(body.GetProperty("isDemo").GetBoolean());Assert.Equal("none", body.GetProperty("persistence").GetString());
            var data = body.GetProperty("data");
            Assert.False(data.GetProperty("anyDurable").GetBoolean());Assert.False(data.GetProperty("productionReady").GetBoolean());
            var ports = data.GetProperty("ports");
            Assert.Equal(4, ports.GetArrayLength());
            Assert.Equal("development-file", ports[0].GetProperty("implementation").GetString());
            Assert.True(ports[0].GetProperty("configuredByFile").GetBoolean());
            Assert.Equal("memory", ports[2].GetProperty("implementation").GetString());
            Assert.False(ports[2].GetProperty("configuredByFile").GetBoolean());
            using var foreign = new HttpRequestMessage(HttpMethod.Get, "/api/v1/storage-modes");
            foreign.Headers.Add("Origin", "https://foreign.example.invalid");
            Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(foreign)).StatusCode);
        }
        finally { try { if (Directory.Exists(folder)) Directory.Delete(folder, true); } catch (IOException) { } }
    }
    [Fact] public async Task RouteIsClosedInProduction()
    {
        await using var app = AppBootstrap.Build([], builder =>
        {
            builder.Environment.EnvironmentName = "Production";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Demo:Enabled"] = "false" });
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await app.GetTestClient().GetAsync("/api/v1/storage-modes")).StatusCode);
    }
}
