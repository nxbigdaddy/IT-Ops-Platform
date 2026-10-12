using OpsPlatform.Api.Persistence;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class IdempotencyIdentityTests
{
    private static readonly string Digest=new('a',64);
    [Fact] public void ExactIntentMatchesButChangedPayloadConflicts()
    {
        var identity=new IdempotencyIdentity("demo:actor","task.create","key-1",Digest);
        Assert.Equal(IdempotencyMatch.SameIntent,identity.Compare(new("demo:actor","task.create","key-1",Digest)));
        Assert.Equal(IdempotencyMatch.PayloadConflict,identity.Compare(new("demo:actor","task.create","key-1",new('b',64))));
    }
    [Theory]
    [InlineData("other:actor","task.create","key-1")]
    [InlineData("demo:actor","feedback.add","key-1")]
    [InlineData("demo:actor","task.create","key-2")]
    [InlineData("Demo:actor","task.create","key-1")]
    public void ScopeOperationAndKeyAreOrdinal(string scope,string operation,string key)
    {
        var identity=new IdempotencyIdentity("demo:actor","task.create","key-1",Digest);
        Assert.Equal(IdempotencyMatch.DifferentKey,identity.Compare(new(scope,operation,key,Digest)));
    }
    [Theory]
    [InlineData("")]
    [InlineData(" key")]
    [InlineData("key\n")]
    [InlineData("键")]
    [InlineData("key/value")]
    public void InvalidIdentifiersRejectedWithoutEcho(string input)
    {
        var error=Assert.Throws<ArgumentException>(()=>new IdempotencyIdentity("scope","op",input,Digest));
        Assert.Equal("key",error.ParamName);
    }
    [Fact] public void BoundsAndCanonicalDigestEnforced()
    {
        Assert.Throws<ArgumentException>(()=>new IdempotencyIdentity(new('x',129),"op","key",Digest));
        Assert.Throws<ArgumentException>(()=>new IdempotencyIdentity("scope","op","key",new('A',64)));
        Assert.Throws<ArgumentException>(()=>new IdempotencyIdentity("scope","op","key",new('a',63)));
        Assert.Throws<ArgumentException>(()=>new IdempotencyIdentity("scope","op","key",null!));
    }
}
