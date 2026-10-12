namespace OpsPlatform.Api.Configuration;

// What must be agreed before onboarding. Planning content only: none of it is collected or verified here.
public static class ConnectorOnboarding
{
    public static readonly IReadOnlyDictionary<string, string[]> Required = new Dictionary<string, string[]>(StringComparer.Ordinal)
    {
        ["demo-snmp"] = ["只读SNMPv3用户与认证/加密参数", "设备型号与固件版本", "允许采集的源地址与轮询窗口", "OID清单与只读视图范围"],
        ["demo-directory"] = ["只读服务账号与最小权限委派", "目录服务证书信任链", "允许查询的OU范围", "查询频率与审计要求"],
        ["demo-endpoint"] = ["厂商API版本与许可范围", "只读API凭据与IP允许列表", "数据最小化字段清单", "采集频率与保留期"],
        ["demo-virtualization"] = ["只读API账号与角色", "平台版本与集群范围", "排除的敏感虚机或标签", "采集频率与超时"],
        ["demo-backup"] = ["只读API或报表导出方式", "任务与恢复点字段确认", "恢复演练证据来源", "保留期与审计要求"],
        ["demo-windows"] = ["WinRM或Worker部署与证书", "只读采集命令白名单", "服务账号最小权限", "目标主机清单与维护窗口"],
        ["demo-linux"] = ["SSH只读账号与命令白名单", "主机清单与跳板路径", "采集频率与磁盘/服务范围", "日志脱敏要求"],
        ["demo-printer"] = ["SNMP只读或打印服务查询方式", "耗材字段与型号映射", "只读账号", "队列数据最小化"],
        ["demo-firewall-api"] = ["厂商只读API与许可", "版本与只读管理员", "允许读取的策略字段", "变更窗口与审计要求"],
        ["demo-db-monitor"] = ["只读数据库账号与查询白名单", "引擎版本与复制拓扑", "采集频率与备份摘要来源", "数据最小化与凭据托管"],
    };
    public static string[] For(string id) => Required.TryGetValue(id, out var items) ? items : [];
}
