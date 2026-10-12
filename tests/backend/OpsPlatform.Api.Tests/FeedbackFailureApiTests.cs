using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Services;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class FeedbackFailureApiTests
{
    private sealed class FixedClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(2026,1,2,3,4,5,TimeSpan.Zero);
    }
    [Fact]
    public async Task StartupClockControlsHttpFeedbackTimestamp()
    {
        var clock=new FixedClock();
        await using var app=AppBootstrap.Build([],builder=>
        {
            builder.Environment.EnvironmentName="Development";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string,string?>{{"Demo:Enabled","true"}});
            builder.WebHost.UseTestServer();builder.Services.AddSingleton<TimeProvider>(clock);
        });
        await app.StartAsync();using var client=app.GetTestClient();
        var response=await client.PostAsJsonAsync("/api/v1/feedback",new FeedbackRequest("bug","synthetic clock request","/integration"));
        Assert.Equal(HttpStatusCode.Created,response.StatusCode);
        var body=await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal(clock.GetUtcNow(),body.GetProperty("data").GetProperty("createdAt").GetDateTimeOffset());
    }
    private sealed class FailingStore : IDemoFeedbackStore
    {
        public void Add(FeedbackDto item) => throw new InvalidOperationException("SYNTHETIC_PRIVATE_STORAGE_DIAGNOSTIC");
        public IReadOnlyList<FeedbackDto> List() => throw new InvalidOperationException("SYNTHETIC_PRIVATE_STORAGE_DIAGNOSTIC");
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task StorageFailureReturnsGenericProblemWithoutDiagnostic(bool write)
    {
        await using var app=AppBootstrap.Build([],builder=>
        {
            builder.Environment.EnvironmentName="Development";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string,string?>{{"Demo:Enabled","true"}});
            builder.WebHost.UseTestServer();
            builder.Services.AddSingleton<IDemoFeedbackStore>(new FailingStore());
        });
        await app.StartAsync();using var client=app.GetTestClient();
        var response=write
            ? await client.PostAsJsonAsync("/api/v1/feedback",new FeedbackRequest("bug","synthetic request message","/integration"))
            : await client.GetAsync("/api/v1/feedback");
        Assert.Equal(HttpStatusCode.InternalServerError,response.StatusCode);
        Assert.Equal("application/problem+json",response.Content.Headers.ContentType?.MediaType);
        var body=await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("SYNTHETIC_PRIVATE_STORAGE_DIAGNOSTIC",body);
        Assert.DoesNotContain("synthetic request message",body);
        Assert.Contains("An unexpected error occurred",body);
    }
}
