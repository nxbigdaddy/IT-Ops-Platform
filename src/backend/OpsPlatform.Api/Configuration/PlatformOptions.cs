namespace OpsPlatform.Api.Configuration;

public enum DatabaseProvider { PostgreSQL, SqlServer, Sqlite, MySql }

public sealed class PlatformOptions
{
    public bool DemoEnabled { get; init; }
    public DatabaseProvider? Provider { get; init; }
    // A non-secret reference only. Never resolve it or load credentials in this prototype.
    public bool HasConnectionReference { get; init; }
    public bool IsDemo(string environment) => DemoEnabled && environment == "Development";

    public static PlatformOptions Read(IConfiguration configuration, string environment)
    {
        var enabled = configuration.GetValue<bool>("Demo:Enabled");
        if (enabled && environment != "Development")
            throw new InvalidOperationException("Demo mode is permitted only in Development.");

        var rawProvider = configuration["Database:Provider"];
        DatabaseProvider? provider = null;
        if (!string.IsNullOrWhiteSpace(rawProvider))
        {
            if (!Enum.TryParse<DatabaseProvider>(rawProvider, true, out var parsed)
                || !Enum.IsDefined(parsed) || int.TryParse(rawProvider, out _))
                throw new InvalidOperationException("Database:Provider must be PostgreSQL, SqlServer, Sqlite or MySql.");
            provider = parsed;
        }
        if (!enabled && provider.HasValue)
            throw new InvalidOperationException("No production database adapter is implemented, including PostgreSQL. Non-Demo database configuration is rejected; no fallback is available.");

        return new PlatformOptions
        {
            DemoEnabled = enabled,
            Provider = provider,
            HasConnectionReference = !string.IsNullOrWhiteSpace(configuration["Database:ConnectionStringReference"])
        };
    }
}
