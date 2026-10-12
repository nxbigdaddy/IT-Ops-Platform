using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Ai;
using Xunit;
namespace OpsPlatform.Api.Tests;
// Each stub behaviour is checked twice: the raw bytes it returns, and the code the *real adapter* derives from
// those bytes. That is what makes the rejection list verifiable over a real socket instead of by fixture only.
public sealed class AiStubBehaviourTests
{
    private static AiStubRequest OpenAi() => new("demo-model", [new("system", "演示系统提示"), new("user", "演示用户文本")], 64, null, 0.2, false);
    private static AiStubRequest Messages() => new("demo-model", [new("user", "演示用户文本")], 64, "演示系统提示", 0.2, false);
    private static string? ParseCode(AiStubRequest request, string body)
    {
        try
        {
            if (request.System is null) { OpenAiChatCompletionsAdapter.ParseSyntheticResponse(body); return null; }
            AnthropicMessagesAdapter.ParseSyntheticResponse(body);return null;
        }
        catch (AiProtocolException error) { return error.Code; }
    }
    [Fact] public void EveryBehaviourIsListedWithAnExpectedCode()
    {
        var scenarios = AiLoopbackStub.Scenarios();
        Assert.Equal(AiLoopbackStub.BehaviourIds.Length, scenarios.Count);
        Assert.Equal(AiLoopbackStub.BehaviourIds, scenarios.Select(scenario => scenario.Id).ToArray());
        Assert.All(scenarios, scenario =>
        {
            Assert.True(AiLoopbackStub.IsBehaviour(scenario.Id));
            Assert.False(string.IsNullOrWhiteSpace(scenario.Label));
            Assert.False(string.IsNullOrWhiteSpace(scenario.Description));
            Assert.False(string.IsNullOrWhiteSpace(scenario.OpenAiCode));
            Assert.False(string.IsNullOrWhiteSpace(scenario.AnthropicCode));
        });
        Assert.False(AiLoopbackStub.IsBehaviour("unknown"));Assert.False(AiLoopbackStub.IsBehaviour(null));
        Assert.Equal("valid", AiLoopbackStub.DefaultBehaviour);
    }
    [Fact] public void EachBehaviourProducesTheAdvertisedOutcomeForBothProtocols()
    {
        foreach (var scenario in AiLoopbackStub.Scenarios())
        {
            foreach (var request in new[] { OpenAi(), Messages() })
            {
                var (status, code, json) = AiLoopbackStub.Build(request);
                Assert.Equal(200, status);Assert.Null(code);Assert.NotNull(json);
                var transformed = AiStubBehaviour.Transform(scenario.Id, json!);
                Assert.NotNull(transformed);
                if (scenario.Id == "valid")
                {
                    Assert.Null(ParseCode(request, transformed!));
                    continue;
                }
                // The advertised code must be the code the real parser reports; http_500, slow and oversized are
                // decided by the transport (status, timeout, size) and are asserted separately.
                if (scenario.Id is "slow" or "oversized" or "http_500") continue;
                var expected = request.System is null ? scenario.OpenAiCode : scenario.AnthropicCode;
                Assert.Equal(expected, ParseCode(request, transformed!));
            }
        }
        Assert.Equal(500, AiStubBehaviour.HttpStatus("http_500"));
        Assert.Equal(200, AiStubBehaviour.HttpStatus("valid"));
        Assert.True(AiStubBehaviour.IsSlow("slow"));Assert.False(AiStubBehaviour.IsSlow("valid"));
        Assert.Null(AiStubBehaviour.Transform("unknown", "{}"));
        // The oversized body really exceeds the transport bound.
        var (_, _, valid) = AiLoopbackStub.Build(OpenAi());
        Assert.True(AiStubBehaviour.Transform("oversized", valid!)!.Length > LoopbackModelTransport.MaxResponseBytes);
    }
    [Fact] public void InvalidJsonBehaviourIsTruncatedNotAmbiguous()
    {
        var (_, _, json) = AiLoopbackStub.Build(OpenAi());
        var truncated = AiStubBehaviour.Transform("invalid_json", json!)!;
        Assert.True(truncated.Length < json!.Length);
        Assert.Equal("invalid_json", ParseCode(OpenAi(), truncated));
    }
    [Fact] public void ToolCallsAndProviderErrorAreRefusedRatherThanParsed()
    {
        var (_, _, json) = AiLoopbackStub.Build(OpenAi());
        Assert.Equal("tools_not_supported", ParseCode(OpenAi(), AiStubBehaviour.Transform("tool_calls", json!)!));
        Assert.Equal("provider_error_not_supported", ParseCode(OpenAi(), AiStubBehaviour.Transform("provider_error", json!)!));
        var (_, _, messages) = AiLoopbackStub.Build(Messages());
        Assert.Equal("tools_not_supported", ParseCode(Messages(), AiStubBehaviour.Transform("tool_calls", messages!)!));
        // The transformed bodies must still be self-labelled as synthetic wherever text survives. The raw JSON
        // escapes non-ASCII, so the marker is asserted on the decoded value.
        using var document = JsonDocument.Parse(AiStubBehaviour.Transform("tool_calls", json!)!);
        var content = document.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString();
        Assert.Contains(AiLoopbackStub.Marker, content);
    }
    [Fact] public async Task ExchangeAndScenarioRoutesAreGatedAndStrict()
    {
        await using var app = AppBootstrap.Build([], builder =>
        {
            builder.Environment.EnvironmentName = "Development";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Demo:Enabled"] = "true" });
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();using var client = app.GetTestClient();
        var scenarios = await client.GetFromJsonAsync<JsonElement>("/api/v1/ai-loopback-stub-scenarios");
        Assert.Equal(8, scenarios.GetProperty("data").GetArrayLength());
        Assert.Equal("none", scenarios.GetProperty("persistence").GetString());
        // An unknown behaviour is refused for both the stub route and the exchange draft.
        var stub = await client.PostAsJsonAsync("/api/v1/ai-loopback-stub/unknown", new { model = "demo-model", messages = new[] { new { role = "user", content = "x" } }, max_tokens = 8 });
        Assert.Equal(System.Net.HttpStatusCode.BadRequest, stub.StatusCode);
        var exchange = await client.PostAsJsonAsync("/api/v1/ai-loopback-exchange", new { protocol = "OpenAiCompatible", model = "demo-model", system = "s", user = "u", maxTokens = 8, temperature = 0.2, stubBehaviour = "unknown" });
        Assert.Equal(System.Net.HttpStatusCode.BadRequest, exchange.StatusCode);
        // A non-loopback override is still refused before any connection, whatever the behaviour.
        var override_ = await client.PostAsJsonAsync("/api/v1/ai-loopback-exchange", new { protocol = "OpenAiCompatible", model = "demo-model", system = "s", user = "u", maxTokens = 8, temperature = 0.2, endpoint = "http://192.0.2.10/stub", stubBehaviour = "http_500" });
        Assert.Equal(System.Net.HttpStatusCode.BadRequest, override_.StatusCode);
        Assert.Contains("endpoint_not_loopback", await override_.Content.ReadAsStringAsync());
    }
}
