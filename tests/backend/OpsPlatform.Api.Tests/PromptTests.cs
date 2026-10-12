using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Services;
using Xunit;

namespace OpsPlatform.Api.Tests;

public sealed class PromptTests
{
    private const string Id = "alert-explanation";
    private const string Url = "/api/v1/prompts/" + Id;

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

    [Fact]
    public async Task CatalogCreateReadRestoreAreDraftAndMemoryOnly()
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        var list = (await client.GetFromJsonAsync<DemoResponse<PromptDto[]>>("/api/v1/prompts"))!;
        Assert.True(list.IsDemo);
        Assert.Equal("memory", list.Persistence);
        Assert.Equal(3, list.Data.Length);
        Assert.All(list.Data, p =>
        {
            Assert.Equal("draft", p.Status);
            Assert.False(p.ModelExecutionEnabled);
            Assert.Equal(p.Variables, p.Schema.Select(s => s.Name));
            Assert.All(p.Schema, s => Assert.False(string.IsNullOrWhiteSpace(s.Example)));
        });
        var original = (await client.GetFromJsonAsync<DemoResponse<PromptDto>>(Url))!.Data;
        var response = await client.PostAsJsonAsync(Url + "/versions", new { content = "解释 {{asset_name}}：{{alert_summary}}", expectedVersion = 1 });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var updated = (await response.Content.ReadFromJsonAsync<DemoResponse<PromptDto>>())!;
        Assert.Equal("memory", updated.Persistence);
        Assert.Equal(2, updated.Data.CurrentVersion);
        var restoredResponse = await client.PostAsJsonAsync(Url + "/restore", new { sourceVersion = 1, expectedVersion = 2 });
        Assert.Equal(HttpStatusCode.Created, restoredResponse.StatusCode);
        var restored = (await restoredResponse.Content.ReadFromJsonAsync<DemoResponse<PromptDto>>())!.Data;
        Assert.Equal(3, restored.CurrentVersion);
        Assert.Equal(original.Content, restored.Content);
        Assert.Equal(1, restored.Versions[0].SourceVersion);
        Assert.Equal(new[] { 3, 2, 1 }, restored.Versions.Select(v => v.Version));
        Assert.All(restored.Versions, v => Assert.Equal("draft", v.Status));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/prompt-templates")).StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await client.DeleteAsync(Url)).StatusCode);
        Assert.Equal(1, new PromptService().Get(Id)!.CurrentVersion);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" \r\n ")]
    [InlineData("{{ticket}}")]
    [InlineData("{{unknown}}")]
    [InlineData("{{Asset_name}}")]
    [InlineData("{{ evidence }}")]
    [InlineData("{{evidence}")]
    [InlineData("{{{evidence}}}")]
    [InlineData("{{evidence.name}}")]
    public async Task RejectsInvalidContentWithoutCreatingVersion(string? content)
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        var response = await client.PostAsJsonAsync(Url + "/versions", new { content, expectedVersion = 1 });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(problem.GetProperty("isDemo").GetBoolean());
        Assert.True(problem.GetProperty("errors").TryGetProperty("content", out _));
        Assert.Equal(1, (await client.GetFromJsonAsync<DemoResponse<PromptDto>>(Url))!.Data.CurrentVersion);
    }

    [Theory]
    [InlineData("{{ asset_name }}")]
    [InlineData("{{\t\r\nasset_name\v\f }}")]
    [InlineData("{{\u00A0\u1680\u2000\u2028\u2029\u202F\u205F\u3000\uFEFFasset_name\uFEFF}}")]
    [InlineData("JSON: {\"asset\": \"demo\"}")]
    [InlineData("{ literal } {asset_name} standalone { and }")]
    [InlineData("{ {{asset_name}} }")]
    [InlineData("{{asset_name}}{{ alert_summary }}")]
    [InlineData("plain text with no required variable references")]
    public void AcceptsWhitespaceAndLiteralSingleBracesWithoutRewritingContent(string content)
    {
        var service = new PromptService();
        Assert.Equal(201, service.AddVersion(Id, new(content, 1)).StatusCode);
        Assert.Equal(content, service.Get(Id)!.Content);
    }

    [Theory]
    [InlineData("{{Asset_name}}")]
    [InlineData("{{ unknown }}")]
    [InlineData("{{constructor}}")]
    [InlineData("{{__proto__}}")]
    [InlineData("{{asset-name}}")]
    [InlineData("{{asset.name}}")]
    [InlineData("{{asset name}}")]
    [InlineData("{{1asset_name}}")]
    [InlineData("{{}}")]
    [InlineData("{{ }}")]
    [InlineData("{{asset_name}")]
    [InlineData("{asset_name}}")]
    [InlineData("{{asset_name")]
    [InlineData("asset_name}}")]
    [InlineData("{{{asset_name}}}")]
    [InlineData("{{{asset_name}}")]
    [InlineData("{{asset_name}}}")]
    [InlineData("{{{{asset_name}}}}")]
    [InlineData("{{ asset_name } }")]
    [InlineData("{{asset_name}} {{")]
    [InlineData("{{\u0085asset_name}}")]
    [InlineData("{{\u200Basset_name}}")]
    public void RejectsMalformedOrUnknownTokensWithoutMutation(string content)
    {
        var service = new PromptService();
        var result = service.AddVersion(Id, new(content, 1));
        Assert.Equal(400, result.StatusCode);
        Assert.Equal("validation_failed", result.Code);
        Assert.Equal(1, service.Get(Id)!.CurrentVersion);
    }

    [Theory]
    [InlineData("alert-explanation", "alerts", "asset_name", "alert_summary", "severity")]
    [InlineData("ticket-summary", "tickets", "ticket_id", "ticket_details", "asset_name")]
    [InlineData("inspection-report", "inspection", "asset_name", "inspection_result", "inspection_date")]
    public void AllFeatureSchemasUseNamedVariablesWithSampleOnlyRequiredFlags(string id, string feature,
        string firstRequired, string secondRequired, string optional)
    {
        var service = new PromptService();
        var prompt = service.Get(id)!;
        Assert.Equal(feature, prompt.Feature);
        Assert.Equal(new[] { firstRequired, secondRequired, optional }, prompt.Schema.Select(v => v.Name));
        Assert.Equal(new[] { true, true, false }, prompt.Schema.Select(v => v.Required));
        Assert.All(prompt.Schema, v => Assert.Equal("string", v.Type));
        Assert.Equal(201, service.AddVersion(id, new("no variable references", 1)).StatusCode);
        Assert.Equal(201, service.AddVersion(id, new($"{{{{ {optional} }}}}", 2)).StatusCode);
    }

    [Fact]
    public void LengthBoundAndSchemaAreEnforcedInService()
    {
        var service = new PromptService();
        Assert.Equal(400, service.AddVersion(Id, new(new string('x', 4001), 1)).StatusCode);
        Assert.Equal(400, service.AddVersion(Id, new("hello", 0)).StatusCode);
        Assert.Equal(201, service.AddVersion(Id, new(new string('x', 4000), 1)).StatusCode);
        Assert.Equal(400, service.AddVersion("ticket-summary", new("{{evidence}}", 1)).StatusCode);
        Assert.Equal(201, service.AddVersion("ticket-summary", new("{{ticket_id}} {{ticket_details}}", 1)).StatusCode);
        Assert.Equal(201, service.AddVersion("inspection-report", new("{{inspection_result}}", 1)).StatusCode);
    }

    [Fact]
    public async Task ConflictsMissingIdsAndInvalidRestoreHaveExplicitCodes()
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        await client.PostAsJsonAsync(Url + "/versions", new { content = "v2", expectedVersion = 1 });
        foreach (var path in new[] { "/versions", "/restore" })
        {
            var conflict = await client.PostAsJsonAsync(Url + path, new { content = "stale", sourceVersion = 1, expectedVersion = 1 });
            Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
            Assert.Equal("version_conflict", (await conflict.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
        }
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/v1/prompts/missing")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/v1/prompts/missing/versions", new { content = "x", expectedVersion = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync(Url + "/restore", new { sourceVersion = 99, expectedVersion = 2 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Url + "/restore", new { sourceVersion = 0, expectedVersion = 2 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(Url + "/versions", new { content = "missing version" })).StatusCode);
    }

    [Fact]
    public void CapacityRejectsEditsAndRestoresWithoutEvictingHistory()
    {
        var service = new PromptService();
        for (var i = 1; i < PromptService.MaxVersions; i++)
            Assert.Equal(201, service.AddVersion(Id, new($"v{i + 1}", i)).StatusCode);
        Assert.Equal("version_limit_reached", service.AddVersion(Id, new("overflow", 20)).Code);
        Assert.Equal("version_limit_reached", service.Restore(Id, new(1, 20)).Code);
        var snapshot = service.Get(Id)!;
        Assert.Equal(20, snapshot.CurrentVersion);
        Assert.Equal(20, snapshot.Versions.Count);
        Assert.Equal(1, snapshot.Versions[^1].Version);
        // Mutating a returned array must not mutate the store.
        ((PromptVersionDto[])snapshot.Versions)[0] = new(999, "external", DateTimeOffset.UtcNow);
        ((PromptVariableDto[])snapshot.Schema)[0] = new("unknown", "string", "", "");
        Assert.Equal(20, service.Get(Id)!.Versions[0].Version);
        Assert.DoesNotContain(service.Get(Id)!.Schema, v => v.Name == "unknown");
        Assert.Equal(1, service.Get("ticket-summary")!.CurrentVersion);
    }

    [Fact]
    public async Task ConcurrentHttpEditsAndRestoresHaveExactlyOneWinner()
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        var responses = await Task.WhenAll(Enumerable.Range(0, 32).Select(i => i % 2 == 0
            ? client.PostAsJsonAsync(Url + "/versions", new { content = $"candidate {i}", expectedVersion = 1 })
            : client.PostAsJsonAsync(Url + "/restore", new { sourceVersion = 1, expectedVersion = 1 })));
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Created);
        Assert.Equal(31, responses.Count(r => r.StatusCode == HttpStatusCode.Conflict));
        var data = (await client.GetFromJsonAsync<DemoResponse<PromptDto>>(Url))!.Data;
        Assert.Equal(2, data.CurrentVersion);
        Assert.Equal(2, data.Versions.Count);
        foreach (var response in responses) response.Dispose();
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    [InlineData("Development")]
    public async Task AllPromptRoutesFailClosedWithoutDevelopmentDemo(string environment)
    {
        await using var app = await Start(environment, false);
        using var client = app.GetTestClient();
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/api/v1/prompts")).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync(Url)).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.PostAsJsonAsync(Url + "/versions", new { content = "x", expectedVersion = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.PostAsJsonAsync(Url + "/restore", new { sourceVersion = 1, expectedVersion = 1 })).StatusCode);
    }

    [Theory]
    [InlineData("{")]
    [InlineData("null")]
    [InlineData("{\"expectedVersion\":\"invalid\"}")]
    [InlineData("{\"expectedVersion\":2147483648}")]
    public async Task InvalidJsonBodiesReturnSafeProblemDetails(string json)
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        foreach (var path in new[] { "/versions", "/restore" })
        {
            var response = await client.PostAsync(Url + path,
                new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
            var body = await response.Content.ReadAsStringAsync();
            Assert.DoesNotContain("stackTrace", body, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("Exception", body, StringComparison.OrdinalIgnoreCase);
            Assert.True(JsonSerializer.Deserialize<JsonElement>(body).GetProperty("isDemo").GetBoolean());
        }
    }

    [Fact]
    public async Task PromptMutationsRejectCrossOriginRemoteHostAndRemotePeer()
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        foreach (var path in new[] { "/versions", "/restore" })
        {
            client.DefaultRequestHeaders.Host = "example.invalid";
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(Url + path, new { })).StatusCode);
            client.DefaultRequestHeaders.Host = "localhost";
            client.DefaultRequestHeaders.Add("Origin", "https://example.invalid");
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(Url + path, new { })).StatusCode);
            client.DefaultRequestHeaders.Remove("Origin");
            var context = await app.GetTestServer().SendAsync(context =>
            {
                context.Request.Method = "POST";
                context.Request.Scheme = "http";
                context.Request.Host = new("localhost");
                context.Request.Path = Url + path;
                context.Connection.RemoteIpAddress = IPAddress.Parse("192.0.2.10");
            });
            Assert.Equal(403, context.Response.StatusCode);
        }
        client.DefaultRequestHeaders.Add("Origin", "http://localhost");
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(Url + "/versions", new { content = "same origin", expectedVersion = 1 })).StatusCode);
    }
}
