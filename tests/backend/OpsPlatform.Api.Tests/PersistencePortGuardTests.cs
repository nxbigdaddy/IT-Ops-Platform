using Xunit;
namespace OpsPlatform.Api.Tests;
// Static guard for the ports introduced by rounds 174-175: a read endpoint must not depend on a concrete
// in-memory implementation, and no endpoint may bypass the ledger port for idempotent writes.
public sealed class PersistencePortGuardTests
{
    private static IEnumerable<(string File,string Line,int Number)> EndpointLines()
    {
        var directory=new DirectoryInfo(AppContext.BaseDirectory);
        while(directory is not null && !File.Exists(Path.Combine(directory.FullName,"src","backend","OpsPlatform.Api","Program.cs")))
            directory=directory.Parent;
        Assert.NotNull(directory);
        var root=directory!.FullName;
        var files=new[]{Path.Combine("src","backend","OpsPlatform.Api","Program.cs"),
            Path.Combine("src","backend","OpsPlatform.Api","Tasks","DemoTaskEndpoints.cs")};
        foreach(var file in files)
        {
            var path=Path.Combine(root,file);
            Assert.True(File.Exists(path),$"missing source file: {path}");
            foreach(var (line,index) in File.ReadAllLines(path).Select((line,index)=>(line,index)))
                if(line.Contains("api.Map",StringComparison.Ordinal)) yield return (file,line,index+1);
        }
    }
    [Fact] public void NoEndpointDependsOnAConcreteInMemoryStore()
    {
        // A port name contains its implementation name (IDemoTaskStore/DemoTaskStore), so require a
        // non-letter boundary before the concrete type name.
        string[] forbidden=["DemoOperationLedger","InMemoryDemoFeedbackStore","DemoTaskStore"];
        var patterns=forbidden.Select(type=>$@"(?<![A-Za-z]){type}\b").ToArray();
        foreach(var (file,line,number) in EndpointLines())
            for(var index=0;index<forbidden.Length;index++)
                Assert.False(System.Text.RegularExpressions.Regex.IsMatch(line,patterns[index]),
                    $"{file}:{number} binds the concrete type {forbidden[index]}; depend on its port instead (use TryAddSingleton so it stays substitutable)");
    }
    [Fact] public void ReadEndpointsUsePortsWhileWritesKeepTheRuleOwner()
    {
        var lines=EndpointLines().ToArray();
        Assert.NotEmpty(lines);
        // Reads must go through the read ports.
        foreach(var (file,line,number) in lines.Where(item=>item.Line.Contains("api.MapGet",StringComparison.Ordinal)))
        {
            Assert.False(line.Contains("PromptService",StringComparison.Ordinal),
                $"{file}:{number} is a GET and must use IPromptCatalog rather than the mutation owner");
            Assert.False(line.Contains("FeedbackService",StringComparison.Ordinal),
                $"{file}:{number} is a GET and must use IDemoFeedbackStore/IOperationLedger rather than the mutation owner");
        }
        // The ledger port must appear on the idempotent write path, and the prompt read port on the catalog reads.
        Assert.Contains(lines,item=>item.Line.Contains("IOperationLedger",StringComparison.Ordinal));
        Assert.Contains(lines,item=>item.Line.Contains("IPromptCatalog",StringComparison.Ordinal));
        Assert.Contains(lines,item=>item.Line.Contains("IDemoTaskStore",StringComparison.Ordinal));
    }
}
