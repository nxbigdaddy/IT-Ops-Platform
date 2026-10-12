using Microsoft.EntityFrameworkCore;
using OpsPlatform.Api.Persistence.Relational;
using Xunit;
namespace OpsPlatform.Api.Tests;
// Provider selection: the same stores run over SQLite or PostgreSQL, and the connection target must be loopback
// or a documentation address so the prototype can never be aimed at a real database.
public sealed class RelationalModeSelectorTests
{
    [Fact] public void NoConfigurationMeansNoRelationalMode()
    {
        Assert.Null(RelationalModeSelector.Select(null, null));
        Assert.Null(RelationalModeSelector.Select("  ", ""));
    }
    [Fact] public void SqliteIsSelectedFromAPathAndPostgresFromAConnectionString()
    {
        var sqlite = RelationalModeSelector.Select("artifacts/demo.db", null)!;
        Assert.Equal("sqlite", sqlite.Provider);
        Assert.StartsWith("Data Source=", sqlite.ConnectionString);
        Assert.Equal("Demo:SqlitePath", sqlite.Source);
        Assert.False(sqlite.IsPostgres);
        var postgres = RelationalModeSelector.Select(null, "Host=192.0.2.10;Database=opsdemo;Username=demo;Password=demo")!;
        Assert.Equal("postgres", postgres.Provider);
        Assert.True(postgres.IsPostgres);
        Assert.Equal("Demo:PostgresConnection", postgres.Source);
        // PostgreSQL wins when both are configured, and no option is built without a validated target.
        Assert.Equal("postgres", RelationalModeSelector.Select("artifacts/demo.db", "Host=127.0.0.1;Database=opsdemo")!.Provider);
        Assert.Null(RelationalModeSelector.Select(null, "Host=db.internal;Database=opsdemo"));
    }
    [Theory]
    [InlineData("Host=localhost;Database=opsdemo", true)]
    [InlineData("Host=127.0.0.1;Database=opsdemo", true)]
    [InlineData("Server=[::1];Database=opsdemo", true)]
    [InlineData("Host=192.0.2.10;Database=opsdemo", true)]
    [InlineData("Host=198.51.100.7;Database=opsdemo", true)]
    [InlineData("Host=203.0.113.9;Database=opsdemo", true)]
    [InlineData("Host=db.example;Database=opsdemo", true)]
    [InlineData("Host=db.internal.invalid;Database=opsdemo", true)]
    [InlineData("Data Source=/tmp/demo.db", false)]
    [InlineData("Host=10.0.0.5;Database=opsdemo", false)]
    [InlineData("Host=db.internal;Database=opsdemo", false)]
    [InlineData("Host=prod-db.corp.example.com;Database=opsdemo", false)]
    [InlineData("Host=203.0.114.9;Database=opsdemo", false)]
    [InlineData("Database=opsdemo", false)]
    [InlineData("", false)]
    public void OnlyLoopbackOrDocumentationTargetsAreAccepted(string connectionString, bool allowed) =>
        Assert.Equal(allowed, RelationalModeSelector.IsAllowedTarget(connectionString));
    [Fact] public void ProviderSelectionBuildsOptionsWithoutConnecting()
    {
        // ProviderName is read from the built options without opening a connection.
        using (var sqliteContext = new OpsPlatformDbContext(RelationalModeSelector.OptionsFor(RelationalModeSelector.Select("artifacts/demo.db", null)!)))
            Assert.Contains("Sqlite", sqliteContext.Database.ProviderName);
        using (var postgresContext = new OpsPlatformDbContext(RelationalModeSelector.OptionsFor(RelationalModeSelector.Select(null, "Host=192.0.2.10;Database=opsdemo")!)))
            Assert.Contains("Npgsql", postgresContext.Database.ProviderName);
    }
    [Fact] public void ReadinessNamesTheProviderAndStaysNegativeForAnUnreachableTarget()
    {
        // A documentation address never hosts a database, so the probe must report it as unreachable rather
        // than throwing, and must not echo the connection string.
        var report = OpsPlatform.Api.Persistence.ReadinessProbe.Evaluate(null, "Host=192.0.2.10;Database=opsdemo;Username=demo;Password=demo", true);
        Assert.False(report.Ready);
        var persistence = report.Checks.Single(check => check.Name == "persistence");
        Assert.False(persistence.Verified);
        Assert.Contains("postgres", persistence.Detail);
        var serialized = System.Text.Json.JsonSerializer.Serialize(report);
        Assert.DoesNotContain("Password", serialized, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("192.0.2.10", serialized);
        // A disallowed target is refused outright: the mode selector returns null, so readiness reports the
        // same "no persistence configured" state as memory mode.
        var refused = OpsPlatform.Api.Persistence.ReadinessProbe.Evaluate(null, "Host=db.internal;Database=opsdemo", true);
        Assert.Equal("notConfigured", refused.Checks.Single(check => check.Name == "persistence").Status);
        Assert.Contains(refused.Blockers, blocker => blocker.Contains("未配置任何持久化存储", StringComparison.Ordinal));
    }
}
