namespace OpsPlatform.Api.Ai;

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record AiResponseDraft([property: System.Text.Json.Serialization.JsonRequired] string? Scenario);

public sealed record AiResponseScenarioError(string Field, string Code);
public sealed record AiResponseScenario(string Id, string Protocol, string Label, string Description,
    bool Accepted, string Code, string? OutputPreview, int InputTokens, int OutputTokens)
{
    // A parsed fixture proves the offline contract only; it never proves a live model call happened.
    public bool LiveCallPerformed => false;
    public bool TransportImplemented => false;
    public bool ProductionEnabled => false;
    public string Notes => "仅用服务端合成响应验证离线解析契约；无网络传输、无凭据、无真实模型调用。";
}
// Synthetic provider payloads only. Each verdict is produced by running the real adapter parser.
public static class AiResponseScenarios
{
    private static string OpenAi(string? objectName = null, string? content = null, int prompt = 12, int completion = 8,
        int? totalOverride = null, string? finish = null, string? role = null, string extra = "")
    {
        var total = totalOverride ?? prompt + completion;
        return "{\"object\":\"" + (objectName ?? "chat.completion")
            + "\",\"choices\":[{\"message\":{\"role\":\"" + (role ?? "assistant")
            + "\",\"content\":\"" + (content ?? "合成响应：仅用于本地契约验证。")
            + "\"},\"finish_reason\":\"" + (finish ?? "stop")
            + "\"}],\"usage\":{\"prompt_tokens\":" + prompt
            + ",\"completion_tokens\":" + completion
            + ",\"total_tokens\":" + total + "}" + extra + "}";
    }
    private static string Anthropic(string? type = null, string? text = null, int input = 11, int output = 7,
        string? stop = null, string? role = null)
    {
        return "{\"type\":\"" + (type ?? "message")
            + "\",\"role\":\"" + (role ?? "assistant")
            + "\",\"content\":[{\"type\":\"text\",\"text\":\"" + (text ?? "合成响应：仅用于本地契约验证。")
            + "\"}],\"stop_reason\":\"" + (stop ?? "end_turn")
            + "\",\"usage\":{\"input_tokens\":" + input + ",\"output_tokens\":" + output + "}}";
    }
    public static IReadOnlyList<(string Id, string Protocol, string Label, string Description, string Json)> Fixtures() =>
    [
        ("openai-valid", "OpenAiCompatible", "OpenAI 兼容：合法合成响应", "字段齐全且用量自洽。", OpenAi()),
        ("openai-object-mismatch", "OpenAiCompatible", "object 字段不符", "必须是 chat.completion。", OpenAi(objectName: "chat.chunk")),
        ("openai-role-mismatch", "OpenAiCompatible", "消息角色不符", "角色必须是 assistant。", OpenAi(role: "user")),
        ("openai-usage-inconsistent", "OpenAiCompatible", "用量不自洽", "total_tokens 必须等于输入加输出。", OpenAi(totalOverride: 999)),
        ("openai-stop-unsupported", "OpenAiCompatible", "结束原因不支持", "仅接受 stop/length/content_filter。", OpenAi(finish: "tool_calls")),
        ("openai-empty-output", "OpenAiCompatible", "输出为空", "空内容视为无效输出。", OpenAi(content: "")),
        ("openai-tool-call", "OpenAiCompatible", "包含工具调用字段", "离线契约不支持工具调用。", OpenAi(extra: ",\"tool_calls\":[]")),
        ("openai-provider-error", "OpenAiCompatible", "提供方错误对象", "错误响应必须先按错误处理。", """{"error":{"message":"synthetic"}}"""),
        ("openai-duplicate-property", "OpenAiCompatible", "重复属性名", "重复属性会被拒绝以避免歧义。", """{"object":"chat.completion","object":"chat.completion","choices":[],"usage":{}}"""),
        ("openai-invalid-json", "OpenAiCompatible", "非法 JSON", "无法解析即拒绝。", "{not-json"),
        ("anthropic-valid", "Anthropic", "Anthropic：合法合成响应", "字段齐全。", Anthropic()),
        ("anthropic-type-mismatch", "Anthropic", "type 字段不符", "必须是 message。", Anthropic(type: "content_block")),
        ("anthropic-stop-unsupported", "Anthropic", "结束原因不支持", "仅接受契约内的结束原因。", Anthropic(stop: "tool_use")),
        ("anthropic-empty-output", "Anthropic", "输出为空", "空文本视为无效输出。", Anthropic(text: "")),
        ("anthropic-provider-error", "Anthropic", "提供方错误对象", "错误响应必须先按错误处理。", """{"type":"error","error":{"type":"synthetic"}}"""),
    ];
    public static AiResponseScenario Run(string id)
    {
        var fixture = Fixtures().FirstOrDefault(item => item.Id == id);
        if (fixture.Id is null) throw new ArgumentException("unknown scenario", nameof(id));
        try
        {
            var result = fixture.Protocol == "OpenAiCompatible"
                ? OpenAiChatCompletionsAdapter.ParseSyntheticResponse(fixture.Json)
                : AnthropicMessagesAdapter.ParseSyntheticResponse(fixture.Json);
            return new(fixture.Id, fixture.Protocol, fixture.Label, fixture.Description, true, "accepted",
                result.Text, result.Usage.InputTokens, result.Usage.OutputTokens);
        }
        catch (AiProtocolException exception)
        {
            return new(fixture.Id, fixture.Protocol, fixture.Label, fixture.Description, false, exception.Code, null, 0, 0);
        }
    }
    public static IReadOnlyList<AiResponseScenario> List() => Fixtures().Select(item => Run(item.Id)).ToArray();
    public static AiResponseScenario? Find(string? id)
    {
        if (id is null || Fixtures().All(item => item.Id != id)) return null;
        return Run(id);
    }
}
