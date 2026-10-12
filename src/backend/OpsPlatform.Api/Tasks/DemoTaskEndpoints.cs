using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Persistence;
using OpsPlatform.Api.Security;
namespace OpsPlatform.Api.Tasks;

public sealed record DemoTransitionRequest(string? Event, int ExpectedVersion, string? IdempotencyKey = null);
public static class DemoTaskEndpoints
{
    // These endpoints simulate state changes only; Approve is NOT a real approval grant.
    public static void MapDemoTasks(this RouteGroupBuilder api)
    {
        api.MapPost("/demo-tasks", (IDemoTaskStore store) => Reply(store.Create()));
        api.MapGet("/demo-task-vocabulary", () => new DemoResponse<TaskVocabularyDescription>(TaskVocabulary.Describe()));
        api.MapGet("/demo-operations", (IOperationLedger ledger) =>
            new DemoResponse<DemoOperationSummary>(ledger.Summary()));
        api.MapGet("/demo-operations/{operationId:guid}", (Guid operationId, IOperationLedger ledger) =>
            ledger.Find(operationId) is { } record
                ? Results.Ok(new DemoResponse<OperationRecord>(record, Persistence: "memory"))
                : Results.Problem(statusCode: 404, title: "Demo operation not found",
                    extensions: new Dictionary<string, object?> { ["code"] = "operation_not_found", ["isDemo"] = true, ["persistence"] = "memory" }));
        api.MapGet("/demo-tasks/{id:guid}", (Guid id,IDemoTaskStore store) => store.Get(id) is {} task
            ? Results.Ok(new DemoResponse<DemoTask>(task,Persistence:"memory")) : Error(404,"task_not_found"));
        api.MapGet("/demo-tasks/{id:guid}/history", (Guid id,IDemoTaskStore store) => store.Read(id) is { } read
            ? Results.Ok(new DemoResponse<IReadOnlyList<DemoTaskJournal>>(read.History,Persistence:"memory")) : Error(404,"task_not_found"));
        api.MapGet("/demo-tasks/{id:guid}/snapshot", (Guid id,IDemoTaskStore store) => store.Read(id) is { } snapshot
            ? Results.Ok(new DemoResponse<DemoTaskRead>(snapshot,Persistence:"memory")) : Error(404,"task_not_found"));
        api.MapPost("/demo-tasks/{id:guid}/transitions", (Guid id,DemoTransitionRequest request,IDemoTaskStore store,IOperationLedger ledger) =>
        {
            if(request.ExpectedVersion<1 || request.Event is null || !Enum.GetNames<TaskEvent>().Contains(request.Event,StringComparer.Ordinal)) return Error(400,"invalid_transition_request");
            var action=Enum.Parse<TaskEvent>(request.Event);
            // Without an explicit key the legacy behaviour is unchanged: no ledger entry, no replay detection.
            if(request.IdempotencyKey is null) return Reply(store.Apply(id,action,request.ExpectedVersion));
            if(!Identity(request,id,out var identity)) return Error(400,"invalid_idempotency_key");
            var operationId=Guid.NewGuid();
            var claim=ledger.Claim(identity,operationId);
            switch(claim.Outcome)
            {
                case OperationOutcome.PayloadConflict: return Error(409,"idempotency_payload_conflict");
                case OperationOutcome.PendingConflict: return Error(409,"operation_in_progress");
                case OperationOutcome.CapacityReached: return Error(409,"operation_capacity_reached");
                case OperationOutcome.ReplayUnknown: return Error(409,"operation_outcome_unknown");
            }
            if(claim.Outcome==OperationOutcome.ReplayCompleted)
            {
                var recorded=claim.Record!;
                // Replay returns the recorded result version; it never applies the transition again.
                return store.Get(id) is { } current
                    ? Results.Json(new DemoResponse<DemoTaskUpdate>(new DemoTaskUpdate(200,"replayed",current,recorded.ResultVersion),Persistence:"memory"),statusCode:200)
                    : Error(404,"task_not_found");
            }
            var update=store.Apply(id,action,request.ExpectedVersion);
            if(update.Status<400&&update.Task is { } applied) ledger.Complete(identity,operationId,applied.Snapshot.Version);
            else ledger.Release(identity,operationId);
            return Reply(update);
        });
    }
    private static bool Identity(DemoTransitionRequest request,Guid id,out IdempotencyIdentity identity)
    {
        identity=null!;
        try
        {
            var digest=OperationDigest.Compute(new OperationDraft(id.ToString(),request.ExpectedVersion,request.Event!,new Dictionary<string,string>()));
            identity=new IdempotencyIdentity("demo:actor","task.transition",request.IdempotencyKey!,digest);
            return true;
        }
        catch(ArgumentException) { return false; }
    }
    private static IResult Reply(DemoTaskUpdate update) => update.Status < 400
        ? Results.Json(new DemoResponse<DemoTaskUpdate>(update,Persistence:"memory"),statusCode:update.Status)
        : Error(update.Status,update.Code);
    private static IResult Error(int status,string code) => Results.Problem(statusCode:status,title:"Demo task request rejected",
        extensions:new Dictionary<string,object?>{{"code",code},{"isDemo",true},{"persistence","memory"},{"executed",false}});
}
