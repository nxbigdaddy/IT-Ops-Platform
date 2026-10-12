using Microsoft.EntityFrameworkCore;
using OpsPlatform.Api.Persistence.Relational;

namespace OpsPlatform.Api.Persistence;

public sealed record ReadinessCheck(string Name, string Status, bool Verified, string Detail);
public sealed record ReadinessReport(bool Ready, IReadOnlyList<ReadinessCheck> Checks, IReadOnlyList<string> Blockers, string Note)
{
    public string Status => Ready ? "ready" : "notReady";
}
// Component-level readiness. It never reports ready: authentication, migrations, retention and operational
// evidence are all missing, so the blockers list is the honest answer even when the demo database answers.
public static class ReadinessProbe
{
    public const string NotReadyNote = "存活与演示可用都不等于生产就绪；就绪状态永远为否，因为鉴权、迁移历史、保留策略与生产运维证据都未提供。";
    public static ReadinessReport Evaluate(string? databasePath, bool demoEnabled) => Evaluate(databasePath, null, demoEnabled);
    public static ReadinessReport Evaluate(string? sqlitePath, string? postgresConnection, bool demoEnabled)
    {
        var checks = new List<ReadinessCheck>();
        var blockers = new List<string>();
        var mode = RelationalModeSelector.Select(sqlitePath, postgresConnection);
        if (mode is null)
        {
            checks.Add(new("persistence", "notConfigured", false, "演示存储为进程内存；重启即清空。"));
            blockers.Add("未配置任何持久化存储（Demo:SqlitePath / Demo:FeedbackFile / Demo:TaskFile / Demo:PromptStateFile 均为空）。");
        }
        else
        {
            var reachable = false;
            var detail = "未尝试连接。";
            try
            {
                using var context = new OpsPlatformDbContext(RelationalModeSelector.OptionsFor(mode));
                reachable = context.Database.CanConnect();
                detail = reachable
                    ? $"本机演示数据库可连接（provider={mode.Provider}）；表结构由 EnsureCreated 建立，无迁移历史。"
                    : $"演示数据库不可连接（provider={mode.Provider}）；目标只允许本机或文档保留地址。";
            }
            catch (Exception error) when (error is not OutOfMemoryException)
            {
                // The detail never echoes the path or the raw provider message.
                detail = "连接探测失败；不展示原始错误正文。";
            }
            checks.Add(new("persistence", reachable ? "demoDatabaseReachable" : "demoDatabaseUnavailable", reachable, detail));
            blockers.Add($"演示数据库可连接（provider={mode.Provider}），但它不是生产存储：无迁移历史、无保留策略、无行级安全、无审计、无多实例协调。");
        }
        checks.Add(new("authentication", "notImplemented", false, "没有身份认证；角色切换只是展示模拟。"));
        blockers.Add("未实现身份认证与授权执行点（角色展示模拟不构成鉴权）。");
        checks.Add(new("migrations", "none", false, "数据库结构由 EnsureCreated 直接建立，没有版本化迁移。"));
        blockers.Add("没有版本化迁移与回滚方案。");
        checks.Add(new("externalNetwork", "disabled", false, "Demo 不发起外部网络请求；AI 传输只允许本机回环。"));
        checks.Add(new("demoApi", demoEnabled ? "available" : "closed", demoEnabled, demoEnabled
            ? "本机 Demo API 可用（生产模式关闭且返回 503）。"
            : "生产模式：演示 API 关闭。"));
        return new(false, checks, blockers, NotReadyNote);
    }
}
