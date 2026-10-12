using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class AiLoopbackExchangeTests
{
    private static async Task<WebApplication> Start(string environment = "Development", bool demo = true)
    {
        var app = AppBootstrap.Build([], builder =>
        {
            builder.Environment.EnvironmentName = environment;
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Demo:Enabled"] = demo.ToString() });
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();
        return app;
    }
    private static object Draft(string protocol = "OpenAiCompatible", string model = "demo-model", string? endpoint = null) => new
    {
        protocol,
        model,
        system = "演示系统提示",
        user = "演示用户文本",
        maxTokens = 256,
        temperature = 0.2,
        endpoint,
    };
    [Fact] public async Task StubRefusesNonDemoModelsAndBadShapes()
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        // The stub gets exactly what the adapter built: no protocol field, a system role and stream=false.
        var openAi = new { model = "demo-model", messages = new[] { new { role = "system", content = "演示系统提示" }, new { role = "user", content = "演示用户文本" } }, max_tokens = 64, temperature = 0.2, stream = false };
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/ai-loopback-stub", openAi)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/v1/ai-loopback-stub", new { model = "demo-model", system = "演示系统提示", messages = new[] { new { role = "user", content = "演示用户文本" } }, max_tokens = 64, temperature = 0.2, stream = false })).StatusCode);
        // A real-looking model name must never be answered by the stub.
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/ai-loopback-stub", new { model = "gpt-4o", messages = openAi.messages, max_tokens = 64 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/ai-loopback-stub", new { model = "demo-model", messages = Array.Empty<object>(), max_tokens = 64 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/ai-loopback-stub", new { model = "demo-model", messages = openAi.messages, max_tokens = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/ai-loopback-stub", new { model = "demo-model", messages = openAi.messages, max_tokens = 64, stream = true })).StatusCode);
        // A top-level system prompt together with a system role is ambiguous and refused.
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/ai-loopback-stub", new { model = "demo-model", system = "x", messages = openAi.messages, max_tokens = 64 })).StatusCode);
        // Unknown request members are rejected rather than ignored.
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/ai-loopback-stub", new { model = "demo-model", messages = openAi.messages, max_tokens = 64, apiKey = "sk-should-never-be-accepted" })).StatusCode);
    }
    [Fact] public async Task StubOutputIsSyntheticAndSelfLabelled()
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        foreach (var protocol in new[] { "OpenAiCompatible", "Anthropic" })
        {
            var body0 = protocol == "OpenAiCompatible"
                ? (object)new { model = "demo-model", messages = new[] { new { role = "system", content = "演示系统提示" }, new { role = "user", content = "演示用户文本" } }, max_tokens = 64, temperature = 0.2, stream = false }
                : new { model = "demo-model", system = "演示系统提示", messages = new[] { new { role = "user", content = "演示用户文本" } }, max_tokens = 64, temperature = 0.2, stream = false };
            var json = await client.PostAsJsonAsync("/api/v1/ai-loopback-stub", body0);
            var body = await json.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(body.GetProperty("demo_stub").GetBoolean());
            var text = protocol == "OpenAiCompatible"
                ? body.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString()
                : body.GetProperty("content")[0].GetProperty("text").GetString();
            Assert.Contains("[合成桩响应]", text);
            Assert.Contains("未调用任何模型", text);
        }
    }
    [Fact] public async Task ExchangeReportsRefusalsWithoutConnecting()
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        // A non-loopback override is refused before any socket is opened.
        var refused = await client.PostAsJsonAsync("/api/v1/ai-loopback-exchange", Draft(endpoint: "http://192.0.2.10/v1"));
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Contains("endpoint_not_loopback", await refused.Content.ReadAsStringAsync());
        foreach (var body in new object[]
        {
            Draft(model: "gpt-4o"),
            Draft(protocol: "SomeOther"),
            new { protocol = "OpenAiCompatible", model = "demo-model", system = "", user = "", maxTokens = 10, temperature = 0.2, endpoint = (string?)null },
            new { protocol = "OpenAiCompatible", model = "demo-model", system = "", user = "x", maxTokens = 10, temperature = 5.0, endpoint = (string?)null },
            new { protocol = "OpenAiCompatible", model = "demo-model", system = "", user = "x", maxTokens = 0, temperature = 0.2, endpoint = (string?)null },
        })
        {
            var rejected = await client.PostAsJsonAsync("/api/v1/ai-loopback-exchange", body);
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
            // Refusals must not echo the submitted content.
            Assert.DoesNotContain("演示", await rejected.Content.ReadAsStringAsync());
        }
    }
    [Fact] public async Task ExchangeIsGated()
    {
        await using (var app = await Start())
        {
            using var client = app.GetTestClient();
            using var foreign = new HttpRequestMessage(HttpMethod.Post, "/api/v1/ai-loopback-exchange") { Content = JsonContent.Create(Draft()) };
            foreign.Headers.Add("Origin", "https://foreign.example.invalid");
            Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(foreign)).StatusCode);
        }
        await using (var app = await Start("Production", false))
        {
            using var client = app.GetTestClient();
            Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.PostAsJsonAsync("/api/v1/ai-loopback-exchange", Draft())).StatusCode);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.PostAsJsonAsync("/api/v1/ai-loopback-stub", new { model = "demo-model", messages = new[] { new { role = "user", content = "x" } }, max_tokens = 8 })).StatusCode);
        }
    }
    [Fact] public async Task ExchangeParsesTheStubOverARealSocketWhenAStubIsReachable()
    {
        // TestServer has no real listening socket, so the exchange against an explicitly supplied stub is
        // covered by the transport tests with an in-process stub. Here we assert the failure classification
        // that a test host produces: it must be reported, never turned into a success.
        await using var app = await Start();
        using var client = app.GetTestClient();
        var response = await client.PostAsJsonAsync("/api/v1/ai-loopback-exchange", Draft());
        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var data = body.GetProperty("data");
        Assert.Contains(data.GetProperty("status").GetString(), new[] { "unreachable", "timeout", "rejected" });
        Assert.Null(data.GetProperty("text").GetString());
        Assert.True(data.GetProperty("loopbackOnly").GetBoolean());
        Assert.False(data.GetProperty("credentialRead").GetBoolean());
        Assert.False(data.GetProperty("productionTransportImplemented").GetBoolean());
        Assert.True(data.GetProperty("syntheticStubOnly").GetBoolean());
        // The payload was built and transmitted to a loopback address, so the outcome must show exactly that
        // synthetic body and nothing credential-shaped.
        var sent = data.GetProperty("sentRequestJson").GetString();
        Assert.False(string.IsNullOrWhiteSpace(sent));
        using var sentDocument = JsonDocument.Parse(sent!);
        Assert.Equal("demo-model", sentDocument.RootElement.GetProperty("model").GetString());
        Assert.DoesNotContain("\"authorization\"", sent!, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Bearer ", sent!, StringComparison.OrdinalIgnoreCase);
    }
}
