namespace OpsPlatform.Api.Security;

public sealed record ApprovalEvidence(string ResourceId, int ResourceVersion, string ActionDigest,
    string RequestedBy, string ApprovedBy, DateTimeOffset ApprovedAt, DateTimeOffset ExpiresAt,
    bool Revoked, bool Consumed);
public sealed record PendingChange(string ResourceId, int ResourceVersion, string ActionDigest, string RequestedBy);
public sealed record ApprovalCheck(bool Valid, string Code)
{
    public bool ExecutionEnabled => false;
}
public sealed record ApprovalRule(string Name, bool Passed);
public sealed record ApprovalDiagnosis(bool Valid, string Code, IReadOnlyList<ApprovalRule> Rules)
{
    public bool ExecutionEnabled => false;
}
// Pure snapshot check only. Consume approval and enqueue task atomically in a future trusted repository.
public static class ApprovalBinding
{
    public static ApprovalCheck Validate(ApprovalEvidence? evidence, PendingChange? change, DateTimeOffset now)
    {
        var diagnosis = Diagnose(evidence, change, now);
        return new(diagnosis.Valid, diagnosis.Code);
    }
    // Same rules, but per-rule results so a reviewer can see which precondition failed.
    public static ApprovalDiagnosis Diagnose(ApprovalEvidence? evidence, PendingChange? change, DateTimeOffset now)
    {
        static ApprovalDiagnosis Deny(string code, params ApprovalRule[] rules) => new(false, code, rules);
        if (evidence is null || change is null) return Deny("approval_required", new ApprovalRule("approvalPresent", false));
        var changeWellFormed = !string.IsNullOrWhiteSpace(change.ResourceId) && change.ResourceVersion >= 1
            && !string.IsNullOrWhiteSpace(change.RequestedBy) && Digest(change.ActionDigest);
        if (!changeWellFormed) return Deny("invalid_change", new ApprovalRule("approvalPresent", true), new ApprovalRule("changeWellFormed", false));
        var rules = new List<ApprovalRule>
        {
            new("approvalPresent", true),
            new("changeWellFormed", true),
            new("notRevoked", !evidence.Revoked),
            new("notConsumed", !evidence.Consumed),
            new("timeWindowValid", evidence.ApprovedAt <= now && evidence.ExpiresAt > now && evidence.ExpiresAt > evidence.ApprovedAt),
            new("independentApprover", !string.IsNullOrWhiteSpace(evidence.ApprovedBy) && evidence.ApprovedBy != evidence.RequestedBy),
            new("bindingMatches", evidence.ResourceId == change.ResourceId && evidence.ResourceVersion == change.ResourceVersion
                && evidence.RequestedBy == change.RequestedBy && Digest(evidence.ActionDigest)
                && string.Equals(evidence.ActionDigest, change.ActionDigest, StringComparison.Ordinal)),
        };
        var failed = rules.FirstOrDefault(rule => !rule.Passed);
        return failed is null ? new(true, "valid_snapshot_only", rules) : new(false, CodeFor(failed.Name), rules);
    }
    private static string CodeFor(string rule) => rule switch
    {
        "notRevoked" => "approval_revoked",
        "notConsumed" => "approval_consumed",
        "timeWindowValid" => "approval_time_invalid",
        "independentApprover" => "independent_approval_required",
        "bindingMatches" => "approval_binding_mismatch",
        _ => "invalid_change",
    };
    private static bool Digest(string? text) => text is {Length:64} && text.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
}
