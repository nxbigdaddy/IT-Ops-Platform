using System.Text.Json;
using System.Text.Json.Serialization;

namespace OpsPlatform.Api.Ai;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
// The stub receives whatever the real adapter built, so it must not demand a protocol field the adapters never
// send. The response shape is inferred from the request shape: a top-level "system" means Messages style.
public sealed record AiStubRequest(
    [property: JsonRequired] string? Model,
    [property: JsonRequired] AiStubMessage[]? Messages,
    // The adapters send snake_case field names; the stub must accept exactly what they produce.
    [property: JsonRequired] [property: JsonPropertyName("max_tokens")] int? MaxTokens,
    string? System = null,
    double Temperature = 0,
    bool Stream = false);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record AiStubMessage([property: JsonRequired] string? Role, [property: JsonRequired] string? Content);
// Builds a protocol-shaped synthetic response. It never calls a model and marks its own output as synthetic.
public static class AiLoopbackStub
{
    public const string Marker = "[合成桩响应]";
    public const string DefaultBehaviour = "valid";
    public static readonly string[] BehaviourIds = ["valid", "provider_error", "tool_calls", "inconsistent_usage", "invalid_json", "http_500", "oversized", "slow"];
    public static bool IsBehaviour(string? behaviour) => behaviour is not null && BehaviourIds.Contains(behaviour, StringComparer.Ordinal);
    // Server-owned catalog so the UI never invents a behaviour or a claim about what it proves.
    public static IReadOnlyList<AiStubScenario> Scenarios() =>
    [
        new("valid", "合法响应", "经真实适配器解析出文本、用量与结束原因", "parsed", "parsed"),
        new("provider_error", "提供方错误对象", "响应含 error 字段，被适配器拒绝", "provider_error_not_supported", "provider_error_not_supported"),
        new("tool_calls", "工具调用字段", "响应含 tool_calls，被适配器拒绝", "tools_not_supported", "tools_not_supported"),
        new("inconsistent_usage", "用量不自洽", "OpenAI 侧合计与分项不符；Messages 侧输出令牌超出上限", "inconsistent_usage", "invalid_output_tokens"),
        new("invalid_json", "非法JSON", "响应不是合法 JSON", "invalid_json", "invalid_json"),
        new("http_500", "HTTP 500", "桩以 500 状态码回应", "http_status_not_ok", "http_status_not_ok"),
        new("oversized", "超大响应", "响应体超过 256KiB 上限", "response_too_large", "response_too_large"),
        new("slow", "长时间不响应", "桩延迟超过 5 秒，触发传输超时", "loopback_timeout", "loopback_timeout"),
    ];
    public static string InferProtocol(AiStubRequest request) => request.System is null ? AiProtocols.OpenAiCompatible : AiProtocols.Anthropic;

    public static (int Status, string? Code, string? Json) Build(AiStubRequest? request)
    {
        if (request is null) return (400, "stub_request_required", null);
        // Only reserved demo model ids: a stub that answered for a real model name would be misleading.
        if (!AiProtocols.IsReservedDemoModel(request.Model)) return (400, "stub_requires_demo_model", null);
        if (request.Messages is not { Length: > 0 and <= 4 }) return (400, "stub_messages_out_of_range", null);
        if (request.Stream) return (400, "stub_stream_not_supported", null);
        var input = 0;
        var hasSystemRole = false;
        foreach (var message in request.Messages)
        {
            if (message is null || string.IsNullOrWhiteSpace(message.Content) || message.Role is not ("system" or "user" or "assistant"))
                return (400, "stub_invalid_message", null);
            hasSystemRole |= message.Role == "system";
            input += message.Content.Length;
        }
        // Mixing a top-level system prompt with a system role would be ambiguous about which protocol is meant.
        if (request.System is not null && hasSystemRole) return (400, "stub_ambiguous_protocol", null);
        if (request.System is { Length: > AiProtocolLimits.MaxMessageCharacters }) return (400, "stub_invalid_input_length", null);
        input += request.System?.Length ?? 0;
        if (input == 0 || input > AiProtocolLimits.MaxCombinedInputCharacters) return (400, "stub_invalid_input_length", null);
        if (request.MaxTokens is not { } maxTokens || maxTokens is < 1 or > AiProtocolLimits.MaxTokens) return (400, "stub_invalid_max_tokens", null);
        var output = Math.Min(maxTokens, 32);
        var text = $"{Marker} 收到 {input} 字符输入；未调用任何模型，也未读取凭据。";
        var json = InferProtocol(request) == AiProtocols.OpenAiCompatible
            ? JsonSerializer.Serialize(new
            {
                @object = "chat.completion",
                model = request.Model,
                demo_stub = true,
                choices = new[] { new { index = 0, message = new { role = "assistant", content = text }, finish_reason = "stop" } },
                usage = new { prompt_tokens = input, completion_tokens = output, total_tokens = input + output },
            })
            : JsonSerializer.Serialize(new
            {
                id = "msg_demo_stub",
                type = "message",
                role = "assistant",
                model = request.Model,
                demo_stub = true,
                content = new[] { new { type = "text", text } },
                stop_reason = "end_turn",
                usage = new { input_tokens = input, output_tokens = output },
            });
        return (200, null, json);
    }
}
