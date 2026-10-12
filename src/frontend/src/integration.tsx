import { useEffect, useRef, useState, type FormEvent } from 'react'
import { containsSensitiveText } from './data'
import { readBoundedJson, ResponseSizeError } from './bounded-json'
import TaskDemo from './task-demo'
import FeedbackReceipt from './feedback-receipt'
import ServerFeedbackList from './server-feedback-list'
import { validServerFeedback, validServerFeedbackList } from './server-feedback-contract'
import DatabasePreflight from './database-preflight'
import AiPreflight from './ai-preflight'
import ConnectorPreflight from './connector-preflight'
import OperationLedger from './operation-ledger'
import ReviewEvidence from './review-evidence-panel'
import ApprovalPreflight from './approval-preflight'
import AuthorizationPreflight from './authorization-preflight'
import ExecutionPreflightPanel from './execution-preflight-panel'

const endpoints = ['dashboard', 'assets', 'database-providers', 'ai-providers', 'prompt-templates', 'feedback', 'connector-capabilities'] as const
type Endpoint = typeof endpoints[number]
type Result = {
  state: 'idle' | 'loading' | 'success' | 'error'
  status?: number
  body?: unknown
  error?: string
  checkedAt?: string
}
const idle: Result = { state: 'idle' }
class SafeIntegrationError extends Error {}
// Stable per-draft key: a retry of the same draft replays, an edited draft is a new submission.
function newDraftKey(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `feedback-${random}`
}
const timeoutMs = 10_000
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function contractError(body: unknown, endpoint: Endpoint, post: boolean, submitted?: unknown): string | undefined {
  if (!object(body) || body.isDemo !== true || body.persistence !== (endpoint === 'feedback' ? 'memory' : 'none')) {
    return 'Demo 信封不符合契约：应含 isDemo=true 与正确的 persistence；不使用本地替代数据。'
  }
  const data = body.data
  if (endpoint === 'dashboard') {
    if (!object(data) || !['assetCount', 'openAlerts', 'openTickets'].every(key => typeof data[key] === 'number')
      || typeof data.source !== 'string' || typeof data.observedAt !== 'string') return 'dashboard 数据字段不符合后端契约。'
  } else if (post) {
    if (!validServerFeedback(data) || !object(submitted) || data.category !== submitted.category || data.message !== submitted.message || data.page !== submitted.page) return 'feedback 提交结果不符合内存演示契约。'
  } else if (!Array.isArray(data)) return '目录/反馈 data 应为数组。'
  if (endpoint === 'feedback' && !post && !validServerFeedbackList(data)) return '反馈列表契约不符；不展示部分记录。'
  if (endpoint === 'connector-capabilities' && (!Array.isArray(data) || data.length !== 10
    || new Set(data.map(item => object(item) ? item.id : undefined)).size !== 10
    || !data.every(item => object(item) && typeof item.id === 'string' && typeof item.name === 'string'
      && item.status === 'planned' && item.implemented === false && item.liveVerified === false && item.writeEnabled === false
      && ['protocols', 'targetFamilies', 'candidateVendors', 'plannedReadCapabilities'].every(key => Array.isArray(item[key])
        && (item[key] as unknown[]).length > 0 && (item[key] as unknown[]).every(value => typeof value === 'string'))))) {
    return '连接器候选能力契约不符；目录不能声称已实现、已验证或可写。'
  }
  return undefined
}

async function request(endpoint: Endpoint, controller: AbortController, payload?: unknown): Promise<Result> {
  let timedOut = false
  let status: number | undefined
  let body: unknown
  const timer = window.setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  try {
    const response = await fetch(`/api/v1/${endpoint}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: payload === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
    })
    status = response.status
    if (!response.ok) {
      await response.body?.cancel()
      throw new SafeIntegrationError(`HTTP ${status}：后端请求失败；不显示原始错误正文，不 fallback。`)
    }
    try { body = await readBoundedJson(response, 262144) }
    catch (error) {
      if (error instanceof ResponseSizeError) throw new SafeIntegrationError('响应超过256KiB上限，拒绝展示。')
      throw error
    }
    if (containsSensitiveText(JSON.stringify(body))) throw new SafeIntegrationError('响应命中敏感信息辅助检查，拒绝展示；此检查不是DLP。')
    // Feedback POST may answer 200 when the idempotency key replays an already committed submission.
    const expectedStatus = payload === undefined ? 200 : 201
    if (status !== expectedStatus && !(endpoint === 'feedback' && status === 200)) throw new SafeIntegrationError(`HTTP ${status} 不符合预期 ${expectedStatus}。`)
    const error = contractError(body, endpoint, payload !== undefined, payload)
    if (error) throw new SafeIntegrationError(error)
    return { state: 'success', status, body, checkedAt: new Date().toLocaleTimeString() }
  } catch (error) {
    return {
      state: 'error', status, checkedAt: new Date().toLocaleTimeString(),
      error: timedOut ? '请求超时（10 秒），已中止；未使用替代数据。'
        : controller.signal.aborted ? '请求已取消；POST 取消不代表后端回滚，请刷新反馈确认。'
          : error instanceof SafeIntegrationError ? error.message : '网络或响应处理失败；未显示诊断正文，未使用替代数据。',
    }
  } finally { window.clearTimeout(timer) }
}

function ResponseView({ result }: { result: Result }) {
  const body = object(result.body) ? result.body : undefined
  return <div aria-live="polite" style={{ minWidth: 0 }}>
    <p>状态：{({ idle: '未检查', loading: '请求中…', success: '契约通过（仅 Demo）', error: '检查失败' })[result.state]}
      {' · '}HTTP：{result.status ?? '未取得响应'}{' · '}isDemo：{body && 'isDemo' in body ? String(body.isDemo) : '未返回'}
      {' · '}persistence：{body && 'persistence' in body ? String(body.persistence) : '未返回'}
      {result.checkedAt && ` · ${result.checkedAt}`}</p>
    {result.error && <p role="alert" style={{ color: '#b42318', overflowWrap: 'anywhere' }}>{result.error}</p>}
    {result.body !== undefined && <details><summary>查看实际后端响应（非实时设备数据）</summary>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto', background: '#f4f7fb', padding: 12 }}>
        {JSON.stringify(result.body, null, 2)}
      </pre>
    </details>}
  </div>
}

/** Explicit-click, same-origin Demo contract probe; safe to embed in any route. */
export default function IntegrationPanel() {
  const [results, setResults] = useState<Record<Endpoint, Result>>(() => Object.fromEntries(endpoints.map(key => [key, idle])) as Record<Endpoint, Result>)
  const [submission, setSubmission] = useState<Result>(idle)
  const [checking, setChecking] = useState(false)
  const [category, setCategory] = useState('suggestion')
  const [message, setMessage] = useState('演示反馈：验证后端内存反馈契约，不涉及真实设备。')
  const [confirmed, setConfirmed] = useState(false)
  const mounted = useRef(false)
  const draftKey = useRef(newDraftKey())
  const rotation = useRef<'created' | 'replayed' | ''>('')
  const reads = useRef<AbortController[]>([])
  const post = useRef<AbortController | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; reads.current.forEach(controller => controller.abort()); post.current?.abort() }
  }, [])

  async function check(selected: readonly Endpoint[]) {
    if (reads.current.length) return
    setChecking(true)
    const controllers = selected.map(() => new AbortController())
    reads.current = controllers
    setResults(previous => ({ ...previous, ...Object.fromEntries(selected.map(key => [key, { state: 'loading' }])) }))
    await Promise.all(selected.map(async (endpoint, index) => {
      const result = await request(endpoint, controllers[index])
      if (mounted.current) setResults(previous => ({ ...previous, [endpoint]: result }))
    }))
    reads.current = []
    if (mounted.current) setChecking(false)
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (post.current || submission.state === 'success' || !confirmed || !message.trim()) return
    if (containsSensitiveText(message)) {
      setSubmission({ state: 'error', error: '检测到疑似敏感内容，已阻止发送。请改用虚构演示文本；辅助检查不能保证无秘密。' })
      return
    }
    const controller = new AbortController()
    post.current = controller
    setSubmission({ state: 'loading' })
    const result = await request('feedback', controller, { category, message: message.trim(), page: '/integration', idempotencyKey: draftKey.current })
    post.current = null
    if (mounted.current) {
      if (result.state === 'success' && result.status === 200) {
        // Replay of the same draft: the server kept the original record instead of creating another.
        rotation.current = 'replayed'
      } else if (result.state === 'success') {
        rotation.current = 'created'
        draftKey.current = newDraftKey()
      }
      setSubmission(result)
    }
  }
  const receipt = submission.state === 'success' && object(submission.body) && object(submission.body.data) ? submission.body.data : undefined
  function rotateDraft() { draftKey.current = newDraftKey(); rotation.current = '' }
  const card = { padding: 16, border: '1px solid #dce3ec', borderRadius: 10, background: '#fff', minWidth: 0 }
  return <section aria-label="后端Demo契约验证" style={{ display: 'grid', gap: 16 }}>
    <header style={card}>
      <h2>后端Demo契约验证</h2>
      <p>点击才请求同源 /api/v1。响应来自后端 HTTP，但数据为 synthetic-fixture 演示样本，不代表真实设备、数据库或 AI 已连接。</p>
      <p>仅 Development Demo 可用；503 表示业务 API 未开放。服务器反馈与前端本机模拟独立；后端反馈仅进程内存保存，重启丢失、最多保留 200 条。失败保持错误，不回退到本地 mock。</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <button className="button primary" type="button" disabled={checking} onClick={() => void check(endpoints)}>检查后端 Demo</button>
        <button className="button" type="button" disabled={checking || submission.state === 'loading'} onClick={() => void check(['feedback'])}>刷新内存反馈</button>
        <button className="button" type="button" disabled={!checking} onClick={() => reads.current.forEach(controller => controller.abort())}>取消检查</button>
      </div>
    </header>
    {endpoints.map(endpoint => <article key={endpoint} style={card}>
      <h3>GET /api/v1/{endpoint}</h3><ResponseView result={results[endpoint]} />
      {endpoint === 'feedback' && results.feedback.state === 'success' && object(results.feedback.body) && validServerFeedbackList(results.feedback.body.data) && <ServerFeedbackList items={results.feedback.body.data} />}
    </article>)}
    <form className="form" onSubmit={event => void submit(event)} style={{ ...card, display: 'grid', gap: 12 }}>
      <h3>提交后端演示反馈 · POST /api/v1/feedback</h3>
      <p>仅输入虚构演示内容；禁止密码、令牌、个人信息及真实业务数据。page 固定为 /integration。提交成功后请点击“刷新内存反馈”核对；同一成功草稿不可再次点击提交，修改后需重新确认。失败或取消不代表未保存，请先刷新核对，勿盲目重复提交。</p>
      <label>类别 <select value={category} onChange={event => { setCategory(event.target.value); setConfirmed(false); setSubmission(idle); rotateDraft() }} disabled={submission.state === 'loading'}>
        <option value="bug">bug · 问题</option><option value="suggestion">suggestion · 建议</option><option value="question">question · 咨询</option>
      </select></label>
      <label>演示消息（1–2000 字符）<textarea required maxLength={2000} rows={3} value={message} onChange={event => { setMessage(event.target.value); setConfirmed(false); setSubmission(idle); rotateDraft() }} disabled={submission.state === 'loading'} /></label>
      <label><input type="checkbox" style={{ width: 'auto', marginRight: 8 }} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我确认仅含虚构演示内容，无秘密或个人信息</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button className="button primary" type="submit" disabled={!confirmed || !message.trim() || submission.state === 'loading' || submission.state === 'success'}>提交演示反馈到后端</button>
        <button className="button" type="button" disabled={submission.state !== 'loading'} onClick={() => post.current?.abort()}>取消提交等待</button>
      </div>
      {receipt && rotation.current && <p role="status">{rotation.current === 'replayed' ? '服务器已存在该草稿的记录，本次未重复创建；下方回执为原记录。' : '服务器新建了该反馈记录。'}</p>}
      {receipt && <FeedbackReceipt key={String(receipt.id)} receipt={receipt} />}
      <ResponseView result={submission} />
    </form>
    <AiPreflight />
    <DatabasePreflight />
    <ConnectorPreflight />
    <OperationLedger />
    <ReviewEvidence />
    <ApprovalPreflight />
    <AuthorizationPreflight />
    <ExecutionPreflightPanel />
    <TaskDemo />
  </section>
}
