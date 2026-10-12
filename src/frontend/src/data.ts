export type Asset = { id: string; name: string; kind: string; vendor: string; ip: string; site: string; status: string; owner: string; source: string }
export const assets: Asset[] = [
  { id: 'NET-001', name: '核心交换机 · Core-SW01', kind: '交换机', vendor: '华为', ip: '192.0.2.11', site: '总部 · 核心机房', status: '正常', owner: '基础架构组', source: 'SNMPv3 模拟快照' },
  { id: 'SRV-002', name: '文件服务 · FS-01', kind: '服务器', vendor: 'Dell', ip: '192.0.2.21', site: '总部 · 核心机房', status: '告警', owner: '系统运维组', source: 'Windows Worker 模拟快照' },
  { id: 'SEC-003', name: '边界防火墙 · FW-01', kind: '防火墙', vendor: '深信服', ip: '192.0.2.1', site: '总部 · 网络边界', status: '正常', owner: '网络安全组', source: '厂商 API 模拟快照' },
  { id: 'VM-004', name: '虚拟化集群 · ESX-01', kind: '虚拟化', vendor: 'VMware', ip: '192.0.2.31', site: '总部 · 核心机房', status: '正常', owner: '基础架构组', source: 'vSphere 模拟快照' },
  { id: 'PC-005', name: '设计终端 · DESIGN-08', kind: '终端', vendor: 'Lenovo', ip: '192.0.2.81', site: '研发中心 · 3F', status: '离线', owner: '桌面支持组', source: '终端管理模拟快照' },
  { id: 'PRT-006', name: '共享打印 · PRINT-02', kind: '打印机', vendor: 'HP', ip: '192.0.2.61', site: '行政办公区 · 2F', status: '告警', owner: '桌面支持组', source: 'SNMP 模拟快照' },
  { id: 'BAK-007', name: '备份存储 · BACKUP-01', kind: '存储', vendor: 'Synology', ip: '192.0.2.41', site: '灾备机房', status: '正常', owner: '系统运维组', source: '人工登记示例' },
  { id: 'LIC-008', name: '办公软件 · M365 示例授权', kind: '软件授权', vendor: 'Microsoft', ip: '—', site: '全组织', status: '待核实', owner: 'IT 管理组', source: '人工台账示例' },
]
export type Alert = { id: string; assetId: string; title: string; severity: string; state: string; time: string }
export type Ticket = { id: string; title: string; priority: string; state: string; alertId?: string }
export type Feedback = { id: string; department: string; module: string; text: string; priority: string; state: string; createdAt: string }
export type PromptVersion = { version: number; content: string; at: string }
export type Store = { alerts: Alert[]; tickets: Ticket[]; feedback: Feedback[]; database: string; ai: { provider: string; endpoint: string; model: string; secretRef: string; capabilities: string[] }; prompts: Record<string, PromptVersion[]> }
export const promptDefaults: Record<string, string> = {
  '告警研判': '你是只读运维助手。根据给定模拟告警，按“事实、可能原因、证据缺口、建议”输出。区分推测与已知事实。禁止执行命令、自动处置或输出凭据。',
  '工单摘要': '将脱敏工单归纳为问题、影响、处理记录和待确认事项。不得虚构已完成步骤，不得自动关闭工单。',
  '巡检报告': '按模拟巡检项总结正常、异常、未知。不将缺失数据视为通过，列出来源与观测时间。',
}
export function initialStore(): Store { return {
  alerts: [
    { id: 'ALT-001', assetId: 'SRV-002', title: '文件服务器磁盘空间低于阈值', severity: 'P1', state: '待确认', time: '09:42' },
    { id: 'ALT-002', assetId: 'PRT-006', title: '行政打印机耗材余量不足', severity: 'P3', state: '待确认', time: '09:28' },
    { id: 'ALT-003', assetId: 'PC-005', title: '终端采集心跳中断', severity: 'P2', state: '已确认', time: '08:56' },
  ],
  tickets: [{ id: 'WO-1001', title: '核实终端离线原因及采集节点状态', priority: 'P2', state: '处理中', alertId: 'ALT-003' }], feedback: [], database: 'PostgreSQL 16',
  ai: { provider: 'OpenAI 兼容', endpoint: 'https://ai.example.invalid/v1', model: 'demo-readonly-model', secretRef: 'secret://demo/ai-model', capabilities: ['文本生成', '结构化输出'] },
  prompts: Object.fromEntries(Object.entries(promptDefaults).map(([name, content]) => [name, [{ version: 1, content, at: '初始示例版本' }]])),
} }
export const storageKey = 'chengming-ops-demo-v1'
// Limits apply on load and, through sanitizeStore/serializeStore, on UI updates and writes.
export const storeLimits = { rawCharacters: 1_000_000, alerts: 100, tickets: 100, feedback: 100, promptVersions: 20 } as const
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !!v.trim() && !containsSensitiveText(v)
const choice = (v: unknown, options: readonly string[]): v is string => typeof v === 'string' && options.includes(v)
const id = (v: unknown): v is string => text(v, 64) && /^(?:ALT|WO|FB)-[a-zA-Z0-9-]+$/.test(v)

// Project only approved schema fields; arbitrary extra properties never survive a write.
// Free text must still be human-approved mock content: this is NOT DLP or a secret detector.
export function sanitizeStore(value: unknown): Store {
  const defaults = initialStore()
  if (!isRecord(value)) return defaults
  const p = value
  function rows<T>(value: unknown, max: number, fallback: T[], project: (row: Record<string, unknown>) => T | undefined): T[] {
    if (!Array.isArray(value)) return fallback
    const result: T[] = [], seen = new Set<unknown>()
    for (const row of value.slice(0, max)) {
      if (!isRecord(row) || seen.has(row.id)) return fallback
      const item = project(row)
      if (!item) return fallback
      seen.add(row.id); result.push(item)
    }
    return result
  }
  const alerts = rows<Alert>(p.alerts, storeLimits.alerts, defaults.alerts, r => {
    if (!id(r.id) || !choice(r.assetId, assets.map(a => a.id)) || !text(r.title, 120) || !choice(r.severity, ['P1','P2','P3']) || !choice(r.state, ['待确认','已确认','处理中']) || !text(r.time, 32)) return
    return { id:r.id, assetId:r.assetId, title:r.title, severity:r.severity, state:r.state, time:r.time }
  })
  const tickets = rows<Ticket>(p.tickets, storeLimits.tickets, defaults.tickets, r => {
    if (!id(r.id) || !text(r.title, 120) || !choice(r.priority, ['P1','P2','P3']) || !choice(r.state, ['待处理','处理中','已解决','已关闭']) || (r.alertId !== undefined && (!id(r.alertId) || !alerts.some(a => a.id === r.alertId)))) return
    return { id:r.id, title:r.title, priority:r.priority, state:r.state, ...(typeof r.alertId === 'string' ? { alertId:r.alertId } : {}) }
  })
  const feedback = rows<Feedback>(p.feedback, storeLimits.feedback, defaults.feedback, r => {
    if (!id(r.id) || !choice(r.department, ['IT 部门','行政部门','财务部门','研发部门','业务部门','其他部门']) || !choice(r.module, ['工作台','资产','告警','工单','AD 目录','共享权限','打印管理','虚拟化','备份巡检','知识库 / AI 助手','后端联调','设备接入','系统数据库','AI 配置','提示词管理','提示词治理','验收反馈']) || !text(r.text, 2000) || !choice(r.priority, ['一般','重要','阻塞验收']) || !choice(r.state, ['待评审','已采纳','开发中','待验收','已验收']) || !text(r.createdAt, 64)) return
    return { id:r.id, department:r.department, module:r.module, text:r.text, priority:r.priority, state:r.state, createdAt:r.createdAt }
  })
  const prompts = { ...defaults.prompts }
  if (isRecord(p.prompts)) for (const name of Object.keys(promptDefaults)) {
    const versions = p.prompts[name]
    if (!Array.isArray(versions) || !versions.length) continue
    const kept: PromptVersion[] = []
    for (const v of versions.slice(-storeLimits.promptVersions)) {
      if (!isRecord(v) || typeof v.version !== 'number' || !Number.isSafeInteger(v.version) || v.version <= 0 || v.version >= Number.MAX_SAFE_INTEGER || !text(v.content, 4000) || !text(v.at, 64) || (kept.length > 0 && v.version <= kept[kept.length - 1].version)) break
      kept.push({ version:v.version, content:v.content, at:v.at })
    }
    if (kept.length === Math.min(versions.length, storeLimits.promptVersions)) prompts[name] = kept
  }
  let ai = defaults.ai
  const a = p.ai
  if (isRecord(a) && choice(a.provider, ['OpenAI 兼容','Azure OpenAI','Anthropic Messages（候选）','自托管模型（模拟）']) && text(a.endpoint, 256) && text(a.model, 53) && /^demo-[a-z0-9-]{1,48}$/.test(a.model) && text(a.secretRef, 128) && Array.isArray(a.capabilities) && a.capabilities.length <= 5 && a.capabilities.every(c => choice(c, ['文本生成','结构化输出','工具调用','视觉理解','向量嵌入']))) {
    try {
      const url = new URL(a.endpoint)
      // Reserved DNS suffix, valid nonempty labels, no credential/query/fragment channels.
      if (url.protocol === 'https:' && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+invalid$/.test(url.hostname) && !url.username && !url.password && !url.search && !url.hash && !/[?#\s\\]/.test(a.endpoint)) {
        ai = { provider:a.provider, endpoint:a.endpoint, model:a.model, secretRef:defaults.ai.secretRef, capabilities:[...new Set(a.capabilities as string[])] }
      }
    } catch { /* An invalid endpoint resets AI only, not independent workflow state. */ }
  }
  return { alerts, tickets, feedback, prompts, ai, database:choice(p.database, ['PostgreSQL 16','SQL Server（候选）','SQLite（仅评估）','MySQL（候选）']) ? p.database : defaults.database }
}

export function serializeStore(value: unknown): string {
  const raw = JSON.stringify(sanitizeStore(value))
  return raw.length <= storeLimits.rawCharacters ? raw : JSON.stringify(initialStore())
}

// The prototype never requests the network or reads any other storage key.
export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(storageKey)
    // Bound work before JSON parsing; decoded field validation catches JSON escapes.
    if (!raw || raw.length > storeLimits.rawCharacters) return initialStore()
    return sanitizeStore(JSON.parse(raw))
  } catch { return initialStore() }
}
export function containsSensitiveText(value: string): boolean {
  // Best-effort UX warning only; never claim that regex proves text is non-sensitive.
  return /(?:sk-[a-z\d_-]{8,}|Bearer\s+\S+|-----BEGIN [^\r\n]*PRIVATE KEY|(?:api[_ -]?key|password|密码|密钥|token)\s*[:=：]\s*\S+)/i.test(value)
}
