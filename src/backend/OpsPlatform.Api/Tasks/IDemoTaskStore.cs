namespace OpsPlatform.Api.Tasks;

// Demo-only boundary. A future durable implementation needs a separate persistence contract.
// Apply must atomically compare version, append history and replace state.
// Read must return an isolated, consistent snapshot; callers cannot mutate stored history.
public interface IDemoTaskStore
{
    DemoTaskUpdate Create();
    DemoTask? Get(Guid id);
    DemoTaskRead? Read(Guid id);
    DemoTaskUpdate Apply(Guid id, TaskEvent action, int expectedVersion);
}
public sealed record DemoTaskRead(DemoTask Task, IReadOnlyList<DemoTaskJournal> History);
