using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Services;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class FeedbackStoreTests
{
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
    private sealed class FailingStore : IDemoFeedbackStore
    {
        public int Writes { get; private set; }
        public void Add(FeedbackDto item) { Writes++; throw new InvalidOperationException("synthetic storage failure"); }
        public IReadOnlyList<FeedbackDto> List() => throw new InvalidOperationException("synthetic read failure");
    }
    [Fact] public void StorageFailureIsNotReportedAsSuccessfulFeedback()
    {
        var store=new FailingStore();var service=new FeedbackService(store);
        Assert.Throws<InvalidOperationException>(()=>service.Add(new FeedbackRequest("bug","synthetic feedback","/")));
        Assert.Equal(1,store.Writes);
        Assert.Throws<InvalidOperationException>(()=>service.List());
    }
    [Fact] public void InvalidFeedbackDoesNotReachFailingStorage()
    {
        var store=new FailingStore();var service=new FeedbackService(store);
        Assert.Throws<ArgumentException>(()=>service.Add(new FeedbackRequest("unknown","synthetic feedback","/")));
        Assert.Equal(0,store.Writes);
    }
    [Fact] public void FeedbackTimestampUsesInjectedClock()
    {
        var instant=new DateTimeOffset(2026,1,2,3,4,5,TimeSpan.Zero);
        var service=new FeedbackService(new InMemoryDemoFeedbackStore(),new FixedClock(instant));
        var item=service.Add(new FeedbackRequest("bug","synthetic clock test","/"));
        Assert.Equal(instant,item.CreatedAt);Assert.Equal(instant,Assert.Single(service.List()).CreatedAt);
    }
    [Fact] public async Task SharedStoreConcurrentWritesRemainBounded()
    {
        IDemoFeedbackStore store=new InMemoryDemoFeedbackStore();
        var services=Enumerable.Range(0,4).Select(_=>new FeedbackService(store)).ToArray();
        var start=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var writers=Enumerable.Range(0,300).Select(index=>Task.Run(async()=>{
            await start.Task;
            return services[index%services.Length].Add(new FeedbackRequest("suggestion",$"synthetic-{index}","/integration"));
        })).ToArray();
        start.SetResult();var created=await Task.WhenAll(writers);var retained=store.List();
        Assert.Equal(300,created.Select(item=>item.Id).Distinct().Count());
        Assert.Equal(InMemoryDemoFeedbackStore.Capacity,retained.Count);
        Assert.Equal(retained.Count,retained.Select(item=>item.Id).Distinct().Count());
        var ids=created.Select(item=>item.Id).ToHashSet();Assert.All(retained,item=>Assert.Contains(item.Id,ids));
        foreach(var service in services)Assert.Equal(retained.ToArray(),service.List().ToArray());
    }
    [Fact] public void ServicesCanShareExplicitDemoStoreWithoutSharingValidationState()
    {
        IDemoFeedbackStore store=new InMemoryDemoFeedbackStore();var first=new FeedbackService(store);var second=new FeedbackService(store);
        var item=first.Add(new FeedbackRequest("bug","synthetic feedback","/integration"));
        Assert.Equal(item,Assert.Single(second.List()));
        Assert.Throws<ArgumentException>(()=>second.Add(new FeedbackRequest("unknown","synthetic","/")));
        Assert.Single(store.List());
    }
    [Fact] public void StoreReadIsIsolatedAndNewestFirst()
    {
        IDemoFeedbackStore store=new InMemoryDemoFeedbackStore();var service=new FeedbackService(store);
        var first=service.Add(new FeedbackRequest("bug","first synthetic","/"));var snapshot=store.List();
        var second=service.Add(new FeedbackRequest("bug","second synthetic","/"));Assert.Single(snapshot);Assert.Equal(second,store.List()[0]);
        ((FeedbackDto[])snapshot)[0]=second;Assert.Equal(first,store.List()[1]);
    }
}
