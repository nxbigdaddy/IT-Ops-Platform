using OpsPlatform.Api.Persistence;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class DemoOperationLedgerTests
{
    private static IdempotencyIdentity Identity(string key="key-1",char digest='a',string operation="task.approve",string scope="demo:actor")
        => new(scope,operation,key,new string(digest,64));
    [Fact] public void CompletedOperationReplaysWithoutPermissionToExecuteAgain()
    {
        var ledger=new DemoOperationLedger();var identity=Identity();var operationId=Guid.NewGuid();
        var claim=ledger.Claim(identity,operationId);
        Assert.Equal(OperationOutcome.Claimed,claim.Outcome);Assert.True(claim.MayExecute);Assert.False(claim.AutomaticRetryAllowed);
        Assert.True(ledger.Complete(identity,operationId,7));
        var replay=ledger.Claim(identity,Guid.NewGuid());
        Assert.Equal(OperationOutcome.ReplayCompleted,replay.Outcome);Assert.False(replay.MayExecute);Assert.False(replay.ReconciliationRequired);
        Assert.False(replay.AutomaticRetryAllowed);Assert.Equal(operationId,replay.Record!.OperationId);Assert.Equal(7,replay.Record.ResultVersion);
        Assert.Equal(1,ledger.Count);
    }
    [Fact] public void SameKeyWithDifferentPayloadConflicts()
    {
        var ledger=new DemoOperationLedger();var identity=Identity();
        Assert.Equal(OperationOutcome.Claimed,ledger.Claim(identity,Guid.NewGuid()).Outcome);
        var conflict=ledger.Claim(Identity(digest:'b'),Guid.NewGuid());
        Assert.Equal(OperationOutcome.PayloadConflict,conflict.Outcome);Assert.False(conflict.MayExecute);Assert.False(conflict.ReconciliationRequired);Assert.Equal(1,ledger.Count);
    }
    [Fact] public void SecondClaimWhilePendingDoesNotReplaceTheFirstOperation()
    {
        var ledger=new DemoOperationLedger();var identity=Identity();var first=Guid.NewGuid();
        ledger.Claim(identity,first);
        var second=ledger.Claim(identity,Guid.NewGuid());
        Assert.Equal(OperationOutcome.PendingConflict,second.Outcome);Assert.False(second.MayExecute);Assert.Equal(first,second.Record!.OperationId);
        Assert.True(ledger.Complete(identity,first,3));Assert.False(ledger.Complete(identity,second.Record.OperationId==first?Guid.NewGuid():Guid.NewGuid(),4));
        Assert.Equal(3,ledger.Get(identity)!.ResultVersion);
    }
    [Fact] public void UnknownOutcomeRequiresReconciliationAndBlocksRewriting()
    {
        var ledger=new DemoOperationLedger();var identity=Identity();var operationId=Guid.NewGuid();
        ledger.Claim(identity,operationId);Assert.True(ledger.MarkUnknown(identity,operationId));
        var replay=ledger.Claim(identity,Guid.NewGuid());
        Assert.Equal(OperationOutcome.ReplayUnknown,replay.Outcome);Assert.True(replay.ReconciliationRequired);Assert.False(replay.MayExecute);Assert.False(replay.AutomaticRetryAllowed);
        Assert.False(ledger.Complete(identity,Guid.NewGuid(),5));
        Assert.Equal(OperationOutcome.ReplayUnknown,ledger.Claim(identity,Guid.NewGuid()).Outcome);
        Assert.True(ledger.Complete(identity,operationId,5));Assert.Equal(OperationOutcome.ReplayCompleted,ledger.Claim(identity,Guid.NewGuid()).Outcome);
    }
    [Fact] public void ScopeOperationAndKeyAreIndependentLedgerEntries()
    {
        var ledger=new DemoOperationLedger();
        Assert.Equal(OperationOutcome.Claimed,ledger.Claim(Identity(),Guid.NewGuid()).Outcome);
        Assert.Equal(OperationOutcome.Claimed,ledger.Claim(Identity(key:"key-2"),Guid.NewGuid()).Outcome);
        Assert.Equal(OperationOutcome.Claimed,ledger.Claim(Identity(operation:"feedback.add"),Guid.NewGuid()).Outcome);
        Assert.Equal(OperationOutcome.Claimed,ledger.Claim(Identity(scope:"demo:other"),Guid.NewGuid()).Outcome);
        Assert.Equal(4,ledger.Count);
    }
    [Fact] public void CapacityIsBoundedWithoutEvictingExistingRecords()
    {
        var ledger=new DemoOperationLedger();
        for(var index=0;index<DemoOperationLedger.Capacity;index++)Assert.Equal(OperationOutcome.Claimed,ledger.Claim(Identity(key:$"key-{index}"),Guid.NewGuid()).Outcome);
        var overflow=ledger.Claim(Identity(key:"overflow"),Guid.NewGuid());
        Assert.Equal(OperationOutcome.CapacityReached,overflow.Outcome);Assert.Null(overflow.Record);Assert.False(overflow.MayExecute);
        Assert.Equal(DemoOperationLedger.Capacity,ledger.Count);Assert.NotNull(ledger.Get(Identity(key:"key-0")));Assert.Null(ledger.Get(Identity(key:"overflow")));
    }
    [Fact] public void ReleaseOnlyClearsUncommittedClaimsWithTheMatchingOperation()
    {
        var ledger=new DemoOperationLedger();var identity=Identity();var operationId=Guid.NewGuid();
        ledger.Claim(identity,operationId);
        Assert.False(ledger.Release(identity,Guid.NewGuid()));Assert.NotNull(ledger.Get(identity));
        Assert.True(ledger.Release(identity,operationId));Assert.Null(ledger.Get(identity));Assert.Equal(0,ledger.Count);
        Assert.Equal(OperationOutcome.Claimed,ledger.Claim(identity,Guid.NewGuid()).Outcome);
        Assert.True(ledger.Complete(identity,ledger.Get(identity)!.OperationId,4));
        Assert.False(ledger.Release(identity,ledger.Get(identity)!.OperationId));
        Assert.Equal(OperationOutcome.ReplayCompleted,ledger.Claim(identity,Guid.NewGuid()).Outcome);
    }
    [Fact] public void SummaryAndLookupDescribeTheCurrentProcessOnly()
    {
        var ledger=new DemoOperationLedger();
        Assert.Equal(new DemoOperationSummary(500,0,0,0,0),ledger.Summary());
        var completed=Identity(key:"completed");var completedId=Guid.NewGuid();
        ledger.Claim(completed,completedId);ledger.Complete(completed,completedId,3);
        var pending=Identity(key:"pending");var pendingId=Guid.NewGuid();ledger.Claim(pending,pendingId);
        var unknown=Identity(key:"unknown");var unknownId=Guid.NewGuid();ledger.Claim(unknown,unknownId);ledger.MarkUnknown(unknown,unknownId);
        var summary=ledger.Summary();
        Assert.Equal(3,summary.Count);Assert.Equal(1,summary.Pending);Assert.Equal(1,summary.Completed);Assert.Equal(1,summary.Unknown);
        Assert.Equal(497,summary.Remaining);Assert.False(summary.Persistent);
        Assert.Equal("completed",ledger.Find(completedId)!.State);Assert.Equal(3,ledger.Find(completedId)!.ResultVersion);
        Assert.Equal(pendingId,ledger.Find(pendingId)!.OperationId);Assert.Equal(unknownId,ledger.Find(unknownId)!.OperationId);
        Assert.Null(ledger.Find(Guid.NewGuid()));
        Assert.Throws<ArgumentException>(()=>ledger.Find(Guid.Empty));
    }
    [Fact] public void InvalidInputsAreRejected()
    {
        var ledger=new DemoOperationLedger();
        Assert.Throws<ArgumentNullException>(()=>ledger.Claim(null!,Guid.NewGuid()));
        Assert.Throws<ArgumentException>(()=>ledger.Claim(Identity(),Guid.Empty));
        Assert.Throws<ArgumentOutOfRangeException>(()=>ledger.Complete(Identity(),Guid.NewGuid(),0));
        Assert.False(ledger.Complete(Identity(),Guid.NewGuid(),1));Assert.False(ledger.MarkUnknown(Identity(),Guid.NewGuid()));Assert.Null(ledger.Get(Identity()));
    }
}
