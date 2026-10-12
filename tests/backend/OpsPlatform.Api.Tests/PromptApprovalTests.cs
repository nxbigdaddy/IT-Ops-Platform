using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Contracts;
using Xunit;
namespace OpsPlatform.Api.Tests;
// Publishing must carry an approval record. This is a process check inside the prototype, not a security control:
// without authentication an approver name proves nothing, and no approval system is integrated.
public sealed class PromptApprovalTests
{
    private static async Task<WebApplication> Start()
    {
        var app = AppBootstrap.Build([], builder =>
        {
            builder.Environment.EnvironmentName = "Development";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Demo:Enabled"] = "true" });
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();
        return app;
    }
    [Theory]
    [InlineData(null, "演示审批人")]
    [InlineData("", "演示审批人")]
    [InlineData("   ", "演示审批人")]
    [InlineData("approval://prompt/demo", "演示审批人")]
    [InlineData("approval://prompt/demo/0", "演示审批人")]
    [InlineData("approval://prompt/demo/1/extra", "演示审批人")]
    [InlineData("approval://prompt/DEMO/1", "演示审批人")]
    [InlineData("approval://ticket/demo/1", "演示审批人")]
    [InlineData("approval://prompt/demo/1", null)]
    [InlineData("approval://prompt/demo/1", "   ")]
    [InlineData("approval://prompt/demo/1", "演示审批人")]
    public async Task MalformedApprovalRecordsAreRejected(string? reference, string? approvedBy)
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        var response = await client.PostAsJsonAsync("/api/v1/prompts/alert-explanation/publish", new PromptPublishRequest(1, reference, approvedBy));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var text = await response.Content.ReadAsStringAsync();
        Assert.Contains("validation_failed", text);
        // The rejection must not echo the submitted approver name.
        if (!string.IsNullOrWhiteSpace(approvedBy) && approvedBy != "x") Assert.DoesNotContain(approvedBy, text);
        // Nothing may be published by a rejected request.
        var prompt = await client.GetFromJsonAsync<JsonElement>("/api/v1/prompts/alert-explanation");
        Assert.Equal(0, prompt.GetProperty("data").GetProperty("publishedVersion").GetInt32());
    }
    [Fact] public async Task AValidApprovalIsRecordedOnTheImmutableRevision()
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        var published = await client.PostAsJsonAsync("/api/v1/prompts/alert-explanation/publish", new PromptPublishRequest(1, "approval://prompt/alert-explanation/7", "演示审批人"));
        Assert.Equal(HttpStatusCode.Created, published.StatusCode);
        var body = (await published.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        var revision = body.GetProperty("published")[0];
        Assert.Equal("approval://prompt/alert-explanation/7", revision.GetProperty("approvalReference").GetString());
        Assert.Equal("演示审批人", revision.GetProperty("approvedBy").GetString());
        Assert.Equal(1, revision.GetProperty("publishedFrom").GetInt32());
        // It must survive a reload of the prompt and appear in the binding view.
        var reloaded = await client.GetFromJsonAsync<JsonElement>("/api/v1/prompts/alert-explanation");
        Assert.Equal("approval://prompt/alert-explanation/7", reloaded.GetProperty("data").GetProperty("published")[0].GetProperty("approvalReference").GetString());
        var bindings = await client.GetFromJsonAsync<JsonElement>("/api/v1/prompt-bindings");
        var current = bindings.GetProperty("data").EnumerateArray().Single(item => item.GetProperty("promptId").GetString() == "alert-explanation");
        Assert.Equal("published-current", current.GetProperty("bindingStatus").GetString());
        Assert.Equal(1, current.GetProperty("publishedFrom").GetInt32());
    }
    [Fact] public async Task OneApprovalReferenceAuthorisesOnlyOnePublish()
    {
        await using var app = await Start();
        using var client = app.GetTestClient();
        var reference = "approval://prompt/shared/42";
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/v1/prompts/alert-explanation/publish", new PromptPublishRequest(1, reference, "演示审批人"))).StatusCode);
        // The same reference cannot be reused for another prompt or another version.
        var reused = await client.PostAsJsonAsync("/api/v1/prompts/ticket-summary/publish", new PromptPublishRequest(1, reference, "演示审批人"));
        Assert.Equal(HttpStatusCode.Conflict, reused.StatusCode);
        Assert.Contains("approval_reference_reused", await reused.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/v1/prompts/ticket-summary/publish", new PromptPublishRequest(1, "approval://prompt/ticket-summary/43", "演示审批人"))).StatusCode);
        // Approver names are trimmed before being recorded.
        var trimmed = await client.PostAsJsonAsync("/api/v1/prompts/inspection-report/publish", new PromptPublishRequest(1, "approval://prompt/inspection-report/44", "  演示审批人  "));
        var body = (await trimmed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
        Assert.Equal("演示审批人", body.GetProperty("published")[0].GetProperty("approvedBy").GetString());
    }
}
