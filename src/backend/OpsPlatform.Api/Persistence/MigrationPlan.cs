namespace OpsPlatform.Api.Persistence;

// Planned durable schema. Nothing here is executed: the entries describe what a real implementation must
// create so the in-memory semantics (capacity, ordering, idempotency) survive the migration.
public sealed record MigrationStep(string Id, string Table, string Purpose, string[] KeyColumns,
    string[] UniqueConstraints, string Notes)
{
    public bool Executed => false;
    public bool ProductionEnabled => false;
}
public static class MigrationPlan
{
    public static IReadOnlyList<MigrationStep> List() =>
    [
        new("feedback-records","feedback_records","保存部门反馈记录（当前为进程内200条队列）。",
            ["id"],["ux_feedback_id(id)"],
            "必须在数据库层保留 id 唯一；容量淘汰策略需显式定义，禁止静默丢弃。"),
        new("prompt-drafts","prompt_drafts","提示词元数据与当前草稿（当前为进程内字典）。",
            ["id"],["ux_prompt_id(id)"],
            "feature 必须外键指向功能登记；草稿版本号与版本表强一致。"),
        new("prompt-versions","prompt_versions","只追加的草稿版本历史（上限20）。",
            ["prompt_id","version"],["ux_prompt_version(prompt_id,version)"],
            "仅允许 INSERT；回滚必须追加新版本而不是改写历史。"),
        new("prompt-published","prompt_published","不可变发布修订，记录来源草稿版本。",
            ["prompt_id","version"],["ux_prompt_published(prompt_id,version)"],
            "发布修订与来源草稿内容逐字一致；不得就地更新。"),
        new("task-snapshots","task_snapshots","任务状态与版本号（CAS 目标）。",
            ["id"],["ux_task_id(id)"],
            "状态迁移必须使用 version 比较交换；并发失败返回冲突而不是覆盖。"),
        new("task-journal","task_journal","任务迁移历史，按顺序追加。",
            ["task_id","sequence"],["ux_task_sequence(task_id,sequence)"],
            "sequence 唯一且递增；快照与历史必须在同一事务写入。"),
        new("operation-ledger","operation_ledger","幂等台账：身份、摘要、状态与结果引用。",
            ["scope","operation","key"],["ux_operation_identity(scope,operation,key)","ux_operation_id(operation_id)"],
            "唯一约束是幂等的唯一权威；结果未知必须可查询，禁止自动重试。"),
        new("feature-registry","prompt_features","功能登记，供覆盖核对使用。",
            ["key"],["ux_feature_key(key)"],
            "功能登记先于提示词；覆盖缺口只上报，不由迁移脚本补齐。")
    ];
    public static MigrationStep? Find(string? id) => id is null ? null : List().FirstOrDefault(step => step.Id == id);
}
