namespace OpsPlatform.Api.Contracts;

public sealed record DemoResponse<T>(T Data, bool IsDemo = true, string Persistence = "none");
public sealed record AssetDto(string Id, string Name, string Kind, string OperatingSystem, string Status, string Site, string Source, DateTimeOffset ObservedAt);
public sealed record AlertDto(string Id, string AssetId, string Severity, string Title, string State);
public sealed record TicketDto(string Id, string Title, string Priority, string State, string AssetId);
public sealed record DashboardDto(int AssetCount, int OpenAlerts, int OpenTickets, string Source, DateTimeOffset ObservedAt);
public sealed record ConnectorDto(string Id, string Name, string Category, string Status, bool Implemented, bool Verified, bool OutboundEnabled);
public sealed record ProviderDto(string Id, string Name, string Status, bool Planned, bool Implemented, bool Verified, bool PackageAvailable, bool OutboundEnabled, string Notes);
public sealed record PromptTemplateDto(string Id, string Feature, string Name, int Version, string Status, string Content, string[] Variables, bool Editable, string Notes);
public sealed record FeedbackRequest(string? Category, string? Message, string? Page, string? IdempotencyKey = null);
public sealed record FeedbackDto(Guid Id, string Category, string Message, string? Page, DateTimeOffset CreatedAt, bool IsDemo = true, bool IsPersistent = false);
