using System.Net;
using System.Text.RegularExpressions;

namespace OpsPlatform.Api.Ai;

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record AiConnectionDraft(
    [property: System.Text.Json.Serialization.JsonRequired] string Provider,
    [property: System.Text.Json.Serialization.JsonRequired] string Endpoint,
    [property: System.Text.Json.Serialization.JsonRequired] string Model,
    [property: System.Text.Json.Serialization.JsonRequired] string SecretReference,
    [property: System.Text.Json.Serialization.JsonRequired] int TimeoutSeconds,
    [property: System.Text.Json.Serialization.JsonRequired] int MaxOutputTokens,
    [property: System.Text.Json.Serialization.JsonRequired] int RequestBudgetTokens);
public sealed record AiConfigurationError(string Field, string Code);
public sealed record AiConfigurationCheck(IReadOnlyList<AiConfigurationError> Errors)
{
    public bool ConfigurationValid => Errors.Count == 0;
    public bool NetworkVerified => false;
    public bool LiveCallEnabled => false;
}

// Offline preflight only. DNS resolution, IP pinning, TLS, redirects and secret access are NOT implemented.
public static partial class AiConnectionPolicy
{
    public static AiConfigurationCheck Check(AiConnectionDraft? draft, IReadOnlyCollection<string>? approvedHosts)
    {
        var errors = new List<AiConfigurationError>();
        void Reject(string field, string code) => errors.Add(new(field, code));
        if (draft is null) return new(new[] { new AiConfigurationError("configuration", "required") });
        if (!AiProtocols.IsAccepted(draft.Provider)) Reject("provider", "unsupported");
        if (string.IsNullOrWhiteSpace(draft.Model) || draft.Model.Length > 128 || draft.Model.Any(char.IsControl)) Reject("model", "invalid");
        // Reserved synthetic names only; a real vendor model id must not enter the prototype.
        else if (!AiProtocols.IsReservedDemoModel(draft.Model)) Reject("model", "not_reserved_demo_model");
        if (draft.SecretReference is null || !SecretPattern().IsMatch(draft.SecretReference)) Reject("secretReference", "reference_required");
        if (draft.TimeoutSeconds is < 1 or > 60) Reject("timeoutSeconds", "out_of_range");
        if (draft.MaxOutputTokens is < 1 or > 32768) Reject("maxOutputTokens", "out_of_range");
        if (draft.RequestBudgetTokens < draft.MaxOutputTokens || draft.RequestBudgetTokens is < 1 or > 1000000) Reject("requestBudgetTokens", "out_of_range");
        var raw = draft.Endpoint;
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > 2048 || raw.Any(c => char.IsControl(c) || char.IsWhiteSpace(c))
            || raw.Contains('\\') || raw.Contains('%') || raw.Contains('?') || raw.Contains('#')
            || !Uri.TryCreate(raw, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps || uri.Port != 443 || uri.UserInfo.Length != 0
            || !ValidHost(uri.Host)) Reject("endpoint", "invalid_https_endpoint");
        else if (approvedHosts is null || !approvedHosts.Any(host => ValidHost(host) && string.Equals(host, uri.Host, StringComparison.OrdinalIgnoreCase)))
            Reject("endpoint", "host_not_approved");
        return new(errors.ToArray());
    }

    private static bool ValidHost(string? host)
    {
        if (string.IsNullOrEmpty(host) || host.Length > 253 || !host.Contains('.') || host.EndsWith('.')
            || host.EndsWith(".local", StringComparison.OrdinalIgnoreCase) || host.EndsWith(".internal", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase) || IPAddress.TryParse(host, out _)
            || Uri.CheckHostName(host) != UriHostNameType.Dns) return false;
        return host.Split('.').All(label => HostLabel().IsMatch(label));
    }
    [GeneratedRegex(@"\Asecret://ai/[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\z")]
    private static partial Regex SecretPattern();
    [GeneratedRegex(@"\A[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\z")]
    private static partial Regex HostLabel();
}
