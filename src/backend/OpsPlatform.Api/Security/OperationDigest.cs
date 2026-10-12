using System.Security.Cryptography;
using System.Text.Json;

namespace OpsPlatform.Api.Security;

public sealed record OperationDraft(string ResourceId, int ResourceVersion, string Action, IReadOnlyDictionary<string,string> Parameters);
// Versioned canonical encoding; no credentials, execution, or interpretation of parameter values.
public static class OperationDigest
{
    public static string Compute(OperationDraft draft)
    {
        if(draft is null || !Identifier(draft.ResourceId) || !Identifier(draft.Action) || draft.ResourceVersion < 1
            || draft.Parameters is null || draft.Parameters.Count > 32) throw new ArgumentException("invalid_operation_draft");
        foreach(var pair in draft.Parameters)
            if(!Identifier(pair.Key) || pair.Value is null || pair.Value.Length > 2000 || !ValidUnicode(pair.Value)) throw new ArgumentException("invalid_operation_parameter");
        using var buffer=new MemoryStream();
        using(var writer=new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteNumber("schemaVersion",1);
            writer.WriteString("resourceId",draft.ResourceId);
            writer.WriteNumber("resourceVersion",draft.ResourceVersion);
            writer.WriteString("action",draft.Action);
            writer.WriteStartObject("parameters");
            foreach(var pair in draft.Parameters.OrderBy(p=>p.Key,StringComparer.Ordinal)) writer.WriteString(pair.Key,pair.Value);
            writer.WriteEndObject();writer.WriteEndObject();
        }
        return Convert.ToHexStringLower(SHA256.HashData(buffer.ToArray()));
    }
    private static bool ValidUnicode(string value)
    {
        for(var i=0;i<value.Length;i++)
        {
            if(char.IsHighSurrogate(value[i]))
            {
                if(i+1>=value.Length || !char.IsLowSurrogate(value[i+1])) return false;
                i++;
            }
            else if(char.IsLowSurrogate(value[i])) return false;
        }
        return true;
    }
    private static bool Identifier(string? value) => value is {Length: >0 and <=128}
        && value.All(c=>char.IsAsciiLetterOrDigit(c)||c is '-' or '_' or '.' or ':');
}
