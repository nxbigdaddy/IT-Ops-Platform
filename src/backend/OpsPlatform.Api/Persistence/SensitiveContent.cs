using System.Text.RegularExpressions;

namespace OpsPlatform.Api.Persistence;

// Conservative credential-shape screening for server-side input. It is a backstop for the browser-side hint,
// not a DLP product: it only recognises obvious credential shapes and never echoes the matched value.
public static partial class SensitiveContent
{
    private static readonly Regex[] Patterns =
    [
        PasswordAssignment(), ApiKeyAssignment(), SecretAssignment(), BearerToken(), PrivateKeyBlock(),
        OpenAiStyleKey(), AwsAccessKeyId(), ConnectionStringPassword(),
    ];
    public static bool Contains(string? text) => text is not null && Patterns.Any(pattern => pattern.IsMatch(text));
    [GeneratedRegex(@"(?i)\b(?:password|passwd|pwd|passphrase)\s*[:=]\s*\S{4,}", RegexOptions.CultureInvariant)]
    private static partial Regex PasswordAssignment();
    [GeneratedRegex(@"(?i)\b(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*\S{8,}", RegexOptions.CultureInvariant)]
    private static partial Regex ApiKeyAssignment();
    [GeneratedRegex(@"(?i)\bsecret\s*[:=]\s*\S{8,}", RegexOptions.CultureInvariant)]
    private static partial Regex SecretAssignment();
    [GeneratedRegex(@"(?i)\bbearer\s+[A-Za-z0-9._\-]{20,}", RegexOptions.CultureInvariant)]
    private static partial Regex BearerToken();
    [GeneratedRegex(@"-----BEGIN [A-Z ]{0,32}PRIVATE KEY-----", RegexOptions.CultureInvariant)]
    private static partial Regex PrivateKeyBlock();
    [GeneratedRegex(@"\bsk-[A-Za-z0-9]{16,}", RegexOptions.CultureInvariant)]
    private static partial Regex OpenAiStyleKey();
    [GeneratedRegex(@"\bAKIA[0-9A-Z]{16}\b", RegexOptions.CultureInvariant)]
    private static partial Regex AwsAccessKeyId();
    [GeneratedRegex(@"(?i)\b(?:user\s*id|uid|username)\s*=[^;]{1,64};\s*password\s*=\S{4,}", RegexOptions.CultureInvariant)]
    private static partial Regex ConnectionStringPassword();
}
