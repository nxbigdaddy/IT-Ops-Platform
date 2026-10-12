using System.Text;
using System.Text.Json;

namespace OpsPlatform.Api.Ai;

/// <summary>Pure text-only Messages contract; no transport, credentials or tool execution.</summary>
public static class AnthropicMessagesAdapter
{
    public static AiProtocolMetadata Metadata { get; } = new("anthropic-messages");

    /// <summary>Caller owns the returned document. Does not send a request.</summary>
    public static JsonDocument BuildRequest(AiDraftRequest request)
    {
        AiProtocolValidation.Request(request, 1);
        return JsonSerializer.SerializeToDocument(new
        {
            model = request.Model,
            system = request.System,
            messages = new[] { new { role = "user", content = request.User } },
            max_tokens = request.MaxTokens,
            temperature = request.Temperature,
            stream = false
        });
    }

    public static AiDraftResult ParseSyntheticResponse(string json)
    {
        using var document = AiProtocolValidation.Response(json);
        var root = document.RootElement;
        AiProtocolValidation.Equal(root, "type", "message");
        AiProtocolValidation.Equal(root, "role", "assistant");
        var blocks = AiProtocolValidation.Field(root, "content", JsonValueKind.Array);
        if (blocks.GetArrayLength() == 0) throw new AiProtocolException("content_required");
        var text = new StringBuilder();
        foreach (var block in blocks.EnumerateArray())
        {
            AiProtocolValidation.Equal(block, "type", "text");
            var part = AiProtocolValidation.Text(block, "text");
            if (text.Length + part.Length > AiProtocolLimits.MaxOutputCharacters) throw new AiProtocolException("invalid_output_length");
            text.Append(part);
        }
        var stop = AiProtocolValidation.Stop(root, "stop_reason", "end_turn", "max_tokens", "stop_sequence");
        var usage = AiProtocolValidation.Field(root, "usage", JsonValueKind.Object);
        var input = AiProtocolValidation.Tokens(usage, "input_tokens");
        var output = AiProtocolValidation.Tokens(usage, "output_tokens");
        if (input + output > AiProtocolLimits.MaxUsageTokens) throw new AiProtocolException("invalid_total_tokens");
        return new(Metadata.Protocol, AiProtocolValidation.Output(text.ToString()), new(input, output, input + output), stop);
    }
}
