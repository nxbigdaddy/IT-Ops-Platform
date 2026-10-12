namespace OpsPlatform.Api.Tasks;

public sealed record DemoTask(Guid Id, TaskSnapshot Snapshot)
{
    public bool IsDemo => true;
    public bool Executed => false;
    public string Persistence => "memory";
    public string Mode => "state-simulation-only";
}
public sealed record DemoTaskJournal(long Sequence, Guid TaskId, TaskEvent Event, TaskState From, TaskState To, int Version);
public sealed record DemoTaskUpdate(int Status, string Code, DemoTask? Task, int? ReplayedVersion = null)
{
    public string Persistence => "memory";
    public bool Executed => false;
}
// Bounded process-local CAS store behind Demo-only routes. No worker, approval consumption or production persistence.
public sealed class DemoTaskStore : IDemoTaskStore
{
    public const int Capacity = 100;
    private readonly object gate = new();
    private readonly Dictionary<Guid, TaskSnapshot> tasks = new();
    private readonly List<DemoTaskJournal> journal = new();
    // Current acyclic lifecycle permits at most five accepted transitions per task.
    public IReadOnlyList<DemoTaskJournal> History(Guid id)
    {
        lock(gate) return journal.Where(entry=>entry.TaskId==id).ToArray();
    }
    public DemoTaskRead? Read(Guid id)
    {
        lock(gate) return tasks.TryGetValue(id,out var snapshot)
            ? new(new(id,snapshot),journal.Where(entry=>entry.TaskId==id).ToArray()) : null;
    }
    public DemoTaskUpdate Create()
    {
        lock(gate)
        {
            if(tasks.Count >= Capacity) return new(409,"capacity_reached",null);
            var id=Guid.NewGuid();var snapshot=new TaskSnapshot(TaskState.AwaitingApproval,1);
            tasks.Add(id,snapshot);return new(201,"created",new(id,snapshot));
        }
    }
    public DemoTask? Get(Guid id)
    {
        lock(gate) return tasks.TryGetValue(id,out var snapshot) ? new(id,snapshot) : null;
    }
    public DemoTaskUpdate Apply(Guid id,TaskEvent action,int expectedVersion)
    {
        lock(gate)
        {
            if(!tasks.TryGetValue(id,out var snapshot)) return new(404,"task_not_found",null);
            var result=TaskLifecycle.Apply(snapshot,action,expectedVersion);
            if(!result.Accepted) return new(409,result.Code,new(id,snapshot));
            journal.Add(new(journal.Count+1L,id,action,snapshot.State,result.Snapshot.State,result.Snapshot.Version));
            tasks[id]=result.Snapshot;
            return new(200,result.Code,new(id,result.Snapshot));
        }
    }
}
