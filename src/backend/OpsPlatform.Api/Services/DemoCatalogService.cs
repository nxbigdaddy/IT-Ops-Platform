using OpsPlatform.Api.Contracts;

namespace OpsPlatform.Api.Services;

// Synthetic fixtures only: no network, database, credential store or execution dependencies.
public sealed class DemoCatalogService
{
    private static readonly DateTimeOffset ObservedAt = new(2026, 10, 10, 0, 0, 0, TimeSpan.Zero);
    public IReadOnlyList<AssetDto> Assets { get; } = new AssetDto[]
    {
        new("demo-server-01", "演示应用服务器", "Server", "Windows Server", "Healthy", "演示总部", "synthetic-fixture", ObservedAt),
        new("demo-linux-01", "演示 Linux 服务器", "Server", "Ubuntu Linux", "Warning", "演示总部", "synthetic-fixture", ObservedAt),
        new("demo-switch-01", "演示核心交换机", "Switch", "Network OS", "Healthy", "演示总部", "synthetic-fixture", ObservedAt),
        new("demo-firewall-01", "演示防火墙", "Firewall", "Appliance OS", "Healthy", "演示总部", "synthetic-fixture", ObservedAt),
        new("demo-endpoint-01", "演示办公终端", "Endpoint", "Windows 11", "Warning", "演示分部", "synthetic-fixture", ObservedAt),
        new("demo-printer-01", "演示打印机", "Printer", "Embedded", "Warning", "演示分部", "synthetic-fixture", ObservedAt),
        new("demo-vm-01", "演示虚拟机", "VirtualMachine", "Linux", "Healthy", "演示总部", "synthetic-fixture", ObservedAt),
        new("demo-storage-01", "演示存储", "Storage", "Storage OS", "Healthy", "演示总部", "synthetic-fixture", ObservedAt)
    };
    public IReadOnlyList<AlertDto> Alerts { get; } = new AlertDto[]
    {
        new("demo-alert-01", "demo-linux-01", "Critical", "演示：磁盘容量阈值", "New"),
        new("demo-alert-02", "demo-endpoint-01", "Warning", "演示：终端签名版本待核验", "Acknowledged"),
        new("demo-alert-03", "demo-printer-01", "Warning", "演示：打印耗材不足", "New")
    };
    public IReadOnlyList<TicketDto> Tickets { get; } = new TicketDto[]
    {
        new("demo-ticket-01", "演示：排查磁盘告警", "High", "InProgress", "demo-linux-01"),
        new("demo-ticket-02", "演示：核验打印耗材", "Normal", "New", "demo-printer-01")
    };
    public DashboardDto Dashboard => new(Assets.Count, Alerts.Count, Tickets.Count, "synthetic-fixture", ObservedAt);
    public IReadOnlyList<ConnectorDto> Connectors => Configuration.ConnectorRegistry.DemoCatalog();
    public IReadOnlyList<ProviderDto> DatabaseProviders => Configuration.DatabaseCapabilities.DemoProviders();
    public IReadOnlyList<ProviderDto> AiProviders { get; } = new ProviderDto[]
    {
        new("openai-compatible", "OpenAI-compatible API", "planned", true, false, false, false, false, "整体接入未实现；仅新增离线Chat Completions文本契约适配与合成测试，无网络传输、批准外发或具体模型验证。"),
        new("anthropic", "Anthropic API", "planned", true, false, false, false, false, "整体接入未实现；仅新增离线Messages文本契约适配与合成测试，无密钥读取、外发或模型验证。"),
        new("local-model", "本地模型 API", "planned", true, false, false, false, false, "本地模型仍需权限与审计；当前没有请求或模型验证。")
    };
    public IReadOnlyList<PromptTemplateDto> PromptTemplates { get; } = new PromptTemplateDto[]
    {
        new("alert-explanation", "alerts", "告警解释", 1, "demo-draft", "仅根据 {{evidence}} 解释 {{alertTitle}}，区分事实与假设。无依据时明确无法确认，不执行操作。", new[] { "evidence", "alertTitle" }, false, "历史只读目录；新版草稿编辑/恢复见 /api/v1/prompts，变量schema以新版为准。生产发布、持久化和模型绑定未实现。"),
        new("ticket-summary", "tickets", "工单摘要", 1, "demo-draft", "总结 {{ticket}} 的已知事实与待人工确认项；不得自行批准变更。", new[] { "ticket" }, false, "提示词不构成授权；当前未调用模型。"),
        new("inspection-report", "inspection", "巡检报告", 1, "demo-draft", "依据 {{observations}} 编写摘要，标明缺失数据与来源，禁止将未知状态描述为正常。", new[] { "observations" }, false, "历史只读目录；新版内存草稿接口为 /api/v1/prompts，非审批或模型执行接口。")
    };
}
