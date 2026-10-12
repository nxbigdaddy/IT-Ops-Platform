using System.Text.Json;

namespace OpsPlatform.Api.Ai;

/// <summary>Pure text-only Chat Completions contract; no transport, credentials or tool execution.</summary>
public static class OpenAiChatCompletionsAdapter
{
    public static AiProtocolMetadata Metadata { get; } = new("openai-chat-completions");

    /// <summary>Caller owns the returned document. Does not send a request.</summary>
    public static JsonDocument BuildRequest(AiDraftRequest request)
    {
        AiProtocolValidation.Request(request, 2);
        return JsonSerializer.SerializeToDocument(new
        {
            model = request.Model,
            messages = new[] { new { role = "system", content = request.System }, new { role = "user", content = request.User } },
            max_tokens = request.MaxTokens,
            temperature = request.Temperature,
            stream = false
        });
    }

    public static AiDraftResult ParseSyntheticResponse(string json)
    {
        using var document = AiProtocolValidation.Response(json);
        var root = document.RootElement;
        AiProtocolValidation.Equal(root, "object", "chat.completion");
        var choices = AiProtocolValidation.Field(root, "choices", JsonValueKind.Array);
        if (choices.GetArrayLength() != 1) throw new AiProtocolException("exactly_one_choice_required");
        var choice = AiProtocolValidation.Object(choices[0]);
        var message = AiProtocolValidation.Field(choice, "message", JsonValueKind.Object);
        AiProtocolValidation.Equal(message, "role", "assistant");
        var text = AiProtocolValidation.Output(AiProtocolValidation.Text(message, "content"));
        var stop = AiProtocolValidation.Stop(choice, "finish_reason", "stop", "length", "content_filter");
        var usage = AiProtocolValidation.Field(root, "usage", JsonValueKind.Object);
        var input = AiProtocolValidation.Tokens(usage, "prompt_tokens");
        var output = AiProtocolValidation.Tokens(usage, "completion_tokens");
        var total = AiProtocolValidation.Tokens(usage, "total_tokens");
        if (total != input + output) throw new AiProtocolException("inconsistent_usage");
        return new(Metadata.Protocol, text, new(input, output, total), stop);
    }
}
