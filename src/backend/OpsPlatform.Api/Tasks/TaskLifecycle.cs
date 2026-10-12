namespace OpsPlatform.Api.Tasks;

public enum TaskState { AwaitingApproval, Approved, Queued, Running, Succeeded, Failed, Cancelled, OutcomeUnknown }
public enum TaskEvent { Approve, Enqueue, Start, Succeed, Fail, Cancel, Timeout, ReconcileSucceeded, ReconcileFailed }
public sealed record TaskSnapshot(TaskState State, int Version);
public sealed record TaskTransition(bool Accepted, string Code, TaskSnapshot Snapshot)
{
    public bool Executed => false;
}
// Pure lifecycle rules only: caller must authorize commands and persist via atomic compare-and-swap.
public static class TaskLifecycle
{
    public static TaskTransition Apply(TaskSnapshot snapshot, TaskEvent action, int expectedVersion)
    {
        if(snapshot is null) throw new ArgumentNullException(nameof(snapshot));
        if(!Enum.IsDefined(snapshot.State) || !Enum.IsDefined(action) || snapshot.Version < 1 || snapshot.Version == int.MaxValue)
            return new(false,"invalid_state_or_event",snapshot);
        if(expectedVersion != snapshot.Version) return new(false,"version_conflict",snapshot);
        TaskState? next=(snapshot.State,action) switch
        {
            (TaskState.AwaitingApproval,TaskEvent.Approve)=>TaskState.Approved,
            (TaskState.Approved,TaskEvent.Enqueue)=>TaskState.Queued,
            (TaskState.Queued,TaskEvent.Start)=>TaskState.Running,
            (TaskState.Running,TaskEvent.Succeed)=>TaskState.Succeeded,
            (TaskState.Running,TaskEvent.Fail)=>TaskState.Failed,
            (TaskState.Running,TaskEvent.Timeout)=>TaskState.OutcomeUnknown,
            (TaskState.OutcomeUnknown,TaskEvent.ReconcileSucceeded)=>TaskState.Succeeded,
            (TaskState.OutcomeUnknown,TaskEvent.ReconcileFailed)=>TaskState.Failed,
            (TaskState.AwaitingApproval or TaskState.Approved or TaskState.Queued,TaskEvent.Cancel)=>TaskState.Cancelled,
            _=>null
        };
        return next is { } state ? new(true,"transitioned",new(state,snapshot.Version+1)) : new(false,"transition_denied",snapshot);
    }
}
