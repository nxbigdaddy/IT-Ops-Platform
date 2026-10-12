namespace OpsPlatform.Api.Persistence;

public sealed record StorageModeEntry(
    string Port,
    string Purpose,
    string Implementation,
    bool ConfiguredByFile,
    bool Durable,
    bool ProductionReady,
    IReadOnlyList<string> Limits);
public sealed record StorageModeReport(IReadOnlyList<StorageModeEntry> Ports)
{
    // Every mode the prototype can run today is a demo mode: none of them is a durability promise.
    public bool AnyDurable => false;
    public bool ProductionReady => false;
    public string Notes => "端口可替换只表示实现可被替换；文件实现仅用于本机开发，未做事务、并发写者或多实例协调，不能作为生产持久化。";
}
// Read-only description of the persistence ports and which implementation this process resolved. It never
// exposes configured file paths, connection strings or credentials.
public static class StorageModeCatalog
{
    public static StorageModeReport Report(bool feedbackFile, bool ledgerFile, bool taskFile, bool promptStateFile = false, bool relational = false, string provider = "sqlite", bool postgresConfigured = false) =>
        new(
        [
            new("IDemoFeedbackStore", "反馈记录（提交幂等、按编号核对）",
                Implementation(relational, provider, feedbackFile), feedbackFile, false, false,
                Limits(relational, postgresConfigured, ["单进程", "无事务", "容量200丢最旧", "损坏文件改名隔离"],
                    ["SQLite文件（本地开发）", "真实事务与唯一约束", "无迁移历史与保留策略", "非生产"],
                    ["PostgreSQL（未接服务器，连接目标受限于本机/文档地址）", "真实事务与唯一约束（同一套代码路径）", "无迁移历史与保留策略", "非生产"])),
            new("IOperationLedger", "幂等台账（先认领再执行、重放识别）",
                Implementation(relational, provider, ledgerFile), ledgerFile, false, false,
                Limits(relational, postgresConfigured, ["单进程", "无跨实例协调", "容量500拒绝而不淘汰", "无过期与墓碑清理"],
                    ["SQLite文件（本地开发）", "唯一索引保证同键只认领一次", "条件更新/CAS语义", "无过期与墓碑清理"],
                    ["PostgreSQL（未接服务器）", "唯一索引保证同键只认领一次", "条件更新/CAS语义", "无过期与墓碑清理"])),
            new("IDemoTaskStore", "任务快照与流水（CAS迁移）",
                Implementation(relational, provider, taskFile), taskFile, false, false,
                Limits(relational, postgresConfigured, ["单进程互斥", "无事务", "容量100", "两进程写同一文件会丢失一次更新"],
                    ["SQLite文件（本地开发）", "版本列条件更新实现CAS", "流水与状态同事务提交", "无迁移与保留策略"],
                    ["PostgreSQL（未接服务器）", "版本列条件更新实现CAS", "流水与状态同事务提交", "无迁移与保留策略"])),
            new("IPromptCatalog", "功能提示词目录与版本（读取，草稿内容可持久化）",
                Implementation(relational, provider, promptStateFile), promptStateFile, false, false,
                Limits(relational, postgresConfigured, ["变量schema始终来自代码", "单进程", "无事务", "无审批与生效流程"],
                    ["变量schema始终来自代码", "SQLite文件（本地开发）", "版本与发布修订整表事务替换", "无审批系统集成与生效流程"],
                    ["变量schema始终来自代码", "PostgreSQL（未接服务器）", "版本与发布修订整表事务替换", "无审批系统集成与生效流程"])),
        ]);
    private static string Implementation(bool relational, string provider, bool fileConfigured) =>
        relational ? provider : fileConfigured ? "development-file" : "memory";
    private static IReadOnlyList<string> Limits(bool relational, bool postgresConfigured, string[] processLimits, string[] sqliteLimits, string[] postgresLimits) =>
        relational ? postgresConfigured ? postgresLimits : sqliteLimits : processLimits;
}
