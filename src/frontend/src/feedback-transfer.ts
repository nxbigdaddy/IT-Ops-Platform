import { containsSensitiveText, storeLimits, type Feedback } from './data.ts'

export const feedbackImportMaxBytes = 256 * 1024
const fields = ['id', 'department', 'module', 'text', 'priority', 'state', 'createdAt'] as const
const departments = ['IT 部门', '行政部门', '财务部门', '研发部门', '业务部门', '其他部门']
const modules = ['工作台', '资产', '告警', '工单', 'AD 目录', '共享权限', '打印管理', '虚拟化', '备份巡检', '知识库 / AI 助手', '后端联调', '设备接入', '系统数据库', 'AI 配置', '提示词管理', '提示词治理', '验收反馈']
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !containsSensitiveText(v)
const choice = (v: unknown, choices: string[]) => typeof v === 'string' && choices.includes(v)
// Exported timestamps use UTC ISO; reject ambiguous/invalid dates rather than silently losing order.
const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
const envelopeKeys = ['schemaVersion', 'mode', 'exportedAt', 'feedback'] as const
// Legacy packages carry four keys; a fifth is allowed only for a well-formed build identifier.
const buildIdPattern = /^[A-Za-z0-9.:_ -]{1,40}$/
const validEnvelopeKeys = (v: Record<string, unknown>) => exactKeys(v, envelopeKeys)
  || (exactKeys(v, [...envelopeKeys, 'buildId']) && typeof v.buildId === 'string' && buildIdPattern.test(v.buildId))
function validRow(v: unknown): v is Feedback {
  return record(v) && exactKeys(v, fields) && text(v.id, 64) && /^(?:ALT|WO|FB)-[a-zA-Z0-9-]+$/.test(v.id)
    && choice(v.department, departments) && choice(v.module, modules) && text(v.text, 2000)
    && choice(v.priority, ['一般', '重要', '阻塞验收']) && choice(v.state, ['待评审', '已采纳', '开发中', '待验收', '已验收']) && timestamp(v.createdAt)
}
export type FeedbackPreview = { total: number; added: number; duplicate: number; invalid: number; dropped: number; retained: number; errors: string[]; candidates: Feedback[]; canMerge: boolean }
function classify(candidates: readonly Feedback[], existing: readonly Feedback[]) {
  const seen = new Set(existing.map(r => r.id)), fresh: Feedback[] = []
  let duplicate = 0
  for (const row of candidates) {
    if (seen.has(row.id)) { duplicate++; continue }
    seen.add(row.id); fresh.push({ ...row })
  }
  const all = [...existing.map(r => ({ ...r })), ...fresh]
  // Stable tie-break: an existing row wins equal timestamps. Legacy local dates sort last.
  all.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
  return { feedback: all.slice(0, storeLimits.feedback), added: fresh.length, duplicate, dropped: Math.max(0, all.length - storeLimits.feedback) }
}
export function previewFeedbackImport(raw: string, existing: readonly Feedback[]): FeedbackPreview {
  const result: FeedbackPreview = { total: 0, added: 0, duplicate: 0, invalid: 0, dropped: 0, retained: existing.length, errors: [], candidates: [], canMerge: false }
  const fail = (message: string) => { result.errors.push(message); return result }
  if (new TextEncoder().encode(raw).byteLength > feedbackImportMaxBytes) return fail('文件超过 256 KB 上限。')
  let value: unknown
  try { value = JSON.parse(raw) } catch { return fail('JSON 格式无效，未修改任何反馈。') }
  if (!record(value) || !validEnvelopeKeys(value) || value.schemaVersion !== 1 || value.mode !== 'mock' || !timestamp(value.exportedAt) || !Array.isArray(value.feedback)) return fail('仅接受 schemaVersion=1、mode=mock 的反馈导出 JSON；包字段或导出时间无效。')
  result.total = value.feedback.length
  for (const [index, row] of value.feedback.entries()) {
    if (!validRow(row)) {
      result.invalid++
      // Never echo rejected values, which may contain secrets or personal information.
      if (result.errors.length < 8) result.errors.push(`第 ${index + 1} 条无效：仅允许完整白名单字段、合法枚举、非敏感模拟文本及 UTC ISO 时间。`)
    } else result.candidates.push({ ...row })
  }
  const summary = classify(result.candidates, existing)
  result.added = summary.added; result.duplicate = summary.duplicate; result.dropped = summary.dropped; result.retained = summary.feedback.length
  result.canMerge = result.invalid === 0 && result.added > 0
  return result
}
// Reparse against the latest state at confirmation: a stale preview can never overwrite an ID.
export function mergeFeedbackImport(raw: string, existing: readonly Feedback[]): Feedback[] {
  const preview = previewFeedbackImport(raw, existing)
  if (preview.errors.length) throw new Error('导入验证失败；现有反馈未更改。')
  if (!preview.added) return existing.map(row => ({ ...row }))
  return classify(preview.candidates, existing).feedback
}
export function exportFeedbackJson(feedback: readonly Feedback[], exportedAt = new Date().toISOString(), buildId?: string): string {
  const rows = feedback.map(row => Object.fromEntries(fields.map(key => [key, row[key]])))
  // buildId records which reviewed build the package describes; an invalid value is simply omitted.
  const envelope: Record<string, unknown> = { schemaVersion: 1, mode: 'mock', exportedAt, feedback: rows }
  if (buildId && buildIdPattern.test(buildId)) envelope.buildId = buildId
  return JSON.stringify(envelope, null, 2)
}
