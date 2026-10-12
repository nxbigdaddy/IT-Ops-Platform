using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using OpsPlatform.Api.Ai;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class AiContractPreflightTests
{
    private static async Task<WebApplication> Start(string environment="Development",bool demo=true)
    {
        var app=AppBootstrap.Build([],builder=>
        {
            builder.Environment.EnvironmentName=environment;
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(new Dictionary<string,string?>{{"Demo:Enabled",demo.ToString()}});
            builder.WebHost.UseTestServer();
        });
        await app.StartAsync();return app;
    }
    private static AiContractDraft Draft(string protocol="OpenAiCompatible")=>new(protocol,"demo-model","演示系统提示","演示用户文本",256,0.2);
    [Fact] public void EveryAcceptedProtocolBuildsAPayloadWithoutTransportOrCredentials()
    {
        foreach(var protocol in AiProtocols.Accepted)
        {
            var check=AiContractPreflight.Build(Draft(protocol));
            Assert.True(check.ConfigurationValid);Assert.Empty(check.Errors);
            var preview=check.Preview!;
            Assert.Equal(protocol,preview.Protocol);Assert.False(preview.NetworkVerified);Assert.False(preview.TransportImplemented);
            Assert.False(preview.CredentialRead);Assert.True(preview.SyntheticInput);Assert.Equal("demo-model",preview.Model);
            Assert.Equal(JsonValueKind.Object,preview.Request.ValueKind);
            Assert.True(preview.Request.TryGetProperty("model",out var model));Assert.Equal("demo-model",model.GetString());
            Assert.True(preview.Request.TryGetProperty("stream",out var stream));Assert.False(stream.GetBoolean());
            Assert.Equal("演示系统提示".Length+"演示用户文本".Length,preview.InputCharacters);
            Assert.DoesNotContain("secret",preview.Request.GetRawText(),StringComparison.OrdinalIgnoreCase);
        }
    }
    [Fact] public void UnsupportedProtocolAndOversizedSyntheticInputAreRejectedWithoutEcho()
    {
        Assert.Contains(AiContractPreflight.Build(Draft("openai-compatible")).Errors,error=>error.Code=="unsupported");
        Assert.Contains(AiContractPreflight.Build(null).Errors,error=>error.Code=="required");
        var oversized=AiContractPreflight.Build(new AiContractDraft("OpenAiCompatible","demo-model","",new string('x',AiContractPreflight.MaxSyntheticCharacters+1),256,0.2));
        Assert.Contains(oversized.Errors,error=>error.Code=="synthetic_input_too_large");Assert.Null(oversized.Preview);
        var badTokens=AiContractPreflight.Build(new AiContractDraft("Anthropic","demo-model","","synthetic",0,0.2));
        Assert.False(badTokens.ConfigurationValid);Assert.Null(badTokens.Preview);
        // Only reserved synthetic model names may reach a payload; a real vendor id is refused.
        foreach(var model in new[]{"gpt-4o","claude-3-5-sonnet","demo-","Demo-model","demo_model","demo-model "})
            Assert.Contains(AiContractPreflight.Build(new AiContractDraft("OpenAiCompatible",model,"","synthetic",16,0.2)).Errors,error=>error.Code=="not_reserved_demo_model");
        Assert.True(AiContractPreflight.Build(new AiContractDraft("OpenAiCompatible","demo-model-2","","synthetic",16,0.2)).ConfigurationValid);
        var echoed=JsonSerializer.Serialize(badTokens);Assert.DoesNotContain("synthetic",echoed,StringComparison.Ordinal);
    }
    [Fact] public async Task RouteIsDemoOnlyAndGated()
    {
        await using(var app=await Start())
        {
            using var client=app.GetTestClient();
            var response=await client.PostAsJsonAsync("/api/v1/ai-contract-preflight",Draft());
            Assert.Equal(HttpStatusCode.OK,response.StatusCode);
            var body=await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("none",body.GetProperty("persistence").GetString());Assert.True(body.GetProperty("isDemo").GetBoolean());
            var data=body.GetProperty("data");Assert.True(data.GetProperty("configurationValid").GetBoolean());
            Assert.Equal("OpenAiCompatible",data.GetProperty("preview").GetProperty("protocol").GetString());
            foreach(var flag in new[]{"networkVerified","transportImplemented","credentialRead"})Assert.False(data.GetProperty("preview").GetProperty(flag).GetBoolean());
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/ai-contract-preflight",Draft("openai-compatible"))).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest,(await client.PostAsJsonAsync("/api/v1/ai-contract-preflight",new{protocol="OpenAiCompatible",model="demo-model",system="",user="synthetic",maxTokens=16,temperature=0.2,apiKey="demo"})).StatusCode);
            using var foreign=new HttpRequestMessage(HttpMethod.Post,"/api/v1/ai-contract-preflight"){Content=JsonContent.Create(Draft())};
            foreign.Headers.Add("Origin","https://foreign.example.invalid");Assert.Equal(HttpStatusCode.Forbidden,(await client.SendAsync(foreign)).StatusCode);
        }
        await using(var app=await Start("Production",false)){using var client=app.GetTestClient();Assert.Equal(HttpStatusCode.ServiceUnavailable,(await client.PostAsJsonAsync("/api/v1/ai-contract-preflight",Draft())).StatusCode);}
    }
}
