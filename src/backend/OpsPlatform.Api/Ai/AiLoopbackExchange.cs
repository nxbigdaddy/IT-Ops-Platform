using System.Text.Json.Serialization;

namespace OpsPlatform.Api.Ai;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AiLoopbackExchangeDraft(
    [property: JsonRequired] string? Protocol,
    [property: JsonRequired] string? Model,
    [property: JsonRequired] string? System,
    [property: JsonRequired] string? User,
    [property: JsonRequired] int? MaxTokens,
    [property: JsonRequired] double? Temperature,
    // Optional override; when absent the server calls its own loopback stub endpoint.
    string? Endpoint = null,
    string? StubBehaviour = null);
public sealed record AiLoopbackExchangeResult(
    string Status,
    string? Code,
    int HttpStatus,
    int ResponseBytes,
    long ElapsedMilliseconds,
    string? Text,
    AiTokenUsage? Usage,
    string? StopReason,
    // Exactly what the adapter transmitted (synthetic content only), so "no credential" is checkable.
    string SentRequestJson)
{
    public bool LoopbackOnly => true;
    public bool CredentialRead => false;
    public bool ProductionTransportImplemented => false;
    public bool SyntheticStubOnly => true;
    public string Notes => "只与本机回环桩端点通信；请求内容为合成文本，不读取凭据，也不发往任何真实提供方。";
}
public static class AiLoopbackExchange
{
    // The server talks to its own Demo-gated stub route unless the caller supplies another loopback endpoint.
    public static string DefaultStubEndpoint(int localPort, string behaviour = AiLoopbackStub.DefaultBehaviour) => $"http://127.0.0.1:{localPort}/api/v1/ai-loopback-stub/{behaviour}";
    public static AiDraftRequest? ToDraft(AiLoopbackExchangeDraft? draft, out string? code)
    {
        code = null;
        if (draft is null) { code = "configuration_required"; return null; }
        if (!AiProtocols.IsAccepted(draft.Protocol)) { code = "unsupported_protocol"; return null; }
        if (draft.StubBehaviour is not null && !AiLoopbackStub.IsBehaviour(draft.StubBehaviour)) { code = "stub_unknown_behaviour"; return null; }
        if (!AiProtocols.IsReservedDemoModel(draft.Model)) { code = "demo_model_required"; return null; }
        if (draft.MaxTokens is not { } maxTokens || maxTokens is < 1 or > AiProtocolLimits.MaxTokens) { code = "invalid_max_tokens"; return null; }
        if (draft.Temperature is not { } temperature || !double.IsFinite(temperature) || temperature < 0
            || temperature > (draft.Protocol == AiProtocols.Anthropic ? 1 : 2)) { code = "invalid_temperature"; return null; }
        if (string.IsNullOrWhiteSpace(draft.User) || draft.User.Length > AiProtocolLimits.MaxMessageCharacters
            || draft.System is null || draft.System.Length > AiProtocolLimits.MaxMessageCharacters
            || draft.System.Length + draft.User.Length > AiProtocolLimits.MaxCombinedInputCharacters)
        { code = "invalid_input_length"; return null; }
        // A caller-supplied endpoint must itself be loopback; the transport re-checks this before connecting.
        if (draft.Endpoint is not null && !LoopbackModelTransport.IsLoopbackEndpoint(draft.Endpoint)) { code = "endpoint_not_loopback"; return null; }
        return new AiDraftRequest(draft.Model!, draft.System, draft.User, maxTokens, temperature);
    }
}
