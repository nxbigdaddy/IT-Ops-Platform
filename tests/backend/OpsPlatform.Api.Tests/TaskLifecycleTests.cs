using OpsPlatform.Api.Tasks;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class TaskLifecycleTests
{
    [Fact] public void CompleteTransitionMatrixHasOnlyExplicitEdges()
    {
        var allowed=new Dictionary<(TaskState,TaskEvent),TaskState>
        {
            [(TaskState.AwaitingApproval,TaskEvent.Approve)]=TaskState.Approved,
            [(TaskState.Approved,TaskEvent.Enqueue)]=TaskState.Queued,
            [(TaskState.Queued,TaskEvent.Start)]=TaskState.Running,
            [(TaskState.Running,TaskEvent.Succeed)]=TaskState.Succeeded,
            [(TaskState.Running,TaskEvent.Fail)]=TaskState.Failed,
            [(TaskState.Running,TaskEvent.Timeout)]=TaskState.OutcomeUnknown,
            [(TaskState.OutcomeUnknown,TaskEvent.ReconcileSucceeded)]=TaskState.Succeeded,
            [(TaskState.OutcomeUnknown,TaskEvent.ReconcileFailed)]=TaskState.Failed,
            [(TaskState.AwaitingApproval,TaskEvent.Cancel)]=TaskState.Cancelled,
            [(TaskState.Approved,TaskEvent.Cancel)]=TaskState.Cancelled,
            [(TaskState.Queued,TaskEvent.Cancel)]=TaskState.Cancelled
        };
        var checkedEdges=0;
        foreach(var state in Enum.GetValues<TaskState>()) foreach(var action in Enum.GetValues<TaskEvent>())
        {
            var original=new TaskSnapshot(state,10);
            var result=TaskLifecycle.Apply(original,action,10);
            var expected=allowed.TryGetValue((state,action),out var next);
            Assert.Equal(expected,result.Accepted);Assert.False(result.Executed);
            Assert.Equal(expected?next:state,result.Snapshot.State);
            Assert.Equal(expected?11:10,result.Snapshot.Version);
            Assert.False(TaskLifecycle.Apply(original,action,9).Accepted);
            checkedEdges++;
        }
        Assert.Equal(72,checkedEdges);
    }
    [Fact] public void TimeoutIsUnknownNotFailureAndCannotAutomaticallyRetry()
    {
        var timedOut=TaskLifecycle.Apply(new(TaskState.Running,3),TaskEvent.Timeout,3);
        Assert.True(timedOut.Accepted);Assert.Equal(TaskState.OutcomeUnknown,timedOut.Snapshot.State);
        foreach(var action in new[]{TaskEvent.Start,TaskEvent.Enqueue,TaskEvent.Succeed,TaskEvent.Fail,TaskEvent.Cancel,TaskEvent.Timeout})
            Assert.False(TaskLifecycle.Apply(timedOut.Snapshot,action,4).Accepted);
    }
    [Theory] [InlineData(TaskEvent.ReconcileSucceeded,TaskState.Succeeded)] [InlineData(TaskEvent.ReconcileFailed,TaskState.Failed)]
    public void ReconciliationRequiresUnknownStateAndCurrentVersion(TaskEvent action,TaskState expected)
    {
        Assert.Equal(expected,TaskLifecycle.Apply(new(TaskState.OutcomeUnknown,4),action,4).Snapshot.State);
        Assert.False(TaskLifecycle.Apply(new(TaskState.OutcomeUnknown,4),action,3).Accepted);
        Assert.False(TaskLifecycle.Apply(new(TaskState.Running,4),action,4).Accepted);
    }
    [Fact] public void HappyPathAdvancesVersionWithoutExecution()
    {
        var snapshot=new TaskSnapshot(TaskState.AwaitingApproval,1);
        foreach(var action in new[]{TaskEvent.Approve,TaskEvent.Enqueue,TaskEvent.Start,TaskEvent.Succeed})
        {var result=TaskLifecycle.Apply(snapshot,action,snapshot.Version);Assert.True(result.Accepted);Assert.False(result.Executed);snapshot=result.Snapshot;}
        Assert.Equal(TaskState.Succeeded,snapshot.State);Assert.Equal(5,snapshot.Version);
    }
    [Theory] [InlineData(TaskState.Succeeded)] [InlineData(TaskState.Failed)] [InlineData(TaskState.Cancelled)]
    public void TerminalTasksCannotRestart(TaskState state)
    {foreach(var action in Enum.GetValues<TaskEvent>()) Assert.False(TaskLifecycle.Apply(new(state,1),action,1).Accepted);}
    [Fact] public void RunningCannotPretendCancellationRolledBackEffects()
    {Assert.False(TaskLifecycle.Apply(new(TaskState.Running,1),TaskEvent.Cancel,1).Accepted);Assert.True(TaskLifecycle.Apply(new(TaskState.Running,1),TaskEvent.Fail,1).Accepted);}
    [Fact] public void StaleVersionDoesNotMutateSnapshot()
    {var original=new TaskSnapshot(TaskState.Queued,2);var result=TaskLifecycle.Apply(original,TaskEvent.Start,1);Assert.Equal("version_conflict",result.Code);Assert.Same(original,result.Snapshot);}
    [Fact] public void CannotSkipApprovalOrStartTwice()
    {Assert.False(TaskLifecycle.Apply(new(TaskState.AwaitingApproval,1),TaskEvent.Start,1).Accepted);Assert.False(TaskLifecycle.Apply(new(TaskState.Running,1),TaskEvent.Start,1).Accepted);}
    [Theory] [InlineData(TaskState.AwaitingApproval)] [InlineData(TaskState.Approved)] [InlineData(TaskState.Queued)]
    public void CancelBeforeExecutionAllowed(TaskState state)=>Assert.Equal(TaskState.Cancelled,TaskLifecycle.Apply(new(state,1),TaskEvent.Cancel,1).Snapshot.State);
    [Fact] public void UnknownAndOverflowRejected()
    {Assert.False(TaskLifecycle.Apply(new((TaskState)99,1),TaskEvent.Start,1).Accepted);Assert.False(TaskLifecycle.Apply(new(TaskState.Queued,int.MaxValue),TaskEvent.Start,int.MaxValue).Accepted);}
}
