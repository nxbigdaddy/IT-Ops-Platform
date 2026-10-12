namespace OpsPlatform.Api.Configuration;

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]

public sealed record MonitoredQueryDraft(
    [property: System.Text.Json.Serialization.JsonRequired] string? Statement);public sealed record MonitoredQueryError(string Field, string Code);
public sealed record MonitoredQueryCheck(IReadOnlyList<MonitoredQueryError> Errors, string StatementKind, int Length)
{
    public bool ConfigurationValid => Errors.Count == 0;
    public bool ExecutionAttempted => false;
    public bool ConnectionAttempted => false;
    // Even an accepted statement is only classified, never sent to a database.
    public bool ReadOnlyOnly => true;
    // Keyword and function screening only: this is not a SQL parser and cannot prove a statement is side-effect free.
    public string Notes => "按关键字与函数名单筛查，且不做语法解析；通过只表示未命中已知写入特征，不能证明语句无副作用。";
}
// Read-only allowlist for monitoring statements. Classification only: nothing is executed, parsed or sent.
public static partial class MonitoredQueryPolicy
{
    public const int MaxStatementLength = 4000;
    private static readonly string[] WriteKeywords =
    [
        "insert", "update", "delete", "merge", "truncate", "drop", "alter", "create", "grant", "revoke",
        "copy", "call", "do", "vacuum", "analyze", "refresh", "set", "reset", "lock", "begin", "commit",
        "rollback", "savepoint", "reindex", "cluster", "comment", "into", "execute", "prepare", "listen", "notify"
    ];
    private static readonly string[] WriteFunctions =
    [
        "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf", "pg_rotate_logfile", "pg_switch_wal",
        "pg_create_restore_point", "pg_drop_replication_slot", "pg_promote", "lo_import", "lo_export",
        "lo_unlink", "dblink", "dblink_exec", "set_config", "pg_write_file", "pg_logdir_ls", "nextval", "setval"
    ];
    public static MonitoredQueryCheck Check(MonitoredQueryDraft? draft)
    {
        if (draft?.Statement is null) return new([new("statement", "required")], "none", 0);
        var statement = draft.Statement;
        if (string.IsNullOrWhiteSpace(statement)) return new([new("statement", "required")], "none", statement.Length);
        if (statement.Length > MaxStatementLength) return new([new("statement", "too_long")], "none", statement.Length);
        var errors = new List<MonitoredQueryError>();
        if (statement.Contains(';')) errors.Add(new("statement", "multiple_statements"));
        if (statement.Contains("--", StringComparison.Ordinal) || statement.Contains("/*", StringComparison.Ordinal)
            || statement.Contains("*/", StringComparison.Ordinal)) errors.Add(new("statement", "comments_not_allowed"));
        var collapsed = Collapse(statement).ToLowerInvariant();
        var kind = collapsed.StartsWith("select ", StringComparison.Ordinal) ? "select"
            : collapsed.StartsWith("show ", StringComparison.Ordinal) ? "show"
            : collapsed.StartsWith("with ", StringComparison.Ordinal) ? "with"
            : "unsupported";
        if (kind == "unsupported") errors.Add(new("statement", "not_read_only"));
        else if (kind == "with" && !collapsed.Contains("select ", StringComparison.Ordinal)) errors.Add(new("statement", "not_read_only"));
        foreach (var function in WriteFunctions)
            if (collapsed.Contains(function, StringComparison.Ordinal)) errors.Add(new("statement", $"write_function_{function}"));
        foreach (var keyword in WriteKeywords)
            if (ContainsWord(collapsed, keyword)) errors.Add(new("statement", $"write_keyword_{keyword}"));
        if (errors.Count > 0) return new(errors.ToArray(), kind, statement.Length);
        return new([], kind, statement.Length);
    }
    private static string Collapse(string statement) =>
        string.Join(' ', statement.Split([' ', '\t', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries));
    private static bool ContainsWord(string text, string word)
    {
        var index = text.IndexOf(word, StringComparison.Ordinal);
        while (index >= 0)
        {
            var before = index == 0 || !char.IsAsciiLetterOrDigit(text[index - 1]) && text[index - 1] != '_';
            var afterIndex = index + word.Length;
            var after = afterIndex >= text.Length || !char.IsAsciiLetterOrDigit(text[afterIndex]) && text[afterIndex] != '_';
            if (before && after) return true;
            index = text.IndexOf(word, index + 1, StringComparison.Ordinal);
        }
        return false;
    }
}
