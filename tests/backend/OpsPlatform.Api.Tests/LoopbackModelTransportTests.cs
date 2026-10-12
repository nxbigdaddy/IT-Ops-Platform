using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OpsPlatform.Api.Ai;
using Xunit;
namespace OpsPlatform.Api.Tests;
// The loopback transport is exercised against a real in-process stub over a real socket. The stub only ever
// receives synthetic demo content and never a credential.
public sealed class LoopbackModelTransportTests
{
    private static AiDraftRequest Request() => new("demo-model", "演示系统提示", "演示用户文本", 256, 0.2);
    private static string OpenAiBody(string text = "合成回答") => JsonSerializer.Serialize(new
    {
        @object = "chat.completion",
        choices = new[] { new { index = 0, message = new { role = "assistant", content = text }, finish_reason = "stop" } },
        usage = new { prompt_tokens = 11, completion_tokens = 7, total_tokens = 18 },
    });
    private static async Task<(WebApplication App, string BaseUrl)> StartStubAsync(Func<HttpContext, Task> handler)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        var app = builder.Build();
        app.Use(_ => new Microsoft.AspNetCore.Http.RequestDelegate(handler));
        await app.StartAsync();
        var address = app.Services.GetService(typeof(Microsoft.AspNetCore.Hosting.Server.IServer)) as Microsoft.AspNetCore.Hosting.Server.IServer;
        var url = address!.Features.Get<Microsoft.AspNetCore.Hosting.Server.Features.IServerAddressesFeature>()!.Addresses.First();
        return (app, url);
    }
    [Theory]
    [InlineData("http://127.0.0.1:5099/v1/chat/completions", true)]
    [InlineData("http://localhost:5099/v1/chat/completions", true)]
    [InlineData("http://[::1]:5099/v1/chat/completions", true)]
    [InlineData("https://127.0.0.1/v1", false)]
    [InlineData("http://192.0.2.10/v1", false)]
    [InlineData("http://ai.example.invalid/v1", false)]
    [InlineData("http://user:pass@127.0.0.1/v1", false)]
    [InlineData("http://127.0.0.1/v1?key=1", false)]
    [InlineData("http://127.0.0.1/v1#frag", false)]
    [InlineData("ftp://127.0.0.1/v1", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void OnlyBareLoopbackHttpEndpointsAreAccepted(string? endpoint, bool expected) =>
        Assert.Equal(expected, LoopbackModelTransport.IsLoopbackEndpoint(endpoint));
    [Fact] public async Task NonLoopbackEndpointsAreRefusedWithoutAnyConnection()
    {
        var transport = new LoopbackModelTransport();
        foreach (var endpoint in new[] { "http://192.0.2.10/v1", "http://10.0.0.5:8080/v1", "https://127.0.0.1/v1" })
        {
            var outcome = await transport.SendAsync(AiProtocols.OpenAiCompatible, endpoint, Request());
            Assert.Equal("refused", outcome.Status);
            Assert.Equal("endpoint_not_loopback", outcome.Code);
            Assert.Equal(0, outcome.ResponseBytes);
            Assert.Equal(string.Empty, outcome.SentRequestJson);
            Assert.Equal(0, outcome.ElapsedMilliseconds);
            Assert.Null(outcome.Result);
        }
        // An unsupported protocol is refused before any request is built.
        var unsupported = await transport.SendAsync("SomeOtherProtocol", "http://127.0.0.1:5099/v1", Request());
        Assert.Equal("unsupported_protocol", unsupported.Code);
    }
    [Fact] public async Task AValidStubResponseIsParsedThroughTheRealAdapter()
    {
        var received = new List<string>();
        var (app, url) = await StartStubAsync(async context =>
        {
            using var reader = new StreamReader(context.Request.Body);
            received.Add(await reader.ReadToEndAsync());
            Assert.Null(context.Request.Headers.Authorization.FirstOrDefault());
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(OpenAiBody());
        });
        await using (app)
        {
            var outcome = await new LoopbackModelTransport().SendAsync(AiProtocols.OpenAiCompatible, url + "/v1/chat/completions", Request());
            Assert.Equal("parsed", outcome.Status);
            Assert.Null(outcome.Code);
            Assert.Equal(200, outcome.HttpStatus);
            Assert.True(outcome.ResponseBytes > 0);
            Assert.Equal("合成回答", outcome.Result!.Text);
            Assert.Equal(18, outcome.Result.Usage.TotalTokens);
            Assert.Equal("stop", outcome.Result.StopReason);
            // The outcome must include exactly what was sent, and that payload must contain no credential field.
            Assert.False(string.IsNullOrWhiteSpace(outcome.SentRequestJson));
            Assert.Equal(received.Single(), outcome.SentRequestJson);
            foreach (var forbidden in new[] { "authorization", "api_key", "apikey", "api-key", "secret", "password", "access_token", "auth_token", "client_secret", "bearer" })
            {
                Assert.DoesNotContain($"\"{forbidden}\"", outcome.SentRequestJson, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain($"\"{forbidden}s\"", outcome.SentRequestJson, StringComparison.OrdinalIgnoreCase);
            }
            Assert.DoesNotContain("Bearer ", outcome.SentRequestJson, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("sk-", outcome.SentRequestJson, StringComparison.Ordinal);
            using var sentOutcome = JsonDocument.Parse(outcome.SentRequestJson);
            Assert.Equal("demo-model", sentOutcome.RootElement.GetProperty("model").GetString());
            // The request that reached the stub must be the adapter's own shape, not a hand-rolled body.
            using var sent = JsonDocument.Parse(received.Single());
            Assert.Equal("demo-model", sent.RootElement.GetProperty("model").GetString());
            Assert.False(sent.RootElement.GetProperty("stream").GetBoolean());
            Assert.Equal(2, sent.RootElement.GetProperty("messages").GetArrayLength());
        }
    }
    [Fact] public async Task StubFailuresAreClassifiedWithoutEchoingTheBody()
    {
        var cases = new (Func<HttpContext, Task> Handler, string Expected)[]
        {
            (context => { context.Response.StatusCode = 500; return context.Response.WriteAsync("{\"error\":\"provider secret-ish text\"}"); }, "http_status_not_ok"),
            (context => context.Response.WriteAsync("{not-json"), "invalid_json"),
            (context => context.Response.WriteAsync("{\"object\":\"chat.completion\",\"choices\":[]}"), "exactly_one_choice_required"),
            (context => context.Response.WriteAsync(OpenAiBody() + new string(' ', LoopbackModelTransport.MaxResponseBytes)), "response_too_large"),
            (async context => { context.Response.StatusCode = 200; await context.Response.StartAsync(); await Task.Delay(TimeSpan.FromSeconds(30), context.RequestAborted); }, "loopback_timeout"),
        };
        foreach (var (handler, expected) in cases)
        {
            var (app, url) = await StartStubAsync(handler);
            await using (app)
            {
                var outcome = await new LoopbackModelTransport().SendAsync(AiProtocols.OpenAiCompatible, url + "/v1/chat/completions", Request());
                Assert.Equal(expected, outcome.Code);
                Assert.Null(outcome.Result);
                Assert.False(outcome.CredentialRead);
                Assert.True(outcome.LoopbackOnly);
                Assert.False(outcome.ProductionTransportImplemented);
            }
        }
        // A closed port is reported as unreachable rather than as a parse failure.
        var unreachable = await new LoopbackModelTransport().SendAsync(AiProtocols.OpenAiCompatible, "http://127.0.0.1:1/v1", Request());
        Assert.Equal("unreachable", unreachable.Status);
        Assert.Equal("loopback_unreachable", unreachable.Code);
    }
    [Fact] public async Task CallerCancellationIsPropagatedAsCancellation()
    {
        var (app, url) = await StartStubAsync(async context =>
        {
            await context.Response.StartAsync();
            await Task.Delay(TimeSpan.FromSeconds(30), context.RequestAborted);
        });
        await using (app)
        {
            using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                new LoopbackModelTransport().SendAsync(AiProtocols.OpenAiCompatible, url + "/v1/chat/completions", Request(), cancellation.Token));
        }
    }
}
