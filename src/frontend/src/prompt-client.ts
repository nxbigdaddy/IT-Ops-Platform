import { containsSensitiveText } from './data'
import { readBoundedJson } from './bounded-json'

export const serverPromptIds = ['alert-explanation', 'ticket-summary', 'inspection-report'] as const
export type ServerPromptId = typeof serverPromptIds[number]
export type ServerPromptVersion = { version: number; content: string; createdAt: string; sourceVersion: number | null; status: 'draft' }
export type ServerPromptPublished = { version: number; content: string; publishedFrom: number; publishedAt: string; status: 'published'; approvalReference?: string | null; approvedBy?: string | null }
export type ServerPrompt = {
  id: ServerPromptId; feature: string; name: string; currentVersion: number; content: string
  variables: string[]
  schema: { name: string; type: 'string'; description: string; example: string; required: boolean }[]
  versions: ServerPromptVersion[]; maxVersions: 20; maxContentLength: 4000
  status: 'draft'; modelExecutionEnabled: false; notes: string
  published: ServerPromptPublished[]; publishedVersion: number
}
const specifications = {
  'alert-explanation': { feature: 'alerts', variables: ['asset_name', 'alert_summary', 'severity'], required: ['asset_name', 'alert_summary'] },
  'ticket-summary': { feature: 'tickets', variables: ['ticket_id', 'ticket_details', 'asset_name'], required: ['ticket_id', 'ticket_details'] },
  'inspection-report': { feature: 'inspection', variables: ['asset_name', 'inspection_result', 'inspection_date'], required: ['asset_name', 'inspection_result'] },
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const safeText = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max && !containsSensitiveText(value)
const versionNumber = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 20
export function isServerPrompt(value: unknown): value is ServerPrompt {
  if (!record(value) || !serverPromptIds.includes(value.id as ServerPromptId)) return false
  const spec = specifications[value.id as ServerPromptId]
  if (value.feature !== spec.feature || !safeText(value.name, 100) || !safeText(value.notes, 1000)
    || value.status !== 'draft' || value.modelExecutionEnabled !== false || value.maxVersions !== 20
    || value.maxContentLength !== 4000 || !versionNumber(value.currentVersion) || !safeText(value.content, 4000)) return false
  if (!Array.isArray(value.variables) || value.variables.length !== spec.variables.length
    || !spec.variables.every((name, i) => value.variables instanceof Array && value.variables[i] === name)) return false
  if (!Array.isArray(value.schema) || value.schema.length !== spec.variables.length
    || !value.schema.every((field, i) => record(field) && field.name === spec.variables[i] && field.type === 'string'
      && field.required === spec.required.includes(spec.variables[i]) && safeText(field.description, 200) && safeText(field.example, 500))) return false
  if (!Array.isArray(value.versions) || value.versions.length !== value.currentVersion
    || !value.versions.every((item, i) => record(item) && item.version === Number(value.currentVersion) - i
      && safeText(item.content, 4000) && item.status === 'draft' && typeof item.createdAt === 'string'
      && item.createdAt.length <= 50 && Number.isFinite(Date.parse(item.createdAt))
      && (item.sourceVersion === null || (versionNumber(item.sourceVersion) && item.sourceVersion < Number(item.version))))) return false
  const versions = value.versions as { version: number; content: string; sourceVersion: number | null }[]
  const published = value.published
  if (!Array.isArray(published) || published.length > 20 || value.publishedVersion !== published.length) return false
  if (!published.every((item, i) => record(item) && item.version === published.length - i && item.status === 'published'
    && safeText(item.content, 4000) && versionNumber(item.publishedFrom) && Number(item.publishedFrom) <= Number(value.currentVersion)
    && typeof item.publishedAt === 'string' && item.publishedAt.length <= 50 && Number.isFinite(Date.parse(item.publishedAt))
    && (i === 0 || Number((published[i - 1] as { publishedFrom: number }).publishedFrom) > Number(item.publishedFrom))
    // A published revision must be a verbatim copy of the draft version it names.
    && versions.some(version => version.version === Number(item.publishedFrom) && version.content === item.content))) return false
  return value.versions[0].content === value.content
}
export class PromptClientError extends Error {
  constructor(public readonly http: number | null, public readonly code: string) {
    super(code)
    this.name = 'PromptClientError'
  }
}
export type PromptReply<T> = { data: T; http: number }
export async function requestPrompts(
  id: ServerPromptId | null, action: 'list' | 'detail' | 'versions' | 'restore' | 'publish',
  signal: AbortSignal, body?: { content: string; expectedVersion: number } | { sourceVersion: number; expectedVersion: number } | { expectedVersion: number },
): Promise<PromptReply<ServerPrompt | ServerPrompt[]>> {
  if ((action !== 'list' && !serverPromptIds.includes(id as ServerPromptId)) || (action === 'list' && id !== null)) {
    throw new PromptClientError(null, 'invalid_request')
  }
  const mutation = action === 'versions' || action === 'restore' || action === 'publish'
  const path = action === 'list' ? '/api/v1/prompts' : `/api/v1/prompts/${id}${mutation ? `/${action}` : ''}`
  let response: Response
  try {
    response = await fetch(path, {
      method: mutation ? 'POST' : 'GET', signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: mutation ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      ...(mutation ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new PromptClientError(null, signal.aborted ? 'cancelled' : 'network_error')
  }
  let payload: unknown
  try { payload = await readBoundedJson(response) } catch { throw new PromptClientError(response.status, signal.aborted ? 'cancelled' : 'invalid_response') }
  if (!response.ok) {
    const code = record(payload) && payload.isDemo === true && payload.persistence === 'memory'
      && ['version_conflict', 'version_limit_reached', 'validation_failed', 'prompt_not_found', 'source_version_not_found', 'already_published'].includes(String(payload.code))
      ? String(payload.code) : 'http_error'
    throw new PromptClientError(response.status, code)
  }
  if (response.status !== (mutation ? 201 : 200) || !record(payload) || payload.isDemo !== true || payload.persistence !== 'memory') {
    throw new PromptClientError(response.status, 'invalid_response')
  }
  const data = payload.data
  if (action === 'list') {
    if (!Array.isArray(data) || data.length !== 3 || !data.every(isServerPrompt)
      || !serverPromptIds.every(key => data.filter(item => item.id === key).length === 1)) throw new PromptClientError(response.status, 'invalid_response')
  } else if (!isServerPrompt(data) || data.id !== id) throw new PromptClientError(response.status, 'invalid_response')
  return { data: data as ServerPrompt | ServerPrompt[], http: response.status }
}
