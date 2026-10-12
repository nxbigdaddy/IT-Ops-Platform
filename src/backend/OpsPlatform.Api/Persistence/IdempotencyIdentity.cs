namespace OpsPlatform.Api.Persistence;

// Identity comparison only. Durable uniqueness, authorization and result storage are not implemented.
public enum IdempotencyMatch { SameIntent, DifferentKey, PayloadConflict }
public sealed class IdempotencyIdentity
{
    public string Scope { get; }
    public string Operation { get; }
    public string Key { get; }
    public string Digest { get; }
    public IdempotencyIdentity(string scope,string operation,string key,string digest)
    {
        Scope=Token(scope,nameof(scope));Operation=Token(operation,nameof(operation));Key=Token(key,nameof(key));
        if(digest is null || digest.Length!=64 || digest.Any(c=>!(c is >= '0' and <= '9' or >= 'a' and <= 'f')))
            throw new ArgumentException("Canonical lowercase SHA-256 digest required.",nameof(digest));
        Digest=digest;
    }
    private static string Token(string value,string name)
    {
        if(string.IsNullOrEmpty(value)||value.Length>128||value.Any(c=>!(c is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' or '-' or '_' or '.' or ':')))
            throw new ArgumentException("Bounded ASCII identifier required.",name);
        return value;
    }
    public IdempotencyMatch Compare(IdempotencyIdentity other)
    {
        ArgumentNullException.ThrowIfNull(other);
        if(Scope!=other.Scope||Operation!=other.Operation||Key!=other.Key)return IdempotencyMatch.DifferentKey;
        return Digest==other.Digest?IdempotencyMatch.SameIntent:IdempotencyMatch.PayloadConflict;
    }
}
