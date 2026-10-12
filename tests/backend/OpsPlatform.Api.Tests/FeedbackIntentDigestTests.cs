using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Persistence;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class FeedbackIntentDigestTests
{
    [Fact] public void VersionOneAsciiGoldenVectorRemainsStable()
        =>Assert.Equal("2ac502c748c241e0112dcbe13430158bbc2bcba64fa76cdc1829a30cf0f025e8",FeedbackIntentDigest.Compute(new("bug","synthetic","/")));
    [Fact] public void FieldBoundariesAreNotPlainConcatenation()
    {
        Assert.NotEqual(FeedbackIntentDigest.Compute(new("bug","a/b","/c")),FeedbackIntentDigest.Compute(new("bug","a","/b/c")));
    }
    [Fact] public void TrimmedEquivalentMessagesShareStableIdentity()
    {
        var first=FeedbackIntentDigest.Compute(new("bug","  synthetic 中文\n","/integration"));
        var second=FeedbackIntentDigest.Compute(new("bug","synthetic 中文","/integration"));
        Assert.Equal(first,second);Assert.Matches("^[0-9a-f]{64}$",first);
        Assert.Equal(IdempotencyMatch.SameIntent,new IdempotencyIdentity("demo","feedback.add","key",first).Compare(new("demo","feedback.add","key",second)));
    }
    [Theory]
    [InlineData("question","synthetic","/")]
    [InlineData("bug","different","/")]
    [InlineData("bug","synthetic","/integration")]
    [InlineData("bug","synthetic",null)]
    public void MeaningfulChangesAlterDigest(string category,string message,string? page)
        =>Assert.NotEqual(FeedbackIntentDigest.Compute(new("bug","synthetic","/")),FeedbackIntentDigest.Compute(new(category,message,page)));
    [Fact] public void InvalidInputCannotGenerateDigest()
    {
        Assert.Throws<ArgumentException>(()=>FeedbackIntentDigest.Compute(new("other","synthetic","/")));
        Assert.Throws<ArgumentException>(()=>FeedbackIntentDigest.Compute(new("bug"," ","/")));
        Assert.Throws<ArgumentNullException>(()=>FeedbackIntentDigest.Compute(null!));
        Assert.Throws<ArgumentException>(()=>FeedbackIntentDigest.Compute(new("bug","\ud800","/")));
        Assert.Throws<ArgumentException>(()=>FeedbackIntentDigest.Compute(new("bug","synthetic","/\udc00")));
    }
}
