using System.Security.Cryptography;
using System.Text.Json;
using OpsPlatform.Api.Contracts;
using OpsPlatform.Api.Services;
namespace OpsPlatform.Api.Persistence;

// Versioned pure digest only. No storage, deduplication, authorization or automatic retry.
public static class FeedbackIntentDigest
{
    public static string Compute(FeedbackRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if(FeedbackService.Validate(request).Count!=0)throw new ArgumentException("Invalid feedback intent.",nameof(request));
        // Reject malformed UTF-16 instead of letting JSON replacement merge distinct inputs.
        foreach(var value in new[]{request.Message,request.Page})
        {
            if(value is null)continue;
            for(var i=0;i<value.Length;i++)
            {
                if(char.IsHighSurrogate(value[i]))
                {
                    if(i+1>=value.Length||!char.IsLowSurrogate(value[++i]))throw new ArgumentException("Invalid feedback Unicode.",nameof(request));
                }
                else if(char.IsLowSurrogate(value[i]))throw new ArgumentException("Invalid feedback Unicode.",nameof(request));
            }
        }
        using var buffer=new MemoryStream();
        using(var writer=new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();writer.WriteNumber("schemaVersion",1);
            writer.WriteString("operation","feedback.add");writer.WriteString("category",request.Category);
            writer.WriteString("message",request.Message!.Trim());writer.WriteString("page",request.Page);
            writer.WriteEndObject();
        }
        return Convert.ToHexStringLower(SHA256.HashData(buffer.ToArray()));
    }
}
