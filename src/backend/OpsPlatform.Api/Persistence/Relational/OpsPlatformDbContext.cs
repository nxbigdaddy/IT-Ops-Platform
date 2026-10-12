using Microsoft.EntityFrameworkCore;
using OpsPlatform.Api.Contracts;

namespace OpsPlatform.Api.Persistence.Relational;

// Development-only relational model. It exists to prove that the persistence ports can be served by a real
// database (transactions, unique constraints) instead of process memory; it is NOT a production schema and has
// no migration history, retention policy, row-level security or audit trail.
public sealed record FeedbackRow
{
    public Guid Id { get; set; }
    public string Category { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? Page { get; set; }
    // SQLite cannot ORDER BY DateTimeOffset, so UTC epoch milliseconds are stored for ordering and the
    // original instant is reconstructed on read.
    public long CreatedAtUnixMs { get; set; }
}
public sealed record LedgerRow
{
    public int Id { get; set; }
    public string Scope { get; set; } = string.Empty;
    public string Operation { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public string Digest { get; set; } = string.Empty;
    public Guid OperationId { get; set; }
    public string State { get; set; } = "pending";
    public int ResultVersion { get; set; }
    public string? ResultReference { get; set; }
}
public sealed class TaskRow
{
    public Guid Id { get; set; }
    public int State { get; set; }
    public int Version { get; set; }
}
public sealed class TaskJournalRow
{
    public long Sequence { get; set; }
    public Guid TaskId { get; set; }
    public int Event { get; set; }
    public int FromState { get; set; }
    public int ToState { get; set; }
    public int Version { get; set; }
}
public sealed class OpsPlatformDbContext(DbContextOptions<OpsPlatformDbContext> options) : DbContext(options)
{
    public DbSet<FeedbackRow> Feedback => Set<FeedbackRow>();
    public DbSet<LedgerRow> Ledger => Set<LedgerRow>();
    public DbSet<TaskRow> Tasks => Set<TaskRow>();
    public DbSet<TaskJournalRow> TaskJournal => Set<TaskJournalRow>();
    public DbSet<PromptVersionRow> PromptVersions => Set<PromptVersionRow>();
    public DbSet<PromptPublishedRow> PromptPublished => Set<PromptPublishedRow>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<FeedbackRow>(entity =>
        {
            entity.ToTable("demo_feedback");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Category).HasMaxLength(32).IsRequired();
            entity.Property(row => row.Message).HasMaxLength(2000).IsRequired();
            entity.Property(row => row.Page).HasMaxLength(200);
            entity.HasIndex(row => row.CreatedAtUnixMs);
        });
        modelBuilder.Entity<LedgerRow>(entity =>
        {
            entity.ToTable("demo_operation_ledger");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.Scope).HasMaxLength(128).IsRequired();
            entity.Property(row => row.Operation).HasMaxLength(128).IsRequired();
            entity.Property(row => row.Key).HasMaxLength(128).IsRequired();
            entity.Property(row => row.Digest).HasMaxLength(64).IsRequired();
            entity.Property(row => row.State).HasMaxLength(16).IsRequired();
            entity.Property(row => row.ResultReference).HasMaxLength(128);
            // The database, not application code, is what makes a duplicate claim impossible.
            entity.HasIndex(row => new { row.Scope, row.Operation, row.Key }).IsUnique();
            entity.HasIndex(row => row.OperationId);
        });
        modelBuilder.Entity<TaskRow>(entity =>
        {
            entity.ToTable("demo_task");
            entity.HasKey(row => row.Id);
            // The version column is what makes compare-and-swap real: an update must match it.
            entity.Property(row => row.Version).IsConcurrencyToken();
        });
        modelBuilder.Entity<PromptVersionRow>(entity =>
        {
            entity.ToTable("demo_prompt_version");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.PromptId).HasMaxLength(64).IsRequired();
            entity.Property(row => row.Content).HasMaxLength(4000).IsRequired();
            // One row per prompt version: the database refuses a duplicate version rather than overwriting it.
            entity.HasIndex(row => new { row.PromptId, row.Version }).IsUnique();
        });
        modelBuilder.Entity<PromptPublishedRow>(entity =>
        {
            entity.ToTable("demo_prompt_published");
            entity.HasKey(row => row.Id);
            entity.Property(row => row.PromptId).HasMaxLength(64).IsRequired();
            entity.Property(row => row.Content).HasMaxLength(4000).IsRequired();
            entity.Property(row => row.ApprovalReference).HasMaxLength(160);
            entity.Property(row => row.ApprovedBy).HasMaxLength(64);
            entity.HasIndex(row => new { row.PromptId, row.Version }).IsUnique();
        });
        modelBuilder.Entity<TaskJournalRow>(entity =>
        {
            entity.ToTable("demo_task_journal");
            entity.HasKey(row => row.Sequence);
            entity.Property(row => row.Sequence).ValueGeneratedNever();
            entity.HasIndex(row => row.TaskId);
        });
    }
    public static DbContextOptions<OpsPlatformDbContext> OptionsFor(string databasePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);
        return new DbContextOptionsBuilder<OpsPlatformDbContext>()
            .UseSqlite($"Data Source={Path.GetFullPath(databasePath)}")
            .Options;
    }
}
