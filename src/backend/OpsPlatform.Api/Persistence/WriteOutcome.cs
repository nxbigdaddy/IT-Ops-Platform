namespace OpsPlatform.Api.Persistence;

// Future durable adapters must establish these facts; HTTP status alone cannot do so.
public enum WriteDisposition { Committed, Rejected, NotFound, CancelledBeforeCommit, UnavailableBeforeCommit, CommitUnknown }
public sealed class WriteOutcome<T> where T : class
{
    public WriteDisposition Disposition { get; }
    public Guid OperationId { get; }
    public T? Value { get; }
    public bool RequiresReconciliation => Disposition == WriteDisposition.CommitUnknown;
    // No generic write outcome grants permission to replay a command.
    public bool AutomaticRetryAllowed => false;
    private WriteOutcome(WriteDisposition disposition, Guid operationId, T? value)
    {
        if(operationId == Guid.Empty) throw new ArgumentException("Operation identifier required.",nameof(operationId));
        Disposition=disposition;OperationId=operationId;Value=value;
    }
    public static WriteOutcome<T> Committed(Guid operationId,T value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return new(WriteDisposition.Committed,operationId,value);
    }
    public static WriteOutcome<T> WithoutCommitConfirmation(Guid operationId,WriteDisposition disposition)
    {
        if(!Enum.IsDefined(disposition)||disposition==WriteDisposition.Committed)
            throw new ArgumentOutOfRangeException(nameof(disposition));
        return new(disposition,operationId,null);
    }
}
