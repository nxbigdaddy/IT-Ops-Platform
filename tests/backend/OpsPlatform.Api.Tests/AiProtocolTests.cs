using System.Text.Json;
using System.Text.Json.Nodes;
using OpsPlatform.Api.Ai;
using Xunit;

namespace OpsPlatform.Api.Tests;

public sealed class AiProtocolTests
{
    private const string OpenAi = """
        {"object":"chat.completion","choices":[{"message":{"role":"assistant","content":"fixture draft"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}
        """;
    private const string Anthropic = """
        {"type":"message","role":"assistant","content":[{"type":"text","text":"fixture "},{"type":"text","text":"draft"}],"stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":4}}
        """;
    private static AiDraftRequest Request => new("fixture-model", "system instruction", "user input", 128, 0.5);
    private static JsonDocument Build(bool anthropic, AiDraftRequest request) => anthropic
        ? AnthropicMessagesAdapter.BuildRequest(request) : OpenAiChatCompletionsAdapter.BuildRequest(request);
    private static AiDraftResult Parse(bool anthropic, string json) => anthropic
        ? AnthropicMessagesAdapter.ParseSyntheticResponse(json) : OpenAiChatCompletionsAdapter.ParseSyntheticResponse(json);
    private static string Fixture(bool anthropic) => anthropic ? Anthropic : OpenAi;
    private static string Mutate(bool anthropic, Action<JsonObject> change)
    {
        var root = JsonNode.Parse(Fixture(anthropic))!.AsObject();
        change(root);
        return root.ToJsonString();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void BuildsTextOnlyNonStreamingRequest(bool anthropic)
    {
        using var doc = Build(anthropic, Request);
        var root = doc.RootElement;
        Assert.Equal("fixture-model", root.GetProperty("model").GetString());
        Assert.Equal(128, root.GetProperty("max_tokens").GetInt32());
        Assert.Equal(0.5, root.GetProperty("temperature").GetDouble());
        Assert.False(root.GetProperty("stream").GetBoolean());
        Assert.False(root.TryGetProperty("tools", out _));
        var messages = root.GetProperty("messages");
        Assert.Equal(anthropic ? 1 : 2, messages.GetArrayLength());
        Assert.Equal("system instruction", anthropic ? root.GetProperty("system").GetString() : messages[0].GetProperty("content").GetString());
        Assert.Equal("user", messages[anthropic ? 0 : 1].GetProperty("role").GetString());
        Assert.Equal("user input", messages[anthropic ? 0 : 1].GetProperty("content").GetString());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void ParsesFixturesAndCannotMisrepresentLiveVerification(bool anthropic)
    {
        var result = Parse(anthropic, Fixture(anthropic));
        Assert.Equal("fixture draft", result.Text);
        Assert.Equal(new AiTokenUsage(10, 4, 14), result.Usage);
        Assert.Equal(anthropic ? "end_turn" : "stop", result.StopReason);
        Assert.True(result.Synthetic);
        Assert.True(result.TestOnly);
        using var serialized = JsonSerializer.SerializeToDocument(result);
        Assert.True(serialized.RootElement.GetProperty("synthetic").GetBoolean());
        Assert.True(serialized.RootElement.GetProperty("testOnly").GetBoolean());
        var metadata = anthropic ? AnthropicMessagesAdapter.Metadata : OpenAiChatCompletionsAdapter.Metadata;
        Assert.Equal(metadata.Protocol, result.Protocol);
        using var contract = JsonSerializer.SerializeToDocument(metadata);
        Assert.Equal("implemented-contract-only", contract.RootElement.GetProperty("status").GetString());
        Assert.True(contract.RootElement.GetProperty("verifiedWithFixture").GetBoolean());
        Assert.False(contract.RootElement.GetProperty("liveVerified").GetBoolean());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void RejectsInvalidTypedInputs(bool anthropic)
    {
        AiDraftRequest[] invalid = [null!, Request with { Model = null! }, Request with { Model = " " },
            Request with { Model = new('m', 129) }, Request with { Model = "bad\nmodel" },
            Request with { System = null! }, Request with { User = null! }, Request with { User = " " },
            Request with { System = new('s', 32_769) }, Request with { User = new('u', 32_769) },
            Request with { System = new('s', 32_768), User = new('u', 16_385) },
            Request with { MaxTokens = 0 }, Request with { MaxTokens = -1 }, Request with { MaxTokens = 32_769 },
            Request with { MaxTokens = int.MaxValue }, Request with { Temperature = double.NaN },
            Request with { Temperature = double.PositiveInfinity }, Request with { Temperature = -0.01 },
            Request with { Temperature = anthropic ? 1.01 : 2.01 }];
        foreach (var request in invalid) Assert.Throws<AiProtocolException>(() => Build(anthropic, request));
        using var minimum = Build(anthropic, Request with { System = "", MaxTokens = 1, Temperature = 0 });
        using var maximum = Build(anthropic, Request with { Model = new('m', 128), System = new('s', 32_768), User = new('u', 16_384), MaxTokens = 32_768, Temperature = anthropic ? 1 : 2 });
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void RejectsEmptyMalformedMissingWrongTypeAndOversizedResponse(bool anthropic)
    {
        string[] invalid = [null!, "", " ", "{", "null", "[]", "{}", "{\"error\":{}}", "{\"usage\":{},\"usage\":{}}",
            new(' ', AiProtocolLimits.MaxResponseBytes + 1),
            "{\"padding\":\"" + new string('界', 90_000) + "\"}",
            Mutate(anthropic, r => r.Remove("usage")), Mutate(anthropic, r => r["usage"] = "bad"),
            Mutate(anthropic, r => r[anthropic ? "content" : "choices"] = new JsonArray()),
            Mutate(anthropic, r => r[anthropic ? "content" : "choices"] = "bad"),
            Mutate(anthropic, r => r[anthropic ? "type" : "object"] = "stream.chunk")];
        foreach (var json in invalid) Assert.Throws<AiProtocolException>(() => Parse(anthropic, json));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void RejectsEmptyWrongTypedAndOversizedText(bool anthropic)
    {
        foreach (JsonNode? text in new JsonNode?[] { null, JsonValue.Create(42), new JsonArray(), JsonValue.Create(" "), JsonValue.Create(new string('x', 65_537)) })
        {
            var json = Mutate(anthropic, r =>
            {
                if (anthropic) { r["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = text }); }
                else r["choices"]![0]!["message"]!["content"] = text;
            });
            Assert.Throws<AiProtocolException>(() => Parse(anthropic, json));
        }
        var maximum = Mutate(anthropic, r =>
        {
            if (anthropic) r["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = new string('x', 65_536) });
            else r["choices"]![0]!["message"]!["content"] = new string('x', 65_536);
        });
        Assert.Equal(65_536, Parse(anthropic, maximum).Text.Length);
        if (anthropic)
            Assert.Throws<AiProtocolException>(() => Parse(true, Mutate(true, r => { r["content"]![0]!["text"] = new string('x', 40_000); r["content"]![1]!["text"] = new string('y', 40_000); })));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void RejectsToolsAndUnsupportedStopReasons(bool anthropic)
    {
        foreach (var field in new[] { "tool_calls", "function_call", "tools", "tool_use", "tool_result" })
            Assert.Throws<AiProtocolException>(() => Parse(anthropic, Mutate(anthropic, r => r[field] = new JsonArray())));
        foreach (var stop in new[] { "tool_use", "tool_calls", "function_call", "unknown", "" })
            Assert.Throws<AiProtocolException>(() => Parse(anthropic, Mutate(anthropic, r =>
            {
                if (anthropic) r["stop_reason"] = stop;
                else r["choices"]![0]!["finish_reason"] = stop;
            })));
        var nested = Mutate(anthropic, r =>
        {
            if (anthropic) r["content"]![1]!["type"] = "tool_use";
            else r["choices"]![0]!["message"]!["tool_calls"] = new JsonArray();
        });
        Assert.Throws<AiProtocolException>(() => Parse(anthropic, nested));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void ValidatesUsageTypeRangeAndTotals(bool anthropic)
    {
        foreach (var field in anthropic ? new[] { "input_tokens", "output_tokens" } : new[] { "prompt_tokens", "completion_tokens", "total_tokens" })
        {
            foreach (var bad in new JsonNode?[] { null, JsonValue.Create("1"), JsonValue.Create(-1), JsonValue.Create(0.5), JsonValue.Create(10_000_001), JsonValue.Create(long.MaxValue) })
                Assert.Throws<AiProtocolException>(() => Parse(anthropic, Mutate(anthropic, r => r["usage"]![field] = bad)));
            Assert.Throws<AiProtocolException>(() => Parse(anthropic, Mutate(anthropic, r => r["usage"]!.AsObject().Remove(field))));
        }
        foreach (var count in new[] { 0, 10_000_000 })
        {
            var json = Mutate(anthropic, r => r["usage"] = anthropic
                ? new JsonObject { ["input_tokens"] = count, ["output_tokens"] = 0 }
                : new JsonObject { ["prompt_tokens"] = count, ["completion_tokens"] = 0, ["total_tokens"] = count });
            Assert.Equal(count, Parse(anthropic, json).Usage.TotalTokens);
        }
        Assert.Throws<AiProtocolException>(() => Parse(anthropic, Mutate(anthropic, r =>
            r["usage"]![anthropic ? "input_tokens" : "total_tokens"] = 10_000_000)));
    }

    [Theory]
    [InlineData(false, "length")]
    [InlineData(false, "content_filter")]
    [InlineData(true, "max_tokens")]
    [InlineData(true, "stop_sequence")]
    public void PreservesSupportedNonDefaultStopReasons(bool anthropic, string stop)
    {
        var json = Mutate(anthropic, r =>
        {
            if (anthropic) r["stop_reason"] = stop;
            else r["choices"]![0]!["finish_reason"] = stop;
        });
        Assert.Equal(stop, Parse(anthropic, json).StopReason);
    }

    [Fact]
    public void RejectsMultipleChoicesAndWrongRolesOrMissingStop()
    {
        Assert.Throws<AiProtocolException>(() => Parse(false, Mutate(false, r => r["choices"]!.AsArray().Add(r["choices"]![0]!.DeepClone()))));
        Assert.Throws<AiProtocolException>(() => Parse(false, Mutate(false, r => r["choices"]![0]!["message"]!["role"] = "user")));
        Assert.Throws<AiProtocolException>(() => Parse(true, Mutate(true, r => r["role"] = "user")));
        Assert.Throws<AiProtocolException>(() => Parse(false, Mutate(false, r => r["choices"]![0]!.AsObject().Remove("finish_reason"))));
        Assert.Throws<AiProtocolException>(() => Parse(true, Mutate(true, r => r.Remove("stop_reason"))));
    }
}
