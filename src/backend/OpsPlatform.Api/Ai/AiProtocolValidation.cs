using System.Text;
using System.Text.Json;

namespace OpsPlatform.Api.Ai;

internal static class AiProtocolValidation
{
    internal static void Request(AiDraftRequest? request, double maximumTemperature)
    {
        if (request is null) throw new AiProtocolException("request_required");
        if (string.IsNullOrWhiteSpace(request.Model) || request.Model.Length > AiProtocolLimits.MaxModelCharacters
            || request.Model.Any(char.IsControl)) throw new AiProtocolException("invalid_model");
        if (request.System is null || request.System.Length > AiProtocolLimits.MaxMessageCharacters
            || string.IsNullOrWhiteSpace(request.User) || request.User.Length > AiProtocolLimits.MaxMessageCharacters
            || request.System.Length + request.User.Length > AiProtocolLimits.MaxCombinedInputCharacters)
            throw new AiProtocolException("invalid_input_length");
        if (request.MaxTokens is < 1 or > AiProtocolLimits.MaxTokens) throw new AiProtocolException("invalid_max_tokens");
        if (!double.IsFinite(request.Temperature) || request.Temperature < 0 || request.Temperature > maximumTemperature)
            throw new AiProtocolException("invalid_temperature");
    }

    internal static JsonDocument Response(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) throw new AiProtocolException("response_required");
        if (json.Length > AiProtocolLimits.MaxResponseBytes || Encoding.UTF8.GetByteCount(json) > AiProtocolLimits.MaxResponseBytes)
            throw new AiProtocolException("response_too_large");
        JsonDocument document;
        try { document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 16 }); }
        catch (JsonException) { throw new AiProtocolException("invalid_json"); }
        try
        {
            Object(document.RootElement);
            RejectAmbiguousOrToolFields(document.RootElement);
            if (document.RootElement.TryGetProperty("error", out _)) throw new AiProtocolException("provider_error_not_supported");
            return document;
        }
        catch { document.Dispose(); throw; }
    }

    private static void RejectAmbiguousOrToolFields(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!names.Add(property.Name)) throw new AiProtocolException("duplicate_property");
                if (property.Name is "tool_calls" or "function_call" or "tools" or "tool_use" or "tool_result")
                    throw new AiProtocolException("tools_not_supported");
                RejectAmbiguousOrToolFields(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var child in element.EnumerateArray()) RejectAmbiguousOrToolFields(child);
    }

    internal static JsonElement Object(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object) throw new AiProtocolException("expected_object");
        return element;
    }

    internal static JsonElement Field(JsonElement element, string name, JsonValueKind kind)
    {
        Object(element);
        if (!element.TryGetProperty(name, out var value) || value.ValueKind != kind)
            throw new AiProtocolException("invalid_" + name);
        return value;
    }

    internal static string Text(JsonElement element, string name) => Field(element, name, JsonValueKind.String).GetString()!;

    internal static void Equal(JsonElement element, string name, string expected)
    {
        if (Text(element, name) != expected) throw new AiProtocolException("unsupported_" + name);
    }

    internal static string Output(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > AiProtocolLimits.MaxOutputCharacters)
            throw new AiProtocolException("invalid_output_length");
        return text;
    }

    internal static int Tokens(JsonElement usage, string name)
    {
        var value = Field(usage, name, JsonValueKind.Number);
        if (!value.TryGetInt32(out var count) || count is < 0 or > AiProtocolLimits.MaxUsageTokens)
            throw new AiProtocolException("invalid_" + name);
        return count;
    }

    internal static string Stop(JsonElement element, string name, params string[] allowed)
    {
        var value = Text(element, name);
        if (!allowed.Contains(value, StringComparer.Ordinal)) throw new AiProtocolException("unsupported_stop_reason");
        return value;
    }
}
