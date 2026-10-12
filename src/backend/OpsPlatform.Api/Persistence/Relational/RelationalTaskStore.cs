using Microsoft.EntityFrameworkCore;
using OpsPlatform.Api.Tasks;

namespace OpsPlatform.Api.Persistence.Relational;

// Relational task store: the compare-and-swap is a conditional UPDATE on the version column, and the journal
// row is appended inside the same transaction, so a lost update cannot be recorded as success.
// Development-only: no worker, no approval consumption, no retention policy.
public sealed class RelationalTaskStore(DbContextOptions<OpsPlatformDbContext> options) : IDemoTaskStore
{
    public DemoTaskUpdate Create()
    {
        using var context = new OpsPlatformDbContext(options);
        if (context.Tasks.Count() >= DemoTaskStore.Capacity) return new(409, "capacity_reached", null);
        var id = Guid.NewGuid();
        var snapshot = new TaskSnapshot(TaskState.AwaitingApproval, 1);
        context.Tasks.Add(new TaskRow { Id = id, State = (int)snapshot.State, Version = snapshot.Version });
        context.SaveChanges();
        return new(201, "created", new(id, snapshot));
    }
    public DemoTask? Get(Guid id)
    {
        using var context = new OpsPlatformDbContext(options);
        var row = context.Tasks.AsNoTracking().SingleOrDefault(candidate => candidate.Id == id);
        return row is null ? null : new(id, Snapshot(row));
    }
    public DemoTaskRead? Read(Guid id)
    {
        using var context = new OpsPlatformDbContext(options);
        var row = context.Tasks.AsNoTracking().SingleOrDefault(candidate => candidate.Id == id);
        if (row is null) return null;
        return new(new(id, Snapshot(row)), History(context, id));
    }
    public DemoTaskUpdate Apply(Guid id, TaskEvent action, int expectedVersion)
    {
        using var context = new OpsPlatformDbContext(options);
        var row = context.Tasks.AsNoTracking().SingleOrDefault(candidate => candidate.Id == id);
        if (row is null) return new(404, "task_not_found", null);
        var current = Snapshot(row);
        var result = TaskLifecycle.Apply(current, action, expectedVersion);
        if (!result.Accepted) return new(409, result.Code, new(id, current));
        using var transaction = context.Database.BeginTransaction();
        // Conditional update: another writer that advanced the version first makes this affect 0 rows.
        var updated = context.Tasks
            .Where(candidate => candidate.Id == id && candidate.Version == expectedVersion)
            .ExecuteUpdate(setters => setters
                .SetProperty(candidate => candidate.State, (int)result.Snapshot.State)
                .SetProperty(candidate => candidate.Version, result.Snapshot.Version));
        if (updated != 1)
        {
            transaction.Rollback();
            var latest = context.Tasks.AsNoTracking().SingleOrDefault(candidate => candidate.Id == id);
            return latest is null ? new(404, "task_not_found", null) : new(409, "version_conflict", new(id, Snapshot(latest)));
        }
        var nextSequence = context.TaskJournal.Select(entry => (long?)entry.Sequence).Max() ?? 0L;
        context.TaskJournal.Add(new TaskJournalRow
        {
            Sequence = nextSequence + 1, TaskId = id, Event = (int)action,
            FromState = (int)current.State, ToState = (int)result.Snapshot.State, Version = result.Snapshot.Version,
        });
        context.SaveChanges();
        transaction.Commit();
        return new(200, result.Code, new(id, result.Snapshot));
    }
    private static TaskSnapshot Snapshot(TaskRow row) => new((TaskState)row.State, row.Version);
    private static IReadOnlyList<DemoTaskJournal> History(OpsPlatformDbContext context, Guid id) =>
        context.TaskJournal.AsNoTracking().Where(entry => entry.TaskId == id).OrderBy(entry => entry.Sequence)
            .Select(entry => new DemoTaskJournal(entry.Sequence, entry.TaskId, (TaskEvent)entry.Event, (TaskState)entry.FromState, (TaskState)entry.ToState, entry.Version))
            .ToArray();
}
