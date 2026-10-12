using System.Text.Json;

namespace OpsPlatform.Api.Ai;

// The expected rejection code can differ per protocol, because the two parsers validate different things.
public sealed record AiStubScenario(string Id, string Label, string Description, string OpenAiCode, string AnthropicCode);
// Turns a valid synthetic response into the requested failure shape. Only used by the local stub so the
// rejection paths can be exercised over a real socket instead of only through fixtures.
public static class AiStubBehaviour
{
    public static bool IsSlow(string behaviour) => behaviour == "slow";
    public static int HttpStatus(string behaviour) => behaviour == "http_500" ? 500 : 200;
    public static string? Transform(string behaviour, string json) => behaviour switch
    {
        "valid" => json,
        "provider_error" => "{\"error\":{\"message\":\"合成桩：提供方错误对象\",\"type\":\"demo\"}}",
        "tool_calls" => json.Replace("\"finish_reason\":\"stop\"", "\"finish_reason\":\"tool_calls\",\"tool_calls\":[{\"id\":\"call_demo\",\"type\":\"function\"}]")
            .Replace("\"stop_reason\":\"end_turn\"", "\"stop_reason\":\"tool_use\",\"tool_calls\":[{\"id\":\"call_demo\"}]"),
        "inconsistent_usage" => System.Text.RegularExpressions.Regex.Replace(json, "\"total_tokens\":\\d+", "\"total_tokens\":9999").Replace("\"output_tokens\":32", "\"output_tokens\":99999999"),
        "invalid_json" => json[..(json.Length / 2)],
        "http_500" => json,
        "oversized" => json + new string(' ', LoopbackModelTransport.MaxResponseBytes + 1024),
        "slow" => json,
        _ => null,
    };
}
