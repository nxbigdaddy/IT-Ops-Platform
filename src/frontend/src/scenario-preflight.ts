// Shared validation for server-evaluated scenario catalogs (approval binding, role/site authorization).
// Panels stay responsible for their own wording; every fact here comes from a server response.
import {readBoundedJson} from './bounded-json'
export type ScenarioRule = { name: string; passed: boolean }
export type Scenario = { id: string; label: string; description: string; valid: boolean; code: string; rules: ScenarioRule[] }
export type ScenarioParser = (value: unknown) => Scenario[] | null
export function makeScenarioParser(options: {
  codes: Record<string, string>
  ruleNames: string[]
  validField?: 'valid' | 'allowed' | 'eligible'
  itemsField?: 'rules' | 'stages'
  extra?: (raw: Record<string, unknown>) => boolean
}): ScenarioParser {
  const field = options.validField ?? 'valid'
  const items = options.itemsField ?? 'rules'
  return value => {
    if (!Array.isArray(value) || value.length < 1 || value.length > 32) return null
    const parsed = value.map(entry => {
      const raw = entry as Record<string, unknown>
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      const { id, label, description, code } = raw as { id?: unknown; label?: unknown; description?: unknown; code?: unknown }
      if (typeof id !== 'string' || !id || id.length > 32) return null
      if (typeof label !== 'string' || !label || label.length > 64) return null
      if (typeof description !== 'string' || !description || description.length > 200) return null
      if (typeof code !== 'string' || !Object.hasOwn(options.codes, code)) return null
      if (raw.executionEnabled !== false || raw.productionEnabled !== false) return null
      if (options.extra && !options.extra(raw)) return null
      const valid = raw[field]
      if (typeof valid !== 'boolean') return null
      const rawItems = raw[items]
      if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 8) return null
      const rules = rawItems as ScenarioRule[]
      if (!rules.every(rule => rule && typeof rule.name === 'string' && options.ruleNames.includes(rule.name) && typeof rule.passed === 'boolean')) return null
      const failed = rules.filter(rule => !rule.passed).length
      if (valid ? failed !== 0 : failed < 1) return null
      if ((code === 'allowed' || code === 'valid_snapshot_only') !== valid) return null
      return { id, label, description, valid, code, rules: rules.map(rule => ({ name: rule.name, passed: rule.passed })) }
    })
    if (parsed.some(item => item === null)) return null
    const list = parsed as Scenario[]
    return new Set(list.map(item => item.id)).size === list.length ? list : null
  }
}
type Envelope = { isDemo?: unknown; persistence?: unknown; data?: unknown; status: number }
async function request(url: string, signal: AbortSignal, parse: ScenarioParser, init?: RequestInit, single = false): Promise<{ scenarios: Scenario[] | null; envelope: Envelope }> {
  const response = await fetch(url, { signal, redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' }, ...init })
  const allowed = response.status === 200 || response.status === 400
  if (!allowed) { await response.body?.cancel(); throw new Error() }
  const payload = await readBoundedJson(response, 65536) as { isDemo?: unknown; persistence?: unknown; data?: unknown }
  const envelope: Envelope = { isDemo: payload.isDemo, persistence: payload.persistence, data: payload.data, status: response.status }
  const ok = payload.isDemo === true && payload.persistence === 'none'
  // A single-scenario response must never be accepted when an array (or null) is expected.
  const shape = single ? (payload.data === null ? null : [payload.data]) : payload.data
  return { scenarios: ok ? parse(shape) : null, envelope }
}
export async function loadScenarios(url: string, signal: AbortSignal, parse: ScenarioParser): Promise<Scenario[]> {
  const { scenarios } = await request(url, signal, parse)
  if (!scenarios) throw new Error()
  return scenarios
}
export async function runScenario(url: string, id: string, signal: AbortSignal, parse: ScenarioParser): Promise<Scenario> {
  const { scenarios, envelope } = await request(url, signal, parse, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ scenario: id }),
  }, true)
  const scenario = scenarios?.[0] ?? null
  if (envelope.status !== 200 || !scenario || scenario.id !== id) throw new Error()
  return scenario
}
