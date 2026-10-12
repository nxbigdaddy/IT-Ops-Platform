using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Persistence;

namespace OpsPlatform.Api.Services;

public sealed class FeedbackService
{
    public const int Capacity = InMemoryDemoFeedbackStore.Capacity;
    private readonly IDemoFeedbackStore store;
    public FeedbackService() : this(new InMemoryDemoFeedbackStore()) { }
    private readonly TimeProvider clock;
    public FeedbackService(IDemoFeedbackStore store) : this(store, TimeProvider.System) { }
    public FeedbackService(IDemoFeedbackStore store, TimeProvider clock)
    {
        this.store = store ?? throw new ArgumentNullException(nameof(store));
        this.clock = clock ?? throw new ArgumentNullException(nameof(clock));
    }
    public static Dictionary<string, string[]> Validate(FeedbackRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        if (request.Category is not ("bug" or "suggestion" or "question"))
            errors["category"] = ["Use bug, suggestion or question."];
        if (string.IsNullOrWhiteSpace(request.Message) || request.Message.Length > 2000)
            errors["message"] = ["Message must contain 1–2000 non-whitespace characters. Do not include secrets or personal data."];
        // Server-side backstop: a credential-shaped message is refused even if a caller bypasses the browser hint.
        else if (SensitiveContent.Contains(request.Message))
            errors["message"] = ["Message must not contain credential-shaped content."];
        if (request.Page is not null && (request.Page.Length > 200 || !request.Page.StartsWith('/') || request.Page.StartsWith("//")))
            errors["page"] = ["Page must be a relative application path of at most 200 characters."];
        return errors;
    }
    public FeedbackDto Add(FeedbackRequest request)
    {
        if (Validate(request).Count != 0) throw new ArgumentException("Invalid feedback.");
        var item = new FeedbackDto(Guid.NewGuid(), request.Category!, request.Message!.Trim(), request.Page, clock.GetUtcNow());
        store.Add(item);
        return item;
    }
    public IReadOnlyList<FeedbackDto> List()
    {
        return store.List();
    }
}
