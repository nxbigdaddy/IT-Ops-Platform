using OpsPlatform.Api.Security;
using Xunit;
namespace OpsPlatform.Api.Tests;
public sealed class OperationDigestTests
{
    private static OperationDraft Draft=>new("demo-target",1,"inspect",new Dictionary<string,string>{{"b","two"},{"a","one"}});
    [Fact] public void SchemaOneMatchesIndependentAsciiVector()
    {
        // Independently computed with Node crypto over the documented exact UTF-8 JSON bytes.
        Assert.Equal("8eb0602658d243a7bc1baf879c687ca7cfeafbaabb19b4020199bbfb70be1d06", OperationDigest.Compute(Draft));
    }
    [Fact] public void UnpairedSurrogatesAreRejectedBeforeEncoding()
    {
        foreach(var text in new[]{new string((char)0xD800,1),new string((char)0xDC00,1),new string(new[]{(char)0xD800,'x'})})
            Assert.Throws<ArgumentException>(()=>OperationDigest.Compute(Draft with{Parameters=new Dictionary<string,string>{{"a",text}}}));
        var valid=OperationDigest.Compute(Draft with{Parameters=new Dictionary<string,string>{{"a",char.ConvertFromUtf32(0x1F600)}}});
        var replacement=OperationDigest.Compute(Draft with{Parameters=new Dictionary<string,string>{{"a","\uFFFD"}}});
        Assert.NotEqual(valid,replacement);
    }
    [Fact] public void ParameterOrderDoesNotChangeDigest()
    {Assert.Equal(OperationDigest.Compute(Draft),OperationDigest.Compute(Draft with{Parameters=new Dictionary<string,string>{{"a","one"},{"b","two"}}}));}
    [Fact] public void EveryRelevantChangeInvalidatesDigest()
    {
        var original=OperationDigest.Compute(Draft);
        foreach(var changed in new[]{Draft with{ResourceId="other"},Draft with{ResourceVersion=2},Draft with{Action="restart"},Draft with{Parameters=new Dictionary<string,string>{{"a","changed"},{"b","two"}}}})
            Assert.NotEqual(original,OperationDigest.Compute(changed));
        Assert.Matches("^[a-f0-9]{64}$",original);
    }
    [Fact] public void DelimitersAndUnicodeArePreservedNotInterpreted()
    {
        var one=Draft with{Parameters=new Dictionary<string,string>{{"a","x,b:y"}}};
        var two=Draft with{Parameters=new Dictionary<string,string>{{"a","x"},{"b","y"}}};
        Assert.NotEqual(OperationDigest.Compute(one),OperationDigest.Compute(two));
        Assert.NotEqual(OperationDigest.Compute(Draft with{Parameters=new Dictionary<string,string>{{"a","é"}}}),OperationDigest.Compute(Draft with{Parameters=new Dictionary<string,string>{{"a","e\u0301"}}}));
    }
    [Fact] public void InvalidAndOversizedDraftsFailWithoutEcho()
    {
        Assert.Throws<ArgumentException>(()=>OperationDigest.Compute(Draft with{ResourceVersion=0}));
        Assert.Throws<ArgumentException>(()=>OperationDigest.Compute(Draft with{Action="; arbitrary command"}));
        Assert.Throws<ArgumentException>(()=>OperationDigest.Compute(Draft with{Parameters=new Dictionary<string,string>{{"a",new string('x',2001)}}}));
        Assert.Throws<ArgumentException>(()=>OperationDigest.Compute(Draft with{Parameters=Enumerable.Range(0,33).ToDictionary(i=>i.ToString(),i=>"demo")}));
    }
}
