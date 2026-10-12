using System.Text.RegularExpressions;
using OpsPlatform.Api.Contracts;

namespace OpsPlatform.Api.Configuration;

public sealed record DatabaseCapability(DatabaseProvider Provider, string Name, bool PackageAvailable,
    bool SingleInstanceOnly, string[] RequiredVerification)
{
    public bool AdapterImplemented => false;
    public bool LiveVerified => false;
    public bool ProductionEnabled => false;
}
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record DatabaseDeploymentDraft(
    [property: System.Text.Json.Serialization.JsonRequired] DatabaseProvider Provider,
    [property: System.Text.Json.Serialization.JsonRequired] string Host,
    [property: System.Text.Json.Serialization.JsonRequired] string SecretReference,
    [property: System.Text.Json.Serialization.JsonRequired] int ApiInstances,
    [property: System.Text.Json.Serialization.JsonRequired] int WorkerInstances,
    [property: System.Text.Json.Serialization.JsonRequired] bool AutomaticFallback);
public sealed record DatabasePreflightError(string Field, string Code);
public sealed record DatabasePreflight(IReadOnlyList<DatabasePreflightError> Errors, DatabaseCapability? Candidate = null)
{
    public bool ConfigurationValid => Errors.Count == 0;
    public bool ConnectionAttempted => false;
    public bool ProductionReady => false;
}

// Platform persistence candidates, NOT the catalog of monitored database targets.
public sealed record DatabaseProviderValue(int Value,string Name,string DisplayName);
public static partial class DatabaseCapabilities
{
    public static IReadOnlyList<DatabaseCapability> List() => new DatabaseCapability[]
    {
        new(DatabaseProvider.PostgreSQL, "PostgreSQL", true, false, ["migrations", "jsonb", "skip-locked-leases", "backup-restore"]),
        new(DatabaseProvider.SqlServer, "SQL Server", false, false, ["provider-package", "migrations", "locking-hints", "backup-restore"]),
        new(DatabaseProvider.Sqlite, "SQLite", false, true, ["provider-package", "migrations", "single-writer", "file-backup"]),
        new(DatabaseProvider.MySql, "MySQL", false, false, ["provider-package", "migrations", "collation", "locking-leases", "backup-restore"])
    };

    public static IReadOnlyList<DatabaseProviderValue> ProviderValues() => List()
        .Select(c => new DatabaseProviderValue((int)c.Provider, c.Provider.ToString(), c.Name))
        .OrderBy(item => item.Value).ToArray();

    public static IReadOnlyList<ProviderDto> DemoProviders() => List().Select(c => new ProviderDto(
        c.Provider.ToString(), c.Name, "planned", true, c.AdapterImplemented, c.LiveVerified, c.PackageAvailable, false,
        $"平台数据库候选，非监控目标连接器；{(c.PackageAvailable ? "依赖包已声明但无业务适配" : "适配包尚未安装")}。生产拒绝启用；必测：{string.Join(", ", c.RequiredVerification)}。"
    )).ToArray();

    public static DatabasePreflight ValidateDraft(DatabaseDeploymentDraft? draft)
    {
        var errors = new List<DatabasePreflightError>();
        if (draft is null) return new(new[] { new DatabasePreflightError("configuration", "required") });
        if (!Enum.IsDefined(draft.Provider)) errors.Add(new("provider", "unsupported"));
        // Same documentation-only policy as collection targets: no real database host may enter the prototype.
        if (!ConnectorTargetScope.IsNormalizedDocumentationTarget(draft.Host)) errors.Add(new("host", "not_documentation_target"));
        if (draft.SecretReference is null || !ReferencePattern().IsMatch(draft.SecretReference)) errors.Add(new("secretReference", "reference_required"));
        if (draft.ApiInstances is < 1 or > 32) errors.Add(new("apiInstances", "out_of_range"));
        if (draft.WorkerInstances is < 0 or > 128) errors.Add(new("workerInstances", "out_of_range"));
        if (draft.AutomaticFallback) errors.Add(new("automaticFallback", "forbidden"));
        if (draft.Provider == DatabaseProvider.Sqlite && (draft.ApiInstances != 1 || draft.WorkerInstances > 1))
            errors.Add(new("topology", "sqlite_single_instance_only"));
        // Candidate facts are preconditions to verify, never completed verification.
        var candidate = Enum.IsDefined(draft.Provider) ? List().SingleOrDefault(item => item.Provider == draft.Provider) : null;
        return new(errors.ToArray(), candidate);
    }

    [GeneratedRegex(@"\Asecret://database/[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\z")]
    private static partial Regex ReferencePattern();
}
