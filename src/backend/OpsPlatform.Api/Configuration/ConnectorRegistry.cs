using OpsPlatform.Api.Contracts;
namespace OpsPlatform.Api.Configuration;

public sealed record ConnectorCandidate(string Id, string Name, string Category, string[] Protocols,
    string[] TargetFamilies, string[] CandidateVendors, string[] PlannedReadCapabilities)
{
    public string Status => "planned";
    public bool Implemented => false;
    public bool LiveVerified => false;
    public bool WriteEnabled => false;
    public string[] RequiredBeforeOnboarding => ConnectorOnboarding.For(Id);
    public string Evidence => "No model/firmware-specific verification; names identify candidates only.";
}
// Registration is not compatibility evidence. No discovery, remote command or network implementation.
public static class ConnectorRegistry
{
    public static IReadOnlyList<ConnectorCandidate> List() => new ConnectorCandidate[]
    {
        new("demo-snmp","SNMPv3","Network",["SNMPv3"],["Switch","Firewall"],["Huawei","H3C","Cisco","Juniper","Aruba"],["interfaces","inventory","health"]),
        new("demo-directory","Active Directory","Directory",["LDAPS"],["Windows Server AD"],["Microsoft"],["users","groups","lock-state"]),
        new("demo-endpoint","终端安全平台","Endpoint",["HTTPS API"],["Windows","Linux","macOS"],["Vendor-specific"],["coverage","signature-age","alerts"]),
        new("demo-virtualization","虚拟化平台","Virtualization",["HTTPS API"],["vSphere","Hyper-V","Proxmox"],["VMware","Microsoft","Proxmox"],["hosts","vms","capacity"]),
        new("demo-backup","备份平台","Backup",["HTTPS API","Manual evidence"],["Backup server"],["Vendor-specific"],["job-result","restore-evidence"]),
        new("demo-windows","Windows只读采集","Server",["Windows Worker","WinRM HTTPS"],["Windows Server","Windows 11"],["Microsoft"],["services","disk","event-summary"]),
        new("demo-linux","Linux只读采集","Server",["SSH allowlist","HTTPS agent"],["Ubuntu","Debian","RHEL","Rocky Linux"],["Distribution-specific"],["disk","services","load"]),
        new("demo-printer","打印服务","Printing",["SNMPv3","Windows Worker"],["Network printer","Windows print server"],["HP","Canon","Ricoh","Epson"],["queue-summary","supplies","availability"]),
        new("demo-firewall-api","防火墙厂商API","Network",["HTTPS API"],["Firewall","Behavior management"],["Fortinet","Palo Alto","Sangfor","Huawei"],["health","policy-summary","session-summary"]),
        new("demo-db-monitor","数据库只读监控","DatabaseTarget",["Restricted SQL","HTTPS exporter"],["PostgreSQL","SQL Server","MySQL"],["Engine-specific"],["availability","replication","backup-summary"])
    };
    public static ConnectorCandidate? Find(string id) => List().SingleOrDefault(c => c.Id == id);
    public static IReadOnlyList<ConnectorDto> DemoCatalog() => List().Select(c => new ConnectorDto(c.Id,c.Name,c.Category,c.Status,c.Implemented,c.LiveVerified,false)).ToArray();
}
