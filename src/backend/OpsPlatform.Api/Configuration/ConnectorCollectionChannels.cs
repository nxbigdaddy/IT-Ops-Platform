namespace OpsPlatform.Api.Configuration;

public sealed record ConnectorCollectionChannel(
    string Id,
    string Label,
    string Deployment,
    IReadOnlyList<string> Prerequisites,
    IReadOnlyList<string> CoversMatrixRows,
    bool NeedsAgent,
    string Status,
    // Candidate protocols this channel would carry, using exactly the registry vocabulary.
    IReadOnlyList<string> Protocols);
public sealed record ConnectorChannelCatalog(IReadOnlyList<ConnectorCollectionChannel> Channels)
{
    public bool Implemented => false;
    public bool LiveVerified => false;
    public bool WriteEnabled => false;
    public string Notes => "通道为规划信息：未部署任何采集节点、未使用任何凭据、未验证厂商版本或许可。";
}
// Server-owned planning catalog. The matrix row labels are the same ones the 设备接入 page shows; the mapping is
// data here so the page never invents which channel would cover which row.
public static class ConnectorCollectionChannels
{
    public static readonly string[] MatrixRows =
    [
        "网络", "Linux", "虚拟化扩展", "安全", "系统", "虚拟化", "终端", "打印", "备份", "数据库监控目标"
    ];
    public static ConnectorChannelCatalog List() => new(
    [
        new("agentless-snmp", "无代理 SNMP（只读）", "从平台侧直连设备，无需部署节点",
            ["网络可达（仅文档保留地址）", "SNMPv3 只读账号引用", "设备版本与 MIB 支持确认"], ["网络", "打印"], false, "planned", ["SNMPv3"]),
        new("worker-linux-ssh", "受控 Linux Worker（SSH 只读）", "在受控网段部署采集节点后执行只读命令",
            ["采集节点部署与加固", "只读账号引用", "命令白名单与执行审计"], ["Linux"], true, "planned", ["SSH allowlist", "HTTPS agent"]),
        new("worker-windows", "受控 Windows Worker", "在受控网段部署 Windows 采集节点",
            ["采集节点部署与补丁基线", "只读服务账号引用", "服务与磁盘只读权限"], ["系统", "终端"], true, "planned", ["Windows Worker", "WinRM HTTPS"]),
        new("vendor-read-api", "厂商只读 API", "平台直接调用厂商管理接口（只读）",
            ["厂商版本与许可确认", "API 只读凭据引用", "接口限流与审计"], ["安全", "虚拟化", "虚拟化扩展", "终端"], false, "planned", ["HTTPS API", "LDAPS"]),
        new("restricted-sql", "受限 SQL（只读）", "以只读账号执行经白名单筛查的查询",
            ["只读数据库账号引用", "查询白名单（已有只读筛查）", "查询审计与限流"], ["数据库监控目标"], false, "planned", ["Restricted SQL", "HTTPS exporter"]),
        new("manual-registry", "人工登记／导入", "不做自动采集，由人工登记或导入台账",
            ["登记责任人", "导入格式与校验", "变更留痕"], ["备份"], false, "manual-only", ["Manual evidence"]),
    ]);
}
