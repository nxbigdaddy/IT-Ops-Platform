using System.Text.Json.Serialization;

namespace OpsPlatform.Api.Ai;

/// <summary>Text-only local contract input. System may be empty; User and Model may not.</summary>
public sealed record AiDraftRequest(string Model, string System, string User, int MaxTokens, double Temperature);

public sealed record AiTokenUsage(int InputTokens, int OutputTokens, int TotalTokens);

/// <summary>
/// Parsed fixture data only, never evidence of a live model invocation.
/// Any future live transport must use a separate result contract, not reuse this synthetic result.
/// </summary>
public sealed record AiDraftResult(string Protocol, string Text, AiTokenUsage Usage, string StopReason)
{
    [JsonPropertyName("synthetic")]
    public bool Synthetic => true;
    [JsonPropertyName("testOnly")]
    public bool TestOnly => true;
}

public sealed record AiProtocolMetadata(string Protocol)
{
    [JsonPropertyName("status")]
    public string Status => "implemented-contract-only";
    [JsonPropertyName("verifiedWithFixture")]
    public bool VerifiedWithFixture => true;
    [JsonPropertyName("liveVerified")]
    public bool LiveVerified => false;
    public string Scope => "Text-only non-streaming local fixtures; not a claim of vendor-wide compatibility.";
}

public static class AiProtocolLimits
{
    public const int MaxModelCharacters = 128;
    public const int MaxMessageCharacters = 32_768;
    public const int MaxCombinedInputCharacters = 49_152;
    public const int MaxTokens = 32_768;
    public const int MaxResponseBytes = 262_144;
    public const int MaxOutputCharacters = 65_536;
    public const int MaxUsageTokens = 10_000_000;
}

/// <summary>Safe error codes only: never includes submitted prompts or response contents.</summary>
public sealed class AiProtocolException(string code) : ArgumentException(code)
{
    public string Code { get; } = code;
}
