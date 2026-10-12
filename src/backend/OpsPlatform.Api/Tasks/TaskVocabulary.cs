namespace OpsPlatform.Api.Tasks;

public sealed record TaskStateDescription(int Value,string Name);
public sealed record TaskTransitionDescription(int From,string Event,int To);
public sealed record TaskVocabularyDescription(IReadOnlyList<TaskStateDescription> States,IReadOnlyList<string> Events,
    IReadOnlyList<TaskTransitionDescription> Transitions);
// Derived from TaskLifecycle itself, so the published vocabulary cannot drift from the actual rules.
public static class TaskVocabulary
{
    public static TaskVocabularyDescription Describe()
    {
        var states=Enum.GetValues<TaskState>().Select(state=>new TaskStateDescription((int)state,state.ToString())).ToArray();
        var events=Enum.GetNames<TaskEvent>();
        var transitions=new List<TaskTransitionDescription>();
        foreach(var from in Enum.GetValues<TaskState>())
            foreach(var action in Enum.GetValues<TaskEvent>())
            {
                var result=TaskLifecycle.Apply(new(from,1),action,1);
                if(result.Accepted) transitions.Add(new((int)from,action.ToString(),(int)result.Snapshot.State));
            }
        return new(states,events,transitions.ToArray());
    }
}
