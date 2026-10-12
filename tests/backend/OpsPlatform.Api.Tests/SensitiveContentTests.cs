using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Persistence;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class SensitiveContentTests
{
    [Theory]
    [InlineData("password=DemoSecret123")]
    [InlineData("PASSWORD : hunter2000")]
    [InlineData("api_key=abcdefghijklmnop")]
    [InlineData("client_secret = 0123456789abcdef")]
    [InlineData("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")]
    [InlineData("-----BEGIN RSA PRIVATE KEY-----")]
    [InlineData("sk-abcdefghijklmnopqrstuvwx")]
    [InlineData("AKIAIOSFODNN7EXAMPLE")]
    [InlineData("user id=sa;password=DemoSecret123")]
    [InlineData("secret: 0123456789abcdef")]
    public void CredentialShapesAreDetected(string text)=>Assert.True(SensitiveContent.Contains(text),text);
    [Theory]
    [InlineData("")]
    [InlineData("请为演示资产补充巡检说明。")]
    [InlineData("密码策略评审记录：仅描述流程，不含任何凭据。")]
    [InlineData("password fields must be reviewed")]
    [InlineData("密码字段需要评审")]
    [InlineData("keyboard shortcut list")]
    [InlineData("select datname from pg_stat_activity")]
    [InlineData("updated_at = 2026-10-10")]
    public void OrdinaryTextIsNotFlagged(string text)=>Assert.False(SensitiveContent.Contains(text),text);
    [Fact] public void ContainersAreNullSafe()=>Assert.False(SensitiveContent.Contains(null));
    [Fact]
    public async Task BothWritePathsRefuseCredentialShapedText()
    {
        await using var app=AppBootstrap.Build([],builder=>
        {
            builder.Environment.EnvironmentName="Development";
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string,string?>{{"Demo:Enabled","true"}});
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();using var client=app.GetTestClient();
        var feedback=await client.PostAsJsonAsync("/api/v1/feedback",new FeedbackRequest("bug","password=DemoSecret123","/assets",null));
        Assert.Equal(HttpStatusCode.BadRequest,feedback.StatusCode);
        var feedbackText=await feedback.Content.ReadAsStringAsync();
        Assert.DoesNotContain("DemoSecret123",feedbackText);
        // The ordinary synthetic message must still be accepted.
        Assert.Equal(HttpStatusCode.Created,(await client.PostAsJsonAsync("/api/v1/feedback",new FeedbackRequest("bug","仅自动化验证的合成反馈","/assets",null))).StatusCode);
        var prompt=await client.PostAsJsonAsync("/api/v1/prompts/alert-explanation/versions",new PromptVersionRequest("api_key=abcdefghijklmnop 用于演示",1));
        Assert.Equal(HttpStatusCode.BadRequest,prompt.StatusCode);
        Assert.DoesNotContain("abcdefghijklmnop",await prompt.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Created,(await client.PostAsJsonAsync("/api/v1/prompts/alert-explanation/versions",new PromptVersionRequest("根据 {{asset_name}} 的 {{alert_summary}} 区分事实与假设；不执行操作。",1))).StatusCode);
    }
}
