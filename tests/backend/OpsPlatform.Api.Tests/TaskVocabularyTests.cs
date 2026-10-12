using OpsPlatform.Api.Tasks;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class TaskVocabularyTests
{
    [Fact] public void VocabularyIsDerivedFromTheLifecycleRules()
    {
        var vocabulary=TaskVocabulary.Describe();
        Assert.Equal(Enum.GetValues<TaskState>().Length,vocabulary.States.Count);
        Assert.Equal(Enum.GetNames<TaskEvent>(),vocabulary.Events);
        Assert.Equal(Enumerable.Range(0,vocabulary.States.Count),vocabulary.States.Select(item=>item.Value));
        foreach(var state in vocabulary.States)Assert.Equal(((TaskState)state.Value).ToString(),state.Name);
        // Every published transition must reproduce exactly what the lifecycle accepts.
        foreach(var transition in vocabulary.Transitions)
        {
            var from=(TaskState)transition.From;var action=Enum.Parse<TaskEvent>(transition.Event);
            var result=TaskLifecycle.Apply(new(from,1),action,1);
            Assert.True(result.Accepted);Assert.Equal(transition.To,(int)result.Snapshot.State);
        }
        // And nothing accepted by the lifecycle may be missing or mislabelled.
        var published=vocabulary.Transitions.Select(item=>(item.From,item.Event,item.To)).ToHashSet();
        foreach(var from in Enum.GetValues<TaskState>())
            foreach(var action in Enum.GetValues<TaskEvent>())
            {
                var result=TaskLifecycle.Apply(new(from,1),action,1);
                if(result.Accepted)Assert.Contains(((int)from,action.ToString(),(int)result.Snapshot.State),published);
            }
        Assert.All(vocabulary.Transitions,item=>Assert.InRange(item.From,0,vocabulary.States.Count-1));
        Assert.All(vocabulary.Transitions,item=>Assert.InRange(item.To,0,vocabulary.States.Count-1));
        Assert.Equal(vocabulary.Transitions.Count,vocabulary.Transitions.Select(item=>(item.From,item.Event)).Distinct().Count());
    }
}
