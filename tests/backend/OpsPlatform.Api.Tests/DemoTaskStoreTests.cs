using OpsPlatform.Api.Tasks;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class DemoTaskStoreTests
{
    [Fact] public async Task ConcurrentReadersObserveCompleteSnapshots()
    {
        IDemoTaskStore store=new DemoTaskStore();var task=store.Create().Task!;
        var start=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var writer=Task.Run(async()=>{
            await start.Task;var version=1;
            foreach(var action in new[]{TaskEvent.Approve,TaskEvent.Enqueue,TaskEvent.Start,TaskEvent.Timeout,TaskEvent.ReconcileSucceeded})
            {Assert.Equal(200,store.Apply(task.Id,action,version++).Status);await Task.Yield();}
        });
        var readers=Enumerable.Range(0,8).Select(_=>Task.Run(async()=>{
            await start.Task;
            for(var i=0;i<100;i++)
            {
                var snapshot=store.Read(task.Id)!;
                Assert.Equal(snapshot.Task.Snapshot.Version-1,snapshot.History.Count);
                if(snapshot.History.Count>0)
                {
                    var last=snapshot.History[^1];
                    Assert.Equal(snapshot.Task.Snapshot.Version,last.Version);
                    Assert.Equal(snapshot.Task.Snapshot.State,last.To);
                    Assert.All(snapshot.History,entry=>Assert.Equal(task.Id,entry.TaskId));
                }
                else Assert.Equal(TaskState.AwaitingApproval,snapshot.Task.Snapshot.State);
                await Task.Yield();
            }
        })).ToArray();
        start.SetResult();await Task.WhenAll(readers.Append(writer));
        Assert.Equal(6,store.Read(task.Id)!.Task.Snapshot.Version);
    }
    [Fact] public void InterfaceReadIsConsistentAndIsolated()
    {
        IDemoTaskStore store=new DemoTaskStore();var task=store.Create().Task!;
        var before=store.Read(task.Id)!;Assert.Empty(before.History);
        store.Apply(task.Id,TaskEvent.Approve,1);
        var after=store.Read(task.Id)!;
        Assert.Equal(1,before.Task.Snapshot.Version);Assert.Empty(before.History);
        Assert.Equal(after.Task.Snapshot.Version,Assert.Single(after.History).Version);
        ((DemoTaskJournal[])after.History)[0]=after.History[0] with {Version=999};
        Assert.Equal(2,store.Read(task.Id)!.History[0].Version);Assert.Null(store.Read(Guid.NewGuid()));
    }
    [Fact] public async Task ConcurrentOldVersionsHaveExactlyOneWinner()
    {
        var store=new DemoTaskStore();var task=store.Create().Task!;
        var results=await Task.WhenAll(Enumerable.Range(0,20).Select(_=>Task.Run(()=>store.Apply(task.Id,TaskEvent.Approve,1))));
        Assert.Single(results,r=>r.Status==200);Assert.Equal(19,results.Count(r=>r.Code=="version_conflict"));
        Assert.Equal(new TaskSnapshot(TaskState.Approved,2),store.Get(task.Id)!.Snapshot);
        Assert.All(results,r=>Assert.False(r.Executed));
        Assert.Single(store.History(task.Id));
    }
    [Fact] public async Task ConcurrentCreationHonorsCapacityAndUniqueIds()
    {
        var store=new DemoTaskStore();
        var results=await Task.WhenAll(Enumerable.Range(0,150).Select(_=>Task.Run(()=>store.Create())));
        var created=results.Where(result=>result.Status==201).Select(result=>result.Task!).ToArray();
        Assert.Equal(DemoTaskStore.Capacity,created.Length);
        Assert.Equal(50,results.Count(result=>result.Code=="capacity_reached"));
        Assert.Equal(created.Length,created.Select(task=>task.Id).Distinct().Count());
        Assert.All(created,task=>Assert.Equal(task,store.Get(task.Id)));
        var first=created[0];
        Assert.Equal(200,store.Apply(first.Id,TaskEvent.Cancel,1).Status);
        Assert.Equal("capacity_reached",store.Create().Code);
        Assert.Equal(TaskState.Cancelled,store.Get(first.Id)!.Snapshot.State);
    }
    [Fact] public void JournalContainsOnlyAcceptedTransitionsAndReturnsCopies()
    {
        var store=new DemoTaskStore();var task=store.Create().Task!;
        Assert.Empty(store.History(task.Id));
        store.Apply(task.Id,TaskEvent.Start,1);Assert.Empty(store.History(task.Id));
        store.Apply(task.Id,TaskEvent.Approve,1);store.Apply(task.Id,TaskEvent.Enqueue,2);
        var entries=store.History(task.Id);Assert.Equal(2,entries.Count);
        Assert.Equal(new DemoTaskJournal(1,task.Id,TaskEvent.Approve,TaskState.AwaitingApproval,TaskState.Approved,2),entries[0]);
        ((DemoTaskJournal[])entries)[0]=entries[0] with{Version=999};
        Assert.Equal(2,store.History(task.Id)[0].Version);
        Assert.Empty(store.History(Guid.NewGuid()));
    }
    [Fact] public void CapacityRejectsWithoutEvictingExistingTasks()
    {
        var store=new DemoTaskStore();var first=store.Create().Task!;
        for(var i=1;i<DemoTaskStore.Capacity;i++) Assert.Equal(201,store.Create().Status);
        Assert.Equal("capacity_reached",store.Create().Code);Assert.NotNull(store.Get(first.Id));
    }
    [Fact] public void InstancesAreIsolatedAndUnknownIdsAreNotCreated()
    {
        var store=new DemoTaskStore();var first=store.Create().Task!;
        Assert.Null(new DemoTaskStore().Get(first.Id));Assert.Equal(404,store.Apply(Guid.NewGuid(),TaskEvent.Start,1).Status);
    }
    [Fact] public void InvalidTransitionDoesNotAdvanceVersion()
    {
        var store=new DemoTaskStore();var task=store.Create().Task!;
        Assert.Equal(409,store.Apply(task.Id,TaskEvent.Start,1).Status);
        Assert.Equal(task,store.Get(task.Id));
    }
}
