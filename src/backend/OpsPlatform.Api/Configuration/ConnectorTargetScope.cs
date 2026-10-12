using System.Net;
using System.Text.RegularExpressions;

namespace OpsPlatform.Api.Configuration;

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record ConnectorTargetScopeDraft(
    [property: System.Text.Json.Serialization.JsonRequired] string?[]? Hosts,
    // Optional planned collection window; when supplied it must satisfy the bounded policy below.
    int? IntervalSeconds = null,
    int? Concurrency = null,
    int? TimeoutSeconds = null);
public sealed record ConnectorTargetScopeError(int Index,string Field,string Code);
public sealed record ConnectorTargetScopeCheck(IReadOnlyList<ConnectorTargetScopeError> Errors,int Accepted)
{
    public bool ConfigurationValid => Errors.Count==0;
    public bool ConnectionAttempted => false;
    public bool ExecutionAllowed => false;
    // Synthetic-only input is enforced so the prototype never carries real infrastructure addresses.
    public bool SyntheticOnly => true;
    public string Notes => "窗口参数只做区间与关系校验；不代表已排期、已限速或已接入。";
}
// Documentation-only address policy: RFC 5737 (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24),
// RFC 3849 (2001:db8::/32) and the reserved .invalid/.example names. No DNS lookup or connection.
public static partial class ConnectorTargetScope
{
    public const int MaxHosts = 50;
    public const int MaxHostLength = 253;
    public const int MinIntervalSeconds = 60;
    public const int MaxIntervalSeconds = 86400;
    public const int MinConcurrency = 1;
    public const int MaxConcurrency = 8;
    public const int MinTimeoutSeconds = 5;
    public const int MaxTimeoutSeconds = 300;
    public static ConnectorTargetScopeCheck Check(ConnectorTargetScopeDraft? draft)
    {
        if(draft?.Hosts is null) return new([new(0,"hosts","required")],0);
        if(draft.Hosts.Length is 0 or > MaxHosts) return new([new(0,"hosts","count_out_of_range")],0);
        var errors=new List<ConnectorTargetScopeError>();var seen=new HashSet<string>(StringComparer.Ordinal);var accepted=0;
        for(var index=0;index<draft.Hosts.Length;index++)
        {
            var host=draft.Hosts[index];
            if(string.IsNullOrWhiteSpace(host)) { errors.Add(new(index,"host","required")); continue; }
            if(host.Length>MaxHostLength) { errors.Add(new(index,"host","too_long")); continue; }
            if(host!=host.Trim()||host.Any(char.IsUpper)) { errors.Add(new(index,"host","normalization_required")); continue; }
            if(!Allowed(host)) { errors.Add(new(index,"host","not_documentation_target")); continue; }
            if(!seen.Add(host)) { errors.Add(new(index,"host","duplicate")); continue; }
            accepted++;
        }
        if(draft.IntervalSeconds is { } interval)
        {
            if(interval < MinIntervalSeconds || interval > MaxIntervalSeconds) errors.Add(new(0,"intervalSeconds","out_of_range"));
        }
        if(draft.Concurrency is { } concurrency)
        {
            if(concurrency < MinConcurrency || concurrency > MaxConcurrency) errors.Add(new(0,"concurrency","out_of_range"));
        }
        if(draft.TimeoutSeconds is { } timeout)
        {
            if(timeout < MinTimeoutSeconds || timeout > MaxTimeoutSeconds) errors.Add(new(0,"timeoutSeconds","out_of_range"));
            // A timeout longer than the interval would overlap collection windows.
            else if(draft.IntervalSeconds is { } window && timeout >= window) errors.Add(new(0,"timeoutSeconds","timeout_not_below_interval"));
        }
        return new(errors.ToArray(),accepted);
    }
    // Shared policy for any documentation-only host field, e.g. a database deployment draft.
    public static bool IsNormalizedDocumentationTarget(string? host) =>
        host is not null && host.Length is > 0 and <= MaxHostLength && host == host.Trim() && !host.Any(char.IsUpper) && Allowed(host);
    private static bool Allowed(string host)    {
        if(IPAddress.TryParse(host,out var address)) return DocumentationAddress(address);
        if(!Hostname().IsMatch(host)) return false;
        return host.EndsWith(".invalid",StringComparison.Ordinal)||host.EndsWith(".example",StringComparison.Ordinal);
    }
    private static bool DocumentationAddress(IPAddress address)
    {
        var bytes=address.GetAddressBytes();
        if(bytes.Length==4) return bytes[0]==192&&bytes[1]==0&&bytes[2]==2
            || bytes[0]==198&&bytes[1]==51&&bytes[2]==100
            || bytes[0]==203&&bytes[1]==0&&bytes[2]==113;
        return bytes.Length==16&&bytes[0]==0x20&&bytes[1]==0x01&&bytes[2]==0x0d&&bytes[3]==0xb8;
    }
    [GeneratedRegex(@"\A[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+\z",RegexOptions.CultureInvariant)]
    private static partial Regex Hostname();
}
