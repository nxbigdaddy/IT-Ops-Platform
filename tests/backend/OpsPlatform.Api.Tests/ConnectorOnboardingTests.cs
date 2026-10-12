using OpsPlatform.Api.Configuration;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class ConnectorOnboardingTests
{
    [Fact] public void EveryCandidatePublishesAUsableOnboardingChecklist()
    {
        foreach(var candidate in ConnectorRegistry.List())
        {
            var items=candidate.RequiredBeforeOnboarding;
            Assert.InRange(items.Length,1,8);
            Assert.All(items,item=>Assert.False(string.IsNullOrWhiteSpace(item)));
            Assert.All(items,item=>Assert.InRange(item.Length,1,64));
            Assert.Equal(items.Length,items.Distinct(StringComparer.Ordinal).Count());
        }
        Assert.Equal(ConnectorRegistry.List().Count,ConnectorOnboarding.Required.Count);
        // An unknown identifier must not invent a checklist.
        Assert.Empty(ConnectorOnboarding.For("demo-unknown"));
    }
}
