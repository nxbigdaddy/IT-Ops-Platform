using System.Net;
using Microsoft.EntityFrameworkCore;

namespace OpsPlatform.Api.Persistence.Relational;

public sealed record RelationalMode(string Provider, string ConnectionString, string Source)
{
    public bool IsPostgres => Provider == "postgres";
}
// Chooses the relational provider and refuses any connection target that is not loopback or a documentation
// address. The prototype must never be pointed at a real database: the Demo may attempt a TCP connect, but only
// to an address that cannot be a production system.
public static class RelationalModeSelector
{
    public static readonly string[] DocumentationPrefixes = ["192.0.2.", "198.51.100.", "203.0.113."];
    public static RelationalMode? Select(string? sqlitePath, string? postgresConnection)
    {
        if (!string.IsNullOrWhiteSpace(postgresConnection))
        {
            if (!IsAllowedTarget(postgresConnection)) return null;
            return new("postgres", postgresConnection.Trim(), "Demo:PostgresConnection");
        }
        if (!string.IsNullOrWhiteSpace(sqlitePath)) return new("sqlite", $"Data Source={Path.GetFullPath(sqlitePath)}", "Demo:SqlitePath");
        return null;
    }
    // Accepts only loopback hosts, documentation networks or reserved .invalid/.example names.
    public static bool IsAllowedTarget(string connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString)) return false;
        var host = HostOf(connectionString);
        if (host is null) return false;
        if (host is "localhost" or "127.0.0.1" or "::1" or "[::1]") return true;
        if (host.EndsWith(".invalid", StringComparison.OrdinalIgnoreCase) || host.EndsWith(".example", StringComparison.OrdinalIgnoreCase)) return true;
        if (DocumentationPrefixes.Any(prefix => host.StartsWith(prefix, StringComparison.Ordinal))) return true;
        return IPAddress.TryParse(host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address);
    }
    private static string? HostOf(string connectionString)
    {
        foreach (var part in connectionString.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var separator = part.IndexOf('=');
            if (separator <= 0) continue;
            var key = part[..separator].Trim();
            if (key.Equals("Host", StringComparison.OrdinalIgnoreCase) || key.Equals("Server", StringComparison.OrdinalIgnoreCase)
                || key.Equals("Data Source", StringComparison.OrdinalIgnoreCase))
                return part[(separator + 1)..].Trim();
        }
        return null;
    }
    public static DbContextOptions<OpsPlatformDbContext> OptionsFor(RelationalMode mode)
    {
        ArgumentNullException.ThrowIfNull(mode);
        var builder = new DbContextOptionsBuilder<OpsPlatformDbContext>();
        if (mode.IsPostgres) builder.UseNpgsql(mode.ConnectionString);
        else builder.UseSqlite(mode.ConnectionString);
        return builder.Options;
    }
}
