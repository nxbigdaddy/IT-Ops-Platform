using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Services;

namespace OpsPlatform.Api.Persistence.Relational;

// Relational implementations of the demo persistence ports. Each call opens a short-lived context so the
// database (not a process dictionary) owns uniqueness and durability. Development-only: no migrations,
// no retention policy, no multi-tenant scoping and no audit trail.
public sealed class RelationalFeedbackStore(DbContextOptions<OpsPlatformDbContext> options) : IDemoFeedbackStore
{
    public void Add(FeedbackDto item)
    {
        ArgumentNullException.ThrowIfNull(item);
        using var context = new OpsPlatformDbContext(options);
        context.Feedback.Add(new FeedbackRow
        {
            Id = item.Id, Category = item.Category, Message = item.Message, Page = item.Page, CreatedAtUnixMs = item.CreatedAt.ToUnixTimeMilliseconds(),
        });
        context.SaveChanges();
        // Capacity is enforced by deleting the oldest rows beyond the bound, inside one transaction.
        using var transaction = context.Database.BeginTransaction();
        var extra = context.Feedback.Count() - InMemoryDemoFeedbackStore.Capacity;
        if (extra > 0)
        {
            var oldest = context.Feedback.OrderBy(row => row.CreatedAtUnixMs).ThenBy(row => row.Id).Take(extra).Select(row => row.Id).ToArray();
            context.Feedback.Where(row => oldest.Contains(row.Id)).ExecuteDelete();
        }
        transaction.Commit();
    }
    public IReadOnlyList<FeedbackDto> List()
    {
        using var context = new OpsPlatformDbContext(options);
        return context.Feedback.AsNoTracking()
            .OrderByDescending(row => row.CreatedAtUnixMs).ThenByDescending(row => row.Id)
            .Take(InMemoryDemoFeedbackStore.Capacity)
            .Select(row => new FeedbackDto(row.Id, row.Category, row.Message, row.Page, DateTimeOffset.FromUnixTimeMilliseconds(row.CreatedAtUnixMs)))
            .ToArray();
    }
}
public sealed class RelationalOperationLedger(DbContextOptions<OpsPlatformDbContext> options) : IOperationLedger
{
    public int Count
    {
        get
        {
            using var context = new OpsPlatformDbContext(options);
            return context.Ledger.Count();
        }
    }
    public OperationClaim Claim(IdempotencyIdentity identity, Guid operationId)
    {
        ArgumentNullException.ThrowIfNull(identity);
        if (operationId == Guid.Empty) throw new ArgumentException("Operation identifier required.", nameof(operationId));
        using var context = new OpsPlatformDbContext(options);
        var existing = Find(context, identity);
        if (existing is not null) return Outcome(existing, identity);
        if (context.Ledger.Count() >= DemoOperationLedger.Capacity) return new(OperationOutcome.CapacityReached, null);
        context.Ledger.Add(new LedgerRow
        {
            Scope = identity.Scope, Operation = identity.Operation, Key = identity.Key, Digest = identity.Digest,
            OperationId = operationId, State = "pending", ResultVersion = 0,
        });
        try
        {
            context.SaveChanges();
        }
        catch (DbUpdateException)
        {
            // Another writer claimed the same key first: the unique index rejected this insert, so re-read it.
            context.ChangeTracker.Clear();
            var raced = Find(context, identity);
            if (raced is null) throw;
            return Outcome(raced, identity);
        }
        return new(OperationOutcome.Claimed, Record(context.Ledger.AsNoTracking().Single(row => row.OperationId == operationId)));
    }
    public bool Complete(IdempotencyIdentity identity, Guid operationId, int resultVersion) => Complete(identity, operationId, resultVersion, null);
    public bool Complete(IdempotencyIdentity identity, Guid operationId, int resultVersion, string? resultReference)
    {
        ArgumentNullException.ThrowIfNull(identity);
        if (resultVersion < 1) throw new ArgumentOutOfRangeException(nameof(resultVersion));
        if (resultReference is not null && (resultReference.Length is 0 or > 128 || resultReference.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or ':'))))
            throw new ArgumentException("Invalid result reference.", nameof(resultReference));
        using var context = new OpsPlatformDbContext(options);
        // The update is conditional on the row still being ours and unresolved; the database applies it atomically.
        var updated = context.Ledger
            .Where(row => row.Scope == identity.Scope && row.Operation == identity.Operation && row.Key == identity.Key
                && row.OperationId == operationId && row.State != "completed")
            .ExecuteUpdate(setters => setters
                .SetProperty(row => row.State, "completed")
                .SetProperty(row => row.ResultVersion, resultVersion)
                .SetProperty(row => row.ResultReference, resultReference));
        return updated == 1;
    }
    public bool MarkUnknown(IdempotencyIdentity identity, Guid operationId)
    {
        ArgumentNullException.ThrowIfNull(identity);
        using var context = new OpsPlatformDbContext(options);
        var updated = context.Ledger
            .Where(row => row.Scope == identity.Scope && row.Operation == identity.Operation && row.Key == identity.Key
                && row.OperationId == operationId && row.State != "completed")
            .ExecuteUpdate(setters => setters.SetProperty(row => row.State, "unknown"));
        return updated == 1;
    }
    public bool Release(IdempotencyIdentity identity, Guid operationId)
    {
        ArgumentNullException.ThrowIfNull(identity);
        using var context = new OpsPlatformDbContext(options);
        var deleted = context.Ledger
            .Where(row => row.Scope == identity.Scope && row.Operation == identity.Operation && row.Key == identity.Key
                && row.OperationId == operationId && row.State != "completed")
            .ExecuteDelete();
        return deleted == 1;
    }
    public DemoOperationSummary Summary()
    {
        using var context = new OpsPlatformDbContext(options);
        return new(DemoOperationLedger.Capacity, context.Ledger.Count(),
            context.Ledger.Count(row => row.State == "pending"),
            context.Ledger.Count(row => row.State == "completed"),
            context.Ledger.Count(row => row.State == "unknown"));
    }
    public OperationRecord? Find(Guid operationId)
    {
        if (operationId == Guid.Empty) throw new ArgumentException("Operation identifier required.", nameof(operationId));
        using var context = new OpsPlatformDbContext(options);
        var row = context.Ledger.AsNoTracking().SingleOrDefault(candidate => candidate.OperationId == operationId);
        return row is null ? null : Record(row);
    }
    public OperationRecord? Get(IdempotencyIdentity identity)
    {
        ArgumentNullException.ThrowIfNull(identity);
        using var context = new OpsPlatformDbContext(options);
        var row = Find(context, identity);
        return row is null ? null : Record(row);
    }
    private static LedgerRow? Find(OpsPlatformDbContext context, IdempotencyIdentity identity) =>
        context.Ledger.AsNoTracking().SingleOrDefault(row => row.Scope == identity.Scope && row.Operation == identity.Operation && row.Key == identity.Key);
    private static OperationClaim Outcome(LedgerRow row, IdempotencyIdentity identity)
    {
        var record = Record(row);
        if (row.Digest != identity.Digest) return new(OperationOutcome.PayloadConflict, record);
        return new(row.State == "completed" ? OperationOutcome.ReplayCompleted : row.State == "unknown" ? OperationOutcome.ReplayUnknown : OperationOutcome.PendingConflict, record);
    }
    private static OperationRecord Record(LedgerRow row) =>
        new(row.Scope, row.Operation, row.Key, row.Digest, row.OperationId, row.State, row.ResultVersion, row.ResultReference);
}
