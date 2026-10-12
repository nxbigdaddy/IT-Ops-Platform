using OpsPlatform.Api.Ai;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class AiConnectionPolicyTests
{
    private static AiConnectionDraft Valid => new("OpenAiCompatible", "https://api.example.invalid/v1", "demo-model", "secret://ai/demo", 30, 1000, 5000);
    private static readonly string[] Approved = ["api.example.invalid"];
    [Fact] public void ValidConfigurationNeverClaimsLiveVerification()
    {
        var result = AiConnectionPolicy.Check(Valid, Approved);
        Assert.True(result.ConfigurationValid); Assert.False(result.NetworkVerified); Assert.False(result.LiveCallEnabled);
        Assert.True(AiConnectionPolicy.Check(Valid with { Endpoint = "https://API.EXAMPLE.INVALID:443/v1" }, Approved).ConfigurationValid);
    }
    [Theory]
    [InlineData("http://api.example.invalid/v1")]
    [InlineData("https://api.example.invalid:444/v1")]
    [InlineData("https://user:mock@api.example.invalid/v1")]
    [InlineData("https://api.example.invalid/v1?key=mock")]
    [InlineData("https://api.example.invalid/v1#fragment")]
    [InlineData("https://api.example.invalid/%2fadmin")]
    [InlineData("https://127.0.0.1/v1")]
    [InlineData("https://[::1]/v1")]
    [InlineData("https://2130706433/v1")]
    [InlineData("https://0x7f000001/v1")]
    [InlineData("https://localhost/v1")]
    [InlineData("https://model.local/v1")]
    [InlineData("https://model.internal/v1")]
    [InlineData("https://api.example.invalid.attacker.invalid/v1")]
    [InlineData("https://api.example.invalid./v1")]
    public void UnsafeOrUnapprovedEndpointRejected(string endpoint)
        => Assert.False(AiConnectionPolicy.Check(Valid with { Endpoint = endpoint }, Approved).ConfigurationValid);
    [Fact] public void EvenApprovedIpOrPrivateNameIsRejected()
    {
        foreach (var host in new[] { "127.0.0.1", "2130706433", "model.internal", "model.local" })
            Assert.False(AiConnectionPolicy.Check(Valid with { Endpoint = $"https://{host}/v1" }, new[] {host}).ConfigurationValid);
    }
    [Fact] public void ApprovalIsExactAndRequired()
    {
        Assert.False(AiConnectionPolicy.Check(Valid, []).ConfigurationValid);
        Assert.False(AiConnectionPolicy.Check(Valid, ["*.example.invalid"]).ConfigurationValid);
        Assert.False(AiConnectionPolicy.Check(null, Approved).ConfigurationValid);
    }
    [Fact] public void LimitsProviderAndReferenceValidatedWithoutEcho()
    {
        AiConnectionDraft[] invalid = [Valid with {Provider="unknown"}, Valid with {Model=" "}, Valid with {SecretReference="mock-password"},
            Valid with {TimeoutSeconds=0}, Valid with {TimeoutSeconds=61}, Valid with {MaxOutputTokens=32769},
            Valid with {MaxOutputTokens=0}, Valid with {RequestBudgetTokens=999}, Valid with {RequestBudgetTokens=1000001}];
        foreach(var draft in invalid) { var result=AiConnectionPolicy.Check(draft,Approved); Assert.False(result.ConfigurationValid); Assert.DoesNotContain("mock-password",System.Text.Json.JsonSerializer.Serialize(result)); }
        Assert.True(AiConnectionPolicy.Check(Valid with {Provider="Anthropic"},Approved).ConfigurationValid);
    }
}
