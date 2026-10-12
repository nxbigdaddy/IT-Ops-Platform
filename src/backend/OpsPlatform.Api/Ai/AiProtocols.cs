namespace OpsPlatform.Api.Ai;
public sealed record AiProtocolDescription(string Protocol,string DisplayName,string RequestContract,string ResponseContract)
{
    // Offline adapter only: request/response shapes are modelled and validated locally.
    public bool AdapterImplemented => true;
    public bool TransportImplemented => false;
    public bool LiveVerified => false;
    public bool CredentialRead => false;
    public string Notes => "仅离线请求与合成响应契约；无网络传输、无凭据读取、无真实模型验证。";
}
// Single source of accepted protocol values; the preflight policy and the demo catalog both use it.
public static partial class AiProtocols
{
    public const string OpenAiCompatible = "OpenAiCompatible";
    public const string Anthropic = "Anthropic";
    public static readonly string[] Accepted = [OpenAiCompatible, Anthropic];
    public static bool IsAccepted(string? protocol) => protocol is not null && Accepted.Contains(protocol,StringComparer.Ordinal);
    // Reserved synthetic model names only: the prototype must never carry a real vendor model identifier.
    public static bool IsReservedDemoModel(string? model) => model is not null && ReservedModel().IsMatch(model);
    [System.Text.RegularExpressions.GeneratedRegex(@"\Ademo-[a-z0-9-]{1,48}\z",System.Text.RegularExpressions.RegexOptions.CultureInvariant)]
    private static partial System.Text.RegularExpressions.Regex ReservedModel();
    public static IReadOnlyList<AiProtocolDescription> List() => new AiProtocolDescription[]
    {
        new("OpenAiCompatible","OpenAI兼容 Chat Completions","chat-completions.request.v1","chat-completions.synthetic-response.v1"),
        new("Anthropic","Anthropic Messages","messages.request.v1","messages.synthetic-response.v1")
    };
}
