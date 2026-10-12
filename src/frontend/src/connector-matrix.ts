export type ConnectorMatrixRow = [string, string, string, string, string]
// Planning matrix shown on 设备接入. Labels are unique and used as React keys.
export const connectorMatrixRows: ConnectorMatrixRow[] = [
  ['网络','华为 / H3C / Cisco / Juniper / Aruba','交换机、接口、VLAN','SNMPv3','能力设计，未验证'],
  ['Linux','Ubuntu / RHEL / Debian','主机、服务、磁盘（只读）','受控采集节点','计划接入，未实现'],
  ['虚拟化扩展','Proxmox','节点、虚机、存储','厂商 API','计划接入，未验证'],
  ['安全','深信服 / Fortinet','防火墙、VPN、HA','厂商只读 API','需版本与许可确认'],
  ['系统','Microsoft','AD、Windows 服务、磁盘','受控 Windows Worker','计划接入，未实现'],
  ['虚拟化','VMware / Hyper-V','宿主、虚机、存储','厂商 API / Worker','计划接入，未验证'],
  ['终端','Microsoft / 第三方安全平台','健康、病毒库、威胁摘要','厂商 API','待厂商选型'],
  ['打印','HP / Canon / Ricoh','耗材、队列、设备状态','SNMP / Worker','字段依型号而定'],
  ['备份','Veeam / Synology','任务、恢复点、恢复演练','API / 人工登记','计划接入，未验证'],
  ['数据库监控目标','PostgreSQL / SQL Server / MySQL','可用性、复制、备份摘要（只读）','受限 SQL / HTTPS exporter','计划接入，未实现'],
]
// Which registered candidate ids each row claims to cover. Coverage only; not compatibility evidence.
export const matrixCandidateMapping: Record<string, string[]> = {
  '网络': ['demo-snmp'],
  'Linux': ['demo-linux'],
  '虚拟化扩展': ['demo-virtualization'],
  '安全': ['demo-firewall-api'],
  '系统': ['demo-directory', 'demo-windows'],
  '虚拟化': ['demo-virtualization'],
  '终端': ['demo-endpoint'],
  '打印': ['demo-printer'],
  '备份': ['demo-backup'],
  '数据库监控目标': ['demo-db-monitor'],
}
