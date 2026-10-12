// Local only. This adds one clearly synthetic in-memory feedback item in Demo mode.
// Usage: node scripts/backend-contract.mjs [http://localhost:5094]
// Default exercises Vite's same-origin proxy; BACKEND_CONTRACT_URL overrides it.
import assert from 'node:assert/strict'

const base = new URL(process.argv[2] ?? process.env.BACKEND_CONTRACT_URL ?? 'http://127.0.0.1:5173')
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Only loopback backend targets are allowed')
assert.equal(base.protocol, 'http:', 'Use the local HTTP development backend')
assert(!base.username && !base.password && base.pathname === '/' && !base.search && !base.hash, 'Pass only a local origin, without credentials/path/query')
const origin = base.origin
let checks = 0
async function get(path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json', ...options.headers },
  })
  assert.match(response.headers.get('content-type') ?? '', /json/, `${path}: JSON required`)
  const body = await response.json()
  return { response, body }
}
function passed(message) { checks++; console.log(`PASS ${message}`) }
function demo(body, persistence) {
  assert.equal(body.isDemo, true)
  assert.equal(body.persistence, persistence)
  assert('data' in body)
}
function problem(result, status, isDemo) {
  assert.equal(result.response.status, status)
  assert.equal(result.body.status, status)
  assert.equal(result.body.isDemo, isDemo)
  assert.equal(typeof result.body.title, 'string')
}
function feedbackOptions(payload, requestOrigin = origin) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin }, body: JSON.stringify(payload) }
}
async function main() {
  const live = await get('/health/live')
  assert.equal(live.response.status, 200)
  assert.equal(live.body.status, 'alive')
  assert.equal(typeof live.body.isDemo, 'boolean')
  passed('health/live 200 liveness only')
  const ready = await get('/health/ready')
  assert.equal(ready.response.status, 503)
  assert.equal(ready.body.status, 'notReady')
  assert.equal(ready.body.database.verified, false)
  assert.equal(ready.body.authentication, 'notImplemented')
  assert.equal(ready.body.isDemo, live.body.isDemo)
  assert.equal(ready.body.demoApiAvailable, live.body.isDemo)
  passed('health/ready 503 readiness envelope; no production readiness claim')

  const endpoints = ['dashboard', 'assets', 'database-providers', 'ai-providers', 'prompt-templates', 'feedback']
  for (const endpoint of endpoints) {
    const result = await get(`/api/v1/${endpoint}`, { headers: { Origin: origin } })
    assert.equal(result.response.headers.get('cache-control'), 'no-store')
    if (!live.body.isDemo) {
      problem(result, 503, false)
      passed(`${endpoint} disabled 503 ProblemDetails`)
      continue
    }
    assert.equal(result.response.status, 200)
    demo(result.body, endpoint === 'feedback' ? 'memory' : 'none')
    const data = result.body.data
    if (endpoint === 'dashboard') {
      for (const key of ['assetCount', 'openAlerts', 'openTickets']) assert.equal(typeof data[key], 'number')
      assert.equal(data.source, 'synthetic-fixture')
      assert(Number.isFinite(Date.parse(data.observedAt)))
    } else {
      assert(Array.isArray(data))
      for (const item of data) {
        assert.equal(typeof item.id, 'string')
        if (endpoint === 'assets') {
          for (const key of ['name', 'kind', 'operatingSystem', 'status', 'site']) assert.equal(typeof item[key], 'string')
          assert.equal(item.source, 'synthetic-fixture')
          assert(Number.isFinite(Date.parse(item.observedAt)))
        } else if (endpoint.endsWith('-providers')) {
          assert.equal(item.planned, true)
          for (const key of ['implemented', 'verified', 'outboundEnabled']) assert.equal(item[key], false)
          assert.equal(typeof item.packageAvailable, 'boolean')
          assert.equal(typeof item.notes, 'string')
        } else if (endpoint === 'prompt-templates') {
          assert.equal(item.editable, false)
          assert.equal(typeof item.content, 'string')
          assert.equal(typeof item.version, 'number')
          assert(Array.isArray(item.variables))
        } else {
          assert.equal(item.isDemo, true)
          assert.equal(item.isPersistent, false)
        }
      }
    }
    passed(`${endpoint} 200 Demo envelope + data fields`)
  }
  const sample = { category: 'suggestion', message: '演示契约脚本反馈：仅验证本地内存，无真实设备或个人数据。', page: '/integration' }
  if (!live.body.isDemo) {
    const result = await get('/api/v1/feedback', feedbackOptions(sample))
    problem(result, 503, false)
    passed('feedback POST disabled 503')
    console.log('SKIP Demo-only 400/201/403: backend is not in Demo mode; no mode changes attempted.')
    return
  }
  const invalid = await get('/api/v1/feedback', feedbackOptions({ category: 'invalid', message: ' ', page: '//invalid' }))
  problem(invalid, 400, true)
  for (const key of ['category', 'message', 'page']) assert(Array.isArray(invalid.body.errors[key]))
  passed('invalid feedback 400 ValidationProblem fields')
  const foreign = await get('/api/v1/feedback', feedbackOptions(sample, 'http://127.0.0.1:59999'))
  problem(foreign, 403, true)
  passed('foreign Origin feedback 403 (header only; no external request)')
  const valid = await get('/api/v1/feedback', feedbackOptions(sample))
  assert.equal(valid.response.status, 201)
  demo(valid.body, 'memory')
  for (const [key, value] of Object.entries(sample)) assert.equal(valid.body.data[key], value)
  assert.equal(valid.body.data.isDemo, true)
  assert.equal(valid.body.data.isPersistent, false)
  assert.equal(typeof valid.body.data.id, 'string')
  assert(Number.isFinite(Date.parse(valid.body.data.createdAt)))
  passed('valid synthetic feedback 201 memory only')
  const refreshed = await get('/api/v1/feedback')
  assert.equal(refreshed.response.status, 200)
  demo(refreshed.body, 'memory')
  assert(refreshed.body.data.some(item => item.id === valid.body.data.id))
  passed('refresh memory feedback contains created demo item')
}
try {
  await main()
  console.log(`Completed ${checks} local contract checks; no external network, database, device or AI verification.`)
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
