using System.Net;
using Microsoft.AspNetCore.Diagnostics;
using OpsPlatform.Api.Configuration;
using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Security;
using OpsPlatform.Api.Services;
using OpsPlatform.Api.Tasks;

var app = AppBootstrap.Build(args);
app.Run();

public static class AppBootstrap
{
    public static WebApplication Build(string[] args, Action<WebApplicationBuilder>? configure = null)
    {
        // Explicit sources intentionally exclude User Secrets and credential stores.
        var builder = WebApplication.CreateEmptyBuilder(new WebApplicationOptions
        {
            Args = args,
            EnvironmentName = Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT")
                ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production"
        });
        builder.Configuration
            .AddJsonFile("appsettings.json", optional: true)
            .AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.json", optional: true)
            .AddEnvironmentVariables()
            .AddCommandLine(args);
        builder.WebHost.UseKestrel(options => options.Limits.MaxRequestBodySize = 16 * 1024);
        builder.WebHost.UseUrls("http://localhost:5094");
        builder.Services.AddRouting();
        builder.Services.ConfigureHttpJsonOptions(_ => { });
        builder.Logging.AddConsole();
        configure?.Invoke(builder);
        var options = PlatformOptions.Read(builder.Configuration, builder.Environment.EnvironmentName);
        var isDemo = options.IsDemo(builder.Environment.EnvironmentName);
        builder.Services.AddSingleton(options);
        builder.Services.AddSingleton<DemoCatalogService>();
        // Optional development-only file persistence for feedback; empty means the in-memory store. It is NOT
        // production persistence: no transactions, no concurrent writers, no migration, readiness stays unconfigured.
        // Optional development-only relational persistence (SQLite file). When set it replaces BOTH the feedback
        // store and the ledger with database-backed implementations; everything else keeps its own configuration.
        var databasePath = builder.Configuration["Demo:SqlitePath"]?.Trim();
        // A provider can be selected explicitly; the connection target is restricted to loopback or
        // documentation addresses so the demo can never be pointed at a real database.
        var relationalMode = OpsPlatform.Api.Persistence.Relational.RelationalModeSelector.Select(databasePath, builder.Configuration["Demo:PostgresConnection"]);
        if (relationalMode is not null)
        {
            var relationalOptions = OpsPlatform.Api.Persistence.Relational.RelationalModeSelector.OptionsFor(relationalMode);
            if (!relationalMode.IsPostgres)
            {
                using var context = new OpsPlatform.Api.Persistence.Relational.OpsPlatformDbContext(relationalOptions);
                context.Database.EnsureCreated();
            }
            Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton<OpsPlatform.Api.Services.IDemoFeedbackStore>(builder.Services, _ => new OpsPlatform.Api.Persistence.Relational.RelationalFeedbackStore(relationalOptions));
            Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton<OpsPlatform.Api.Persistence.IOperationLedger>(builder.Services, _ => new OpsPlatform.Api.Persistence.Relational.RelationalOperationLedger(relationalOptions));
            Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton<OpsPlatform.Api.Tasks.IDemoTaskStore>(builder.Services, _ => new OpsPlatform.Api.Persistence.Relational.RelationalTaskStore(relationalOptions));
        }
        var feedbackFile = builder.Configuration["Demo:FeedbackFile"]?.Trim();
        if (!string.IsNullOrEmpty(feedbackFile))
            Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton<IDemoFeedbackStore>(builder.Services, _ => new JsonFileFeedbackStore(feedbackFile));
        else
            Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton<IDemoFeedbackStore, InMemoryDemoFeedbackStore>(builder.Services);
        Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton<TimeProvider>(builder.Services, TimeProvider.System);
        Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton<FeedbackService>(builder.Services);
        var promptStateFile = builder.Configuration["Demo:PromptStateFile"]?.Trim();
        if (!string.IsNullOrEmpty(databasePath))
            builder.Services.AddSingleton(new PromptService(new OpsPlatform.Api.Persistence.Relational.RelationalPromptStateStore(OpsPlatform.Api.Persistence.Relational.OpsPlatformDbContext.OptionsFor(databasePath))));
        else if (!string.IsNullOrEmpty(promptStateFile))
            builder.Services.AddSingleton(new PromptService(new OpsPlatform.Api.Persistence.JsonFilePromptStateStore(promptStateFile)));
        else
            builder.Services.AddSingleton(new PromptService());
        builder.Services.AddSingleton<OpsPlatform.Api.Ai.LoopbackModelTransport>();
        // The read port resolves to the same instance; a durable catalog may register itself first.
        Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton<IPromptCatalog>(builder.Services, provider => provider.GetRequiredService<PromptService>());
        // The relational mode owns the task store too; registering the in-memory one after it would win.
        var taskFile = builder.Configuration["Demo:TaskFile"]?.Trim();
        if (string.IsNullOrEmpty(databasePath) && !string.IsNullOrEmpty(taskFile))
            builder.Services.AddSingleton<IDemoTaskStore>(_ => new JsonFileTaskStore(taskFile));
        else if (string.IsNullOrEmpty(databasePath))
            builder.Services.AddSingleton<IDemoTaskStore, DemoTaskStore>();
        // TryAdd keeps the port substitutable (tests and a future durable store may register their own).
        var ledgerFile = builder.Configuration["Demo:OperationLedgerFile"]?.Trim();
        if (!string.IsNullOrEmpty(ledgerFile))
            Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton<OpsPlatform.Api.Persistence.IOperationLedger>(builder.Services, _ => new OpsPlatform.Api.Persistence.JsonFileOperationLedger(ledgerFile));
        else
            Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton<OpsPlatform.Api.Persistence.IOperationLedger, OpsPlatform.Api.Persistence.DemoOperationLedger>(builder.Services);
        builder.Services.AddProblemDetails(problem => problem.CustomizeProblemDetails = context =>
        {
            context.ProblemDetails.Extensions["isDemo"] = isDemo;
            context.ProblemDetails.Extensions["traceId"] = context.HttpContext.TraceIdentifier;
        });
        var app = builder.Build();
        // Never use DeveloperExceptionPage: request/exception details may contain submitted data.
        app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
        {
            var exception = context.Features.Get<IExceptionHandlerFeature>()?.Error;
            var status = exception is BadHttpRequestException bad ? bad.StatusCode : 500;
            await Results.Problem(statusCode: status,
                title: status < 500 ? "Invalid request" : "An unexpected error occurred",
                extensions: new Dictionary<string, object?> { ["isDemo"] = isDemo, ["traceId"] = context.TraceIdentifier })
                .ExecuteAsync(context);
        }));
        app.UseStatusCodePages(async statusContext =>
        {
            var context = statusContext.HttpContext;
            await Results.Problem(statusCode: context.Response.StatusCode, title: "Request could not be completed",
                extensions: new Dictionary<string, object?> { ["isDemo"] = isDemo, ["traceId"] = context.TraceIdentifier }).ExecuteAsync(context);
        });
        app.Use(async (context, next) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            if (context.Request.Path.StartsWithSegments("/api"))
            {
                if (!isDemo)
                {
                    await Results.Problem(statusCode: 503, title: "Business API disabled",
                        detail: "Authentication, authorization and production persistence are not implemented. Only Development Demo mode exposes sample data.",
                        extensions: new Dictionary<string, object?> { ["isDemo"] = false }).ExecuteAsync(context);
                    return;
                }
                // Defense in depth: a port override or reverse proxy must not expose the demo remotely.
                var remote = context.Connection.RemoteIpAddress;
                if ((remote is not null && !IPAddress.IsLoopback(remote)) || !IsLoopbackHost(context.Request.Host.Host))
                {
                    await Results.Problem(statusCode: 403, title: "Demo requires localhost",
                        extensions: new Dictionary<string, object?> { ["isDemo"] = true }).ExecuteAsync(context);
                    return;
                }
                // Same-origin only. This also rejects browser cross-origin feedback submission.
                if (context.Request.Headers.TryGetValue("Origin", out var origin)
                    && !string.Equals(origin.ToString(), $"{context.Request.Scheme}://{context.Request.Host}", StringComparison.OrdinalIgnoreCase))
                {
                    await Results.Problem(statusCode: 403, title: "Cross-origin demo requests are disabled",
                        extensions: new Dictionary<string, object?> { ["isDemo"] = true }).ExecuteAsync(context);
                    return;
                }
            }
            await next(context);
        });
        app.MapGet("/health/live", () => Results.Ok(new { status = "alive", isDemo }));
        // Component-level readiness. It always answers 503: the blockers list is the honest answer, and the
        // report never includes the configured database path.
        app.MapGet("/health/ready", (IConfiguration configuration) =>
        {
            var report = OpsPlatform.Api.Persistence.ReadinessProbe.Evaluate(configuration["Demo:SqlitePath"], configuration["Demo:PostgresConnection"], isDemo);
            var persistence = report.Checks.Single(check => check.Name == "persistence");
            // `database` is kept for continuity with earlier builds; `checks` carries the full picture.
            return Results.Json(new { status = report.Status, isDemo, ready = report.Ready,
                database = new { status = persistence.Status, verified = persistence.Verified, detail = persistence.Detail },
                // Kept for older callers: the prototype still has no authentication, and demo availability is not readiness.
                authentication = "notImplemented",
                demoApiAvailable = isDemo,
                checks = report.Checks, blockers = report.Blockers, note = report.Note }, statusCode: 503);
        });
        var api = app.MapGroup("/api/v1");
        api.MapDemoTasks();
        api.MapGet("/dashboard", (DemoCatalogService service) => new DemoResponse<DashboardDto>(service.Dashboard));
        api.MapGet("/assets", (DemoCatalogService service) => new DemoResponse<IReadOnlyList<AssetDto>>(service.Assets));
        api.MapGet("/alerts", (DemoCatalogService service) => new DemoResponse<IReadOnlyList<AlertDto>>(service.Alerts));
        api.MapGet("/tickets", (DemoCatalogService service) => new DemoResponse<IReadOnlyList<TicketDto>>(service.Tickets));
        api.MapGet("/connectors", (DemoCatalogService service) => new DemoResponse<IReadOnlyList<ConnectorDto>>(service.Connectors));
        api.MapGet("/connector-capabilities", () => new DemoResponse<IReadOnlyList<ConnectorCandidate>>(ConnectorRegistry.List()));
        api.MapGet("/connector-capabilities/{id}", (string id) => ConnectorRegistry.Find(id) is { } candidate
            ? Results.Ok(new DemoResponse<ConnectorCandidate>(candidate))
            : Results.Problem(statusCode: 404, title: "Connector candidate not found", extensions: new Dictionary<string, object?> { ["isDemo"] = true }));
        api.MapPost("/connector-preflight", (ConnectorReadDraft draft) =>
        {
            var result=ConnectorReadIntent.Check(draft);
            return Results.Json(new DemoResponse<ConnectorIntentCheck>(result),statusCode:result.ConfigurationValid?200:400);
        });
        api.MapPost("/connector-plan-preflight", (ConnectorPlanDraft draft) =>
        {
            var result=ConnectorPlan.Check(draft);
            return Results.Json(new DemoResponse<ConnectorPlanCheck>(result),statusCode:result.ConfigurationValid?200:400);
        });
        api.MapGet("/approval-scenarios", () => new DemoResponse<IReadOnlyList<ApprovalScenario>>(ApprovalScenarios.List(), Persistence: "none"));
        api.MapPost("/approval-preflight", (ApprovalDraft draft) =>
        {
            var scenario = ApprovalScenarios.Find(draft?.Scenario);
            if (scenario is null)
                return Results.Json(new DemoResponse<ApprovalScenario?>(null, Persistence: "none"), statusCode: 400);
            return Results.Ok(new DemoResponse<ApprovalScenario>(scenario, Persistence: "none"));
        });
        api.MapGet("/authorization-scenarios", () => new DemoResponse<IReadOnlyList<AuthorizationScenario>>(AuthorizationScenarios.List(), Persistence: "none"));
        api.MapPost("/authorization-preflight", (AuthorizationDraft draft) =>
        {
            var scenario = AuthorizationScenarios.Find(draft?.Scenario);
            if (scenario is null)
                return Results.Json(new DemoResponse<AuthorizationScenario?>(null, Persistence: "none"), statusCode: 400);
            return Results.Ok(new DemoResponse<AuthorizationScenario>(scenario, Persistence: "none"));
        });
        api.MapGet("/execution-scenarios", () => new DemoResponse<IReadOnlyList<ExecutionScenario>>(ExecutionScenarios.List(), Persistence: "none"));
        api.MapPost("/execution-preflight", (ExecutionDraft draft) =>
        {
            var scenario = ExecutionScenarios.Find(draft?.Scenario);
            if (scenario is null)
                return Results.Json(new DemoResponse<ExecutionScenario?>(null, Persistence: "none"), statusCode: 400);
            return Results.Ok(new DemoResponse<ExecutionScenario>(scenario, Persistence: "none"));
        });
        api.MapPost("/connector-target-scope", (ConnectorTargetScopeDraft draft) =>
        {
            var result=ConnectorTargetScope.Check(draft);
            return Results.Json(new DemoResponse<ConnectorTargetScopeCheck>(result),statusCode:result.ConfigurationValid?200:400);
        });
        api.MapPost("/monitored-query-preflight", (MonitoredQueryDraft draft) =>
        {
            var result = MonitoredQueryPolicy.Check(draft);
            return Results.Json(new DemoResponse<MonitoredQueryCheck>(result), statusCode: result.ConfigurationValid ? 200 : 400);
        });
        // Synthetic provider stub. Only the loopback transport (or a local test) ever calls it, and it refuses
        // any model id that is not a reserved demo id.
        api.MapGet("/ai-loopback-stub-scenarios", () => Results.Json(new DemoResponse<IReadOnlyList<OpsPlatform.Api.Ai.AiStubScenario>>(OpsPlatform.Api.Ai.AiLoopbackStub.Scenarios(), Persistence: "none")));
        api.MapPost("/ai-loopback-stub", (OpsPlatform.Api.Ai.AiStubRequest request) => StubReply(request, OpsPlatform.Api.Ai.AiLoopbackStub.DefaultBehaviour));
        api.MapPost("/ai-loopback-stub/{behaviour}", async (string behaviour, OpsPlatform.Api.Ai.AiStubRequest request) =>
        {
            if (!OpsPlatform.Api.Ai.AiLoopbackStub.IsBehaviour(behaviour)) return Results.Problem(statusCode: 400, title: "Demo loopback stub rejected", extensions: new Dictionary<string, object?> { ["isDemo"] = true, ["code"] = "stub_unknown_behaviour" });
            // A deliberate delay so the transport timeout path can be exercised over a real socket.
            if (OpsPlatform.Api.Ai.AiStubBehaviour.IsSlow(behaviour)) await Task.Delay(TimeSpan.FromSeconds(6));
            return StubReply(request, behaviour);
        });
        // Real HTTP round-trip through the loopback transport; the target is always this machine.
        api.MapPost("/ai-loopback-exchange", async Task<IResult> (OpsPlatform.Api.Ai.AiLoopbackExchangeDraft draft, HttpContext context, OpsPlatform.Api.Ai.LoopbackModelTransport transport, CancellationToken cancellationToken) =>
        {
            var request = OpsPlatform.Api.Ai.AiLoopbackExchange.ToDraft(draft, out var code);
            if (request is null) return Results.Problem(statusCode: 400, title: "Demo loopback exchange rejected", extensions: new Dictionary<string, object?> { ["isDemo"] = true, ["code"] = code });
            var behaviour = string.IsNullOrWhiteSpace(draft.StubBehaviour) ? OpsPlatform.Api.Ai.AiLoopbackStub.DefaultBehaviour : draft.StubBehaviour!;
            var endpoint = draft.Endpoint ?? OpsPlatform.Api.Ai.AiLoopbackExchange.DefaultStubEndpoint(context.Connection.LocalPort, behaviour);
            var outcome = await transport.SendAsync(draft.Protocol!, endpoint, request, cancellationToken);
            var result = new OpsPlatform.Api.Ai.AiLoopbackExchangeResult(outcome.Status, outcome.Code, outcome.HttpStatus, outcome.ResponseBytes,
                outcome.ElapsedMilliseconds, outcome.Result?.Text, outcome.Result?.Usage, outcome.Result?.StopReason, outcome.SentRequestJson);
            return Results.Json(new DemoResponse<OpsPlatform.Api.Ai.AiLoopbackExchangeResult>(result, Persistence: "none"),
                statusCode: outcome.Status == "parsed" ? 200 : 502);
        });
        api.MapGet("/connector-collection-channels", () => Results.Json(new DemoResponse<OpsPlatform.Api.Configuration.ConnectorChannelCatalog>(OpsPlatform.Api.Configuration.ConnectorCollectionChannels.List(), Persistence: "none")));
        api.MapGet("/storage-modes", (IConfiguration configuration) =>
        {
            var postgresConnection = configuration["Demo:PostgresConnection"];
            var report = OpsPlatform.Api.Persistence.StorageModeCatalog.Report(
                !string.IsNullOrWhiteSpace(configuration["Demo:FeedbackFile"]),
                !string.IsNullOrWhiteSpace(configuration["Demo:OperationLedgerFile"]),
                !string.IsNullOrWhiteSpace(configuration["Demo:TaskFile"]),
                !string.IsNullOrWhiteSpace(configuration["Demo:PromptStateFile"]),
                OpsPlatform.Api.Persistence.Relational.RelationalModeSelector.Select(configuration["Demo:SqlitePath"], postgresConnection) is not null,
                OpsPlatform.Api.Persistence.Relational.RelationalModeSelector.Select(configuration["Demo:SqlitePath"], postgresConnection)?.Provider ?? "sqlite",
                !string.IsNullOrWhiteSpace(postgresConnection));
            return Results.Json(new DemoResponse<OpsPlatform.Api.Persistence.StorageModeReport>(report, Persistence: "none"));
        });
        api.MapGet("/database-providers", (DemoCatalogService service) => new DemoResponse<IReadOnlyList<ProviderDto>>(service.DatabaseProviders));
        api.MapGet("/database-provider-values", () => new DemoResponse<IReadOnlyList<DatabaseProviderValue>>(DatabaseCapabilities.ProviderValues()));
        api.MapPost("/database-preflight", (DatabaseDeploymentDraft draft) =>
        {
            var result = DatabaseCapabilities.ValidateDraft(draft);
            return Results.Json(new DemoResponse<DatabasePreflight>(result), statusCode: result.ConfigurationValid ? 200 : 400);
        });
        api.MapPost("/ai-preflight", (OpsPlatform.Api.Ai.AiConnectionDraft draft) =>
        {
            // Fixed reserved demo host; clients cannot approve their own endpoints.
            var result = OpsPlatform.Api.Ai.AiConnectionPolicy.Check(draft, ["ai.example.invalid"]);
            return Results.Json(new DemoResponse<OpsPlatform.Api.Ai.AiConfigurationCheck>(result), statusCode: result.ConfigurationValid ? 200 : 400);
        });
        api.MapGet("/ai-providers", (DemoCatalogService service) => new DemoResponse<IReadOnlyList<ProviderDto>>(service.AiProviders));
        api.MapGet("/ai-protocols", () => new DemoResponse<IReadOnlyList<OpsPlatform.Api.Ai.AiProtocolDescription>>(OpsPlatform.Api.Ai.AiProtocols.List()));
        api.MapPost("/ai-contract-preflight", (OpsPlatform.Api.Ai.AiContractDraft draft) =>
        {
            var result=OpsPlatform.Api.Ai.AiContractPreflight.Build(draft);
            return Results.Json(new DemoResponse<OpsPlatform.Api.Ai.AiContractCheck>(result),statusCode:result.ConfigurationValid?200:400);
        });
        api.MapGet("/prompt-templates", (DemoCatalogService service) => new DemoResponse<IReadOnlyList<PromptTemplateDto>>(service.PromptTemplates));
        api.MapGet("/prompts", (IPromptCatalog service) => new DemoResponse<IReadOnlyList<PromptDto>>(service.List(), Persistence: "memory"));
        api.MapGet("/prompt-bindings", (IPromptCatalog service) => new DemoResponse<IReadOnlyList<PromptBindingDto>>(service.Bindings(), Persistence: "memory"));
        api.MapGet("/prompt-feature-coverage", (IPromptCatalog service) => new DemoResponse<PromptFeatureCoverage>(service.FeatureCoverage(), Persistence: "memory"));
        api.MapGet("/ai-response-scenarios", () => new DemoResponse<IReadOnlyList<OpsPlatform.Api.Ai.AiResponseScenario>>(OpsPlatform.Api.Ai.AiResponseScenarios.List(), Persistence: "none"));
        api.MapPost("/ai-response-preflight", (OpsPlatform.Api.Ai.AiResponseDraft draft) =>
        {
            var scenario = OpsPlatform.Api.Ai.AiResponseScenarios.Find(draft?.Scenario);
            if (scenario is null)
                return Results.Json(new DemoResponse<OpsPlatform.Api.Ai.AiResponseScenario?>(null, Persistence: "none"), statusCode: 400);
            return Results.Ok(new DemoResponse<OpsPlatform.Api.Ai.AiResponseScenario>(scenario, Persistence: "none"));
        });
        api.MapGet("/migration-plan", () => new DemoResponse<IReadOnlyList<OpsPlatform.Api.Persistence.MigrationStep>>(OpsPlatform.Api.Persistence.MigrationPlan.List(), Persistence: "none"));
        api.MapGet("/prompts/{id}", (string id, IPromptCatalog service) => service.Get(id) is { } prompt
            ? Results.Ok(new DemoResponse<PromptDto>(prompt, Persistence: "memory"))
            : PromptResult(new(null, 404, "prompt_not_found")));
        api.MapPost("/prompts/{id}/versions", (string id, PromptVersionRequest request, PromptService service)
            => PromptResult(service.AddVersion(id, request)));
        api.MapPost("/prompts/{id}/restore", (string id, PromptRestoreRequest request, PromptService service)
            => PromptResult(service.Restore(id, request)));
        api.MapPost("/prompts/{id}/publish", (string id, PromptPublishRequest request, PromptService service)
            => PromptResult(service.Publish(id, request)));
        api.MapGet("/feedback", (OpsPlatform.Api.Services.IDemoFeedbackStore store) => new DemoResponse<IReadOnlyList<FeedbackDto>>(store.List(), Persistence: "memory"));
        api.MapGet("/feedback/{id:guid}", (Guid id, OpsPlatform.Api.Services.IDemoFeedbackStore store) =>
            store.List().FirstOrDefault(item=>item.Id==id) is { } item
                ? Results.Ok(new DemoResponse<FeedbackDto>(item, Persistence: "memory"))
                : Results.Problem(statusCode:404,title:"Demo feedback not found",extensions:new Dictionary<string,object?>{{"isDemo",true},{"persistence","memory"},{"code","feedback_not_found"}}));
        api.MapPost("/feedback", (FeedbackRequest request, FeedbackService service, OpsPlatform.Api.Persistence.IOperationLedger ledger) =>
        {
            var errors = FeedbackService.Validate(request);
            if (errors.Count != 0)
                return Results.ValidationProblem(errors, extensions: new Dictionary<string, object?> { ["isDemo"] = true });
            if (request.IdempotencyKey is null)
                return Results.Json(new DemoResponse<FeedbackDto>(service.Add(request), Persistence: "memory"), statusCode: 201);
            OpsPlatform.Api.Persistence.IdempotencyIdentity identity;
            try
            {
                identity = new("demo:actor", "feedback.add", request.IdempotencyKey,
                    OpsPlatform.Api.Persistence.FeedbackIntentDigest.Compute(request));
            }
            catch (ArgumentException) { return FeedbackError(400, "invalid_idempotency_key"); }
            var operationId = Guid.NewGuid();
            var claim = ledger.Claim(identity, operationId);
            switch (claim.Outcome)
            {
                case OpsPlatform.Api.Persistence.OperationOutcome.PayloadConflict: return FeedbackError(409, "idempotency_payload_conflict");
                case OpsPlatform.Api.Persistence.OperationOutcome.PendingConflict: return FeedbackError(409, "operation_in_progress");
                case OpsPlatform.Api.Persistence.OperationOutcome.CapacityReached: return FeedbackError(409, "operation_capacity_reached");
                case OpsPlatform.Api.Persistence.OperationOutcome.ReplayUnknown: return FeedbackError(409, "operation_outcome_unknown");
            }
            if (claim.Outcome == OpsPlatform.Api.Persistence.OperationOutcome.ReplayCompleted)
            {
                var recorded = claim.Record!;
                // The recorded record may already have been evicted from the bounded demo store.
                var existing = Guid.TryParse(recorded.ResultReference, out var recordedId)
                    ? service.List().FirstOrDefault(item => item.Id == recordedId) : null;
                return existing is null
                    ? FeedbackError(409, "idempotent_result_unavailable")
                    : Results.Json(new DemoResponse<FeedbackDto>(existing, Persistence: "memory"), statusCode: 200);
            }
            var created = service.Add(request);
            ledger.Complete(identity, operationId, 1, created.Id.ToString());
            return Results.Json(new DemoResponse<FeedbackDto>(created, Persistence: "memory"), statusCode: 201);
        });
        return app;
    }

    private static IResult FeedbackError(int status, string code) => Results.Problem(statusCode: status, title: "Demo feedback request rejected",
        extensions: new Dictionary<string, object?> { ["code"] = code, ["isDemo"] = true, ["persistence"] = "memory" });

    private static IResult PromptResult(PromptMutationResult result)
    {
        var extensions = new Dictionary<string, object?>
        {
            ["isDemo"] = true, ["persistence"] = "memory", ["code"] = result.Code
        };
        if (result.Errors is { } errors)
            return Results.ValidationProblem(errors, extensions: extensions);
        if (result.Data is { } data)
            return Results.Json(new DemoResponse<PromptDto>(data, Persistence: "memory"), statusCode: result.StatusCode);
        return Results.Problem(statusCode: result.StatusCode, title: result.Code, extensions: extensions);
    }

    private static IResult StubReply(OpsPlatform.Api.Ai.AiStubRequest request, string behaviour)
    {
        var (status, code, json) = OpsPlatform.Api.Ai.AiLoopbackStub.Build(request);
        if (json is null) return Results.Problem(statusCode: status, title: "Demo loopback stub rejected", extensions: new Dictionary<string, object?> { ["isDemo"] = true, ["code"] = code });
        var transformed = OpsPlatform.Api.Ai.AiStubBehaviour.Transform(behaviour, json);
        return transformed is null
            ? Results.Problem(statusCode: 400, title: "Demo loopback stub rejected", extensions: new Dictionary<string, object?> { ["isDemo"] = true, ["code"] = "stub_unknown_behaviour" })
            : Results.Content(transformed, "application/json", statusCode: OpsPlatform.Api.Ai.AiStubBehaviour.HttpStatus(behaviour));
    }
    private static bool IsLoopbackHost(string host) => host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
        || (IPAddress.TryParse(host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address));
}

public partial class Program { }
