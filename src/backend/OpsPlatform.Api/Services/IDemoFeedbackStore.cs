using OpsPlatform.Api.Contracts;
namespace OpsPlatform.Api.Services;

// Demo-only storage: newest-first isolated reads, oldest eviction at capacity.
public interface IDemoFeedbackStore
{
    void Add(FeedbackDto item);
    IReadOnlyList<FeedbackDto> List();
}
public sealed class InMemoryDemoFeedbackStore : IDemoFeedbackStore
{
    public const int Capacity = 200;
    private readonly Queue<FeedbackDto> items = new();
    private readonly object gate = new();
    public void Add(FeedbackDto item)
    {
        ArgumentNullException.ThrowIfNull(item);
        lock(gate)
        {
            if(items.Count == Capacity) items.Dequeue();
            items.Enqueue(item);
        }
    }
    public IReadOnlyList<FeedbackDto> List()
    {
        lock(gate) return items.Reverse().ToArray();
    }
}
