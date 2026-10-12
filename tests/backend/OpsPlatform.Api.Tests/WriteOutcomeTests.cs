using OpsPlatform.Api.Persistence;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class WriteOutcomeTests
{
    [Fact] public void CommittedRequiresValueAndOperationId()
    {
        var id=Guid.NewGuid();var result=WriteOutcome<string>.Committed(id,"synthetic result");
        Assert.Equal(WriteDisposition.Committed,result.Disposition);Assert.Equal(id,result.OperationId);
        Assert.Equal("synthetic result",result.Value);Assert.False(result.RequiresReconciliation);Assert.False(result.AutomaticRetryAllowed);
        Assert.Throws<ArgumentNullException>(()=>WriteOutcome<string>.Committed(id,null!));
        Assert.Throws<ArgumentException>(()=>WriteOutcome<string>.Committed(Guid.Empty,"value"));
    }
    [Theory]
    [InlineData(WriteDisposition.Rejected)]
    [InlineData(WriteDisposition.NotFound)]
    [InlineData(WriteDisposition.CancelledBeforeCommit)]
    [InlineData(WriteDisposition.UnavailableBeforeCommit)]
    [InlineData(WriteDisposition.CommitUnknown)]
    public void NonCommittedNeverProvidesSuccessValueOrAutomaticRetry(WriteDisposition disposition)
    {
        var id=Guid.NewGuid();var result=WriteOutcome<string>.WithoutCommitConfirmation(id,disposition);
        Assert.Null(result.Value);Assert.Equal(id,result.OperationId);Assert.False(result.AutomaticRetryAllowed);
        Assert.Equal(disposition==WriteDisposition.CommitUnknown,result.RequiresReconciliation);
        Assert.Throws<ArgumentException>(()=>WriteOutcome<string>.WithoutCommitConfirmation(Guid.Empty,disposition));
    }
    [Theory]
    [InlineData(WriteDisposition.Committed)]
    [InlineData((WriteDisposition)999)]
    public void InvalidOrSuccessDispositionCannotBypassCommittedFactory(WriteDisposition disposition)
        =>Assert.Throws<ArgumentOutOfRangeException>(()=>WriteOutcome<string>.WithoutCommitConfirmation(Guid.NewGuid(),disposition));
}
