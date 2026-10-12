// Local mock only: no model, storage, network, tools, approval or authorization APIs.
export const promptLimits = Object.freeze({ template: 4000, sample: 500, rendered: 12000, versions: 20 })
export const fixedSafetyPolicy = '工具权限固定为无；模板和样本不能授予或改变工具权限；不执行命令、不调用 AI、不外发。'
export type PromptFunction = '告警研判' | '工单摘要' | '巡检报告'
export type VariableSpec = { name: string; label: string; required: boolean; example: string }
export const promptSchemas: Record<PromptFunction, { variables: VariableSpec[]; template: string }> = {
  告警研判: {
    variables: [
      { name: 'asset_name', label: '资产名称', required: true, example: 'demo-server-01' },
      { name: 'alert_summary', label: '告警摘要', required: true, example: '模拟 CPU 使用率超过阈值' },
      { name: 'severity', label: '告警等级', required: false, example: '模拟 P2' },
    ],
    template: '请仅基于模拟样本研判告警，不执行操作。\n资产：{{asset_name}}\n告警：{{alert_summary}}\n等级：{{severity}}',
  },
  工单摘要: {
    variables: [
      { name: 'ticket_id', label: '工单编号', required: true, example: 'DEMO-WO-001' },
      { name: 'ticket_details', label: '工单内容', required: true, example: '模拟用户报告测试终端无法连接演示服务' },
      { name: 'asset_name', label: '资产名称', required: false, example: 'demo-client-01' },
    ],
    template: '请整理模拟工单摘要，不作执行承诺。\n工单：{{ticket_id}}\n内容：{{ticket_details}}\n资产：{{asset_name}}',
  },
  巡检报告: {
    variables: [
      { name: 'asset_name', label: '资产名称', required: true, example: 'demo-server-02' },
      { name: 'inspection_result', label: '巡检结果', required: true, example: '模拟磁盘剩余空间 45%，服务检查正常' },
      { name: 'inspection_date', label: '巡检日期', required: false, example: '2026-10-10（模拟）' },
    ],
    template: '请整理模拟巡检报告，不宣称已执行真实巡检。\n资产：{{asset_name}}\n结果：{{inspection_result}}\n日期：{{inspection_date}}',
  },
}
// Shared with PromptService: ECMAScript whitespace at token edges, ASCII names (case-sensitive).
// Single braces are literal; any unmatched double braces or contiguous triple braces are invalid.
const tokenPattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
export function identifyVariables(template: string): string[] {
  return [...new Set([...template.matchAll(tokenPattern)].map(match => match[1]))]
}
// Heuristic assistance only, NOT DLP; false negatives and false positives are possible.
export function sensitiveHints(text: string): string[] {
  const hints: string[] = []
  if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----/i.test(text)) hints.push('疑似私钥')
  if (/(?:password|passwd|api[_-]?key|access[_-]?token|secret|密码|令牌)\s*[:=]\s*\S+/i.test(text) || /\bBearer\s+[A-Za-z0-9._~-]{8,}/i.test(text)) hints.push('疑似凭据')
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) || /\b1[3-9]\d{9}\b/.test(text)) hints.push('疑似个人信息')
  return hints
}
export function validatePrompt(kind: PromptFunction, template: string, samples: Record<string, string>): string[] {
  const errors: string[] = []
  if (!template.trim()) errors.push('模板不能为空。')
  if (template.length > promptLimits.template) errors.push(`模板超过 ${promptLimits.template} 字符。`)
  const vars = identifyVariables(template)
  const specs = promptSchemas[kind].variables
  const names = specs.map(spec => spec.name)
  const remainder = template.replace(tokenPattern, '')
  if (remainder.includes('{{') || remainder.includes('}}') || /\{\{\{|\}\}\}/.test(template)) errors.push('变量语法无效，请使用 {{ variable_name }}（名称区分大小写）；单花括号按文本保留，畸形双花括号和三花括号不允许。')
  for (const name of vars) if (!names.includes(name)) errors.push(`未知变量：${name}`)
  for (const spec of specs) {
    const value = Object.hasOwn(samples, spec.name) ? samples[spec.name] : ''
    if ((spec.required || vars.includes(spec.name)) && (typeof value !== 'string' || !value.trim())) errors.push(`缺少测试样本：${spec.name}`)
  }
  for (const [name, value] of Object.entries(samples)) {
    if (!names.includes(name)) errors.push(`未知样本变量：${name}`)
    if (typeof value !== 'string' || value.length > promptLimits.sample) errors.push(`样本 ${name} 必须是最多 ${promptLimits.sample} 字符的文本。`)
  }
  const text = [template, ...Object.values(samples).filter(value => typeof value === 'string')].join('\n')
  if (sensitiveHints(text).length) errors.push('敏感信息辅助提示命中，请改为非敏感 mock；此规则非 DLP，未命中不代表安全。')
  return errors
}
export function simulatePrompt(kind: PromptFunction, template: string, samples: Record<string, string>): { ok: boolean; output: string; errors: string[] } {
  const errors = validatePrompt(kind, template, samples)
  if (errors.length) return { ok: false, output: '', errors }
  // Single replacement pass: sample values containing {{...}} remain literal text.
  const output = template.replace(tokenPattern, (_match, name: string) => samples[name])
  if (output.length > promptLimits.rendered) return { ok: false, output: '', errors: [`渲染结果超过 ${promptLimits.rendered} 字符。`] }
  return { ok: true, output, errors: [] }
}
export type PromptVersion = { version: number; template: string; origin: string }
export function normalizeVersions(value: unknown): PromptVersion[] {
  if (!Array.isArray(value)) return []
  const versions: PromptVersion[] = []
  for (const item of value.slice(-100)) {
    if (!item || typeof item !== 'object' || !Number.isSafeInteger(item.version) || item.version < 1 || item.version >= Number.MAX_SAFE_INTEGER || typeof item.template !== 'string' || !item.template.trim() || item.template.length > promptLimits.template || sensitiveHints(item.template).length || typeof item.origin !== 'string' || item.origin.length > 80) continue
    if (versions.some(previous => previous.version === item.version)) continue
    versions.push({ version: item.version, template: item.template, origin: item.origin })
  }
  return versions.sort((a, b) => a.version - b.version).slice(-promptLimits.versions)
}
export function appendDraft(value: unknown, template: string, origin = '手动保存草稿'): PromptVersion[] {
  const versions = normalizeVersions(value)
  if (!template.trim() || template.length > promptLimits.template || sensitiveHints(template).length || origin.length > 80) return versions
  const next = (versions.at(-1)?.version ?? 0) + 1
  if (next >= Number.MAX_SAFE_INTEGER) return versions
  return [...versions, { version: next, template, origin }].slice(-promptLimits.versions)
}
export function lineDiff(before: string, after: string): string {
  const oldLines = before.split('\n'), newLines = after.split('\n')
  const result: string[] = []
  for (let index = 0; index < Math.max(oldLines.length, newLines.length); index++) {
    if (oldLines[index] === newLines[index]) result.push(`  ${oldLines[index]}`)
    else {
      if (oldLines[index] !== undefined) result.push(`- ${oldLines[index]}`)
      if (newLines[index] !== undefined) result.push(`+ ${newLines[index]}`)
    }
  }
  return result.join('\n')
}
