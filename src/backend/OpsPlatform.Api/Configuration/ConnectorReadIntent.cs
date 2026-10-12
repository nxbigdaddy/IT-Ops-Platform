namespace OpsPlatform.Api.Configuration;

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record ConnectorReadDraft(
    [property: System.Text.Json.Serialization.JsonRequired] string? ConnectorId,
    [property: System.Text.Json.Serialization.JsonRequired] string? Protocol,
    [property: System.Text.Json.Serialization.JsonRequired] string[]? Capabilities,
    // Reference only: the prototype never accepts a credential value, only a synthetic reference shape.
    [property: System.Text.Json.Serialization.JsonRequired] string? SecretReference);
public sealed record ConnectorIntentError(string Field,string Code);
public sealed record ConnectorIntentCheck(IReadOnlyList<ConnectorIntentError> Errors, ConnectorCandidate? Candidate = null)
{
    public bool ConfigurationValid => Errors.Count==0;
    public bool ConnectionAttempted => false;
    public bool ExecutionAllowed => false;
    public bool CompatibilityVerified => false;
    public string Notes => "仅校验候选、协议、能力与凭据引用形状；未连接设备、未读取凭据、未验证兼容性。";
}
// Registry membership only; no addresses, credentials, discovery or remote transport.
public static partial class ConnectorReadIntent
{
    [System.Text.RegularExpressions.GeneratedRegex(@"\Asecret://connector/[a-z0-9][a-z0-9_-]{0,63}\z",System.Text.RegularExpressions.RegexOptions.CultureInvariant)]
    private static partial System.Text.RegularExpressions.Regex ReferencePattern();
    public static ConnectorIntentCheck Check(ConnectorReadDraft? draft)
    {
        var errors=new List<ConnectorIntentError>();
        if(draft is null)return new([new("configuration","required")]);
        var candidate=draft.ConnectorId is {Length:>0 and <=100} id ? ConnectorRegistry.Find(id) : null;
        if(candidate is null)errors.Add(new("connectorId","unknown_candidate"));
        if(string.IsNullOrEmpty(draft.Protocol)||draft.Protocol.Length>100)
            errors.Add(new("protocol","required_or_too_long"));
        else if(candidate is not null&&!candidate.Protocols.Contains(draft.Protocol,StringComparer.Ordinal))
            errors.Add(new("protocol","not_registered"));
        if(draft.Capabilities is not {Length:>0 and <=16})errors.Add(new("capabilities","count_out_of_range"));
        else
        {
            if(draft.Capabilities.Any(value=>string.IsNullOrEmpty(value)||value.Length>100))errors.Add(new("capabilities","invalid_name"));
            else
            {
                if(draft.Capabilities.Distinct(StringComparer.Ordinal).Count()!=draft.Capabilities.Length)errors.Add(new("capabilities","duplicate"));
                if(candidate is not null&&draft.Capabilities.Any(value=>!candidate.PlannedReadCapabilities.Contains(value,StringComparer.Ordinal)))errors.Add(new("capabilities","not_registered"));
            }
        }
        if(draft.SecretReference is null || !ReferencePattern().IsMatch(draft.SecretReference))errors.Add(new("secretReference","reference_required"));
        return new(errors.ToArray(),candidate);
    }
}

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record ConnectorPlanItem(
    [property: System.Text.Json.Serialization.JsonRequired] string? ConnectorId,
    [property: System.Text.Json.Serialization.JsonRequired] string? Protocol,
    [property: System.Text.Json.Serialization.JsonRequired] string[]? Capabilities,
    [property: System.Text.Json.Serialization.JsonRequired] string? SecretReference = null);
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed record ConnectorPlanDraft([property: System.Text.Json.Serialization.JsonRequired] ConnectorPlanItem[]? Items);
public sealed record ConnectorPlanItemResult(int Index,bool ConfigurationValid,IReadOnlyList<ConnectorIntentError> Errors);
public sealed record ConnectorPlanCheck(IReadOnlyList<ConnectorPlanItemResult> Items,IReadOnlyList<ConnectorIntentError> Errors)
{
    public bool ConfigurationValid => Errors.Count==0&&Items.All(item=>item.ConfigurationValid);
    public int ValidItems => Items.Count(item=>item.ConfigurationValid);
    public int InvalidItems => Items.Count(item=>!item.ConfigurationValid);
    public bool ConnectionAttempted => false;
    public bool ExecutionAllowed => false;
    public bool CompatibilityVerified => false;
    public string Notes => "仅校验候选、协议、能力与凭据引用形状；未连接设备、未读取凭据、未验证兼容性。";
}
// Registry self-consistency only: validates declared protocol/capability pairs, never a device plan.
public static class ConnectorPlan
{
    public const int MaxItems = 20;
    public static ConnectorPlanCheck Check(ConnectorPlanDraft? draft)
    {
        if(draft is null)return new([],[new("configuration","required")]);
        if(draft.Items is null||draft.Items.Length is 0 or >MaxItems)
            return new([],[new("items","count_out_of_range")]);
        var results=draft.Items.Select((item,index)=>{
            var check=ConnectorReadIntent.Check(item is null?null:new(item.ConnectorId,item.Protocol,item.Capabilities,item.SecretReference));
            return new ConnectorPlanItemResult(index,check.ConfigurationValid,check.Errors);
        }).ToArray();
        return new(results,[]);
    }
}
