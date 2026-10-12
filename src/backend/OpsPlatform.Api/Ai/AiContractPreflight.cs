using System.Text.Json;
using System.Text.Json.Serialization;

namespace OpsPlatform.Api.Ai;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AiContractDraft(
    [property: JsonRequired] string? Protocol,
    [property: JsonRequired] string? Model,
    [property: JsonRequired] string? System,
    [property: JsonRequired] string? User,
    [property: JsonRequired] int MaxTokens,
    [property: JsonRequired] double Temperature);
public sealed record AiContractPreview(string Protocol, JsonElement Request, int InputCharacters, string Model)
{
    // The payload shape only: building it performs no DNS, TLS, credential or HTTP work.
    public bool NetworkVerified => false;
    public bool TransportImplemented => false;
    public bool CredentialRead => false;
    public bool SyntheticInput => true;
}
public sealed record AiContractError(string Field, string Code);
public sealed record AiContractCheck(AiContractPreview? Preview, IReadOnlyList<AiContractError> Errors)
{
    public bool ConfigurationValid => Errors.Count == 0 && Preview is not null;
}
// Builds the exact outbound payload shape for synthetic text. Nothing is sent and no model is called.
public static class AiContractPreflight
{
    public const int MaxSyntheticCharacters = 8_192;
    public static AiContractCheck Build(AiContractDraft? draft)
    {
        if (draft is null) return new(null, [new("configuration", "required")]);
        if (!AiProtocols.IsAccepted(draft.Protocol)) return new(null, [new("protocol", "unsupported")]);
        if (draft.Model is null || draft.System is null || draft.User is null) return new(null, [new("configuration", "required")]);
        if (!AiProtocols.IsReservedDemoModel(draft.Model)) return new(null, [new("model", "not_reserved_demo_model")]);
        // Bound the demo input first so oversized text is rejected before any adapter work.
        if (draft.User.Length > MaxSyntheticCharacters || draft.System.Length > MaxSyntheticCharacters)
            return new(null, [new("user", "synthetic_input_too_large")]);
        var request = new AiDraftRequest(draft.Model, draft.System, draft.User, draft.MaxTokens, draft.Temperature);
        try
        {
            using var document = draft.Protocol == "OpenAiCompatible"
                ? OpenAiChatCompletionsAdapter.BuildRequest(request)
                : AnthropicMessagesAdapter.BuildRequest(request);
            var element = document.RootElement.Clone();
            return new(new AiContractPreview(draft.Protocol!, element, draft.System.Length + draft.User.Length, draft.Model), []);
        }
        catch (AiProtocolException error) { return new(null, [new("request", error.Code)]); }
    }
}
