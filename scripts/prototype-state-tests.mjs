// Node 24+: node --experimental-strip-types scripts/prototype-state-tests.mjs
// In-memory storage only. This test never reads the browser's real localStorage.
import assert from 'node:assert/strict'
import { initialStore, loadStore, sanitizeStore, serializeStore, storageKey, storeLimits } from '../src/frontend/src/data.ts'

let raw = null
let reads = 0
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem(key) { assert.equal(key, storageKey); reads++; return raw },
  setItem(key, value) { assert.equal(key, storageKey); raw = String(value) },
} })
let passed = 0
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`) }
function load(value) { localStorage.setItem(storageKey, JSON.stringify(value)); return loadStore() }
const defaults = initialStore()

test('initial and valid edited state round-trip', () => {
  assert.deepEqual(load(defaults), defaults)
  const state = initialStore()
  state.alerts[0].state = '已确认'
  state.tickets.unshift({ id: 'WO-2', title: '模拟工单', priority: 'P1', state: '待处理' })
  state.feedback.push({ id: 'FB-1', department: 'IT 部门', module: '验收反馈', text: '模拟建议', priority: '一般', state: '待评审', createdAt: '2026-10-10T01:00:00.000Z' })
  state.prompts['告警研判'].push({ version: 2, content: '仅分析模拟样本', at: '2026/10/10 09:00:00' })
  state.database = 'SQLite（仅评估）'
  assert.deepEqual(load(state), state)
  assert.deepEqual(JSON.parse(serializeStore(state)), state)
})
test('broken JSON and non-object roots fall back', () => {
  for (const value of ['', '{', 'null', '42', '[]', '"abc"']) { raw = value; assert.deepEqual(loadStore(), defaults) }
})
test('wrong collection and item types never reach consumers', () => {
  for (const key of ['alerts', 'tickets', 'feedback']) {
    for (const value of [null, {}, 'abc', [null], [3], [[]], [{ state: '待处理' }]]) {
      assert.deepEqual(load({ ...defaults, [key]: value })[key], defaults[key])
    }
  }
  assert.deepEqual(load({ ...defaults, tickets: [{ ...defaults.tickets[0], alertId: {} }] }).tickets, defaults.tickets)
  assert.deepEqual(load({ ...defaults, tickets: [{ ...defaults.tickets[0], title: 10 }] }).tickets, defaults.tickets)
})
test('unknown keys are projected out and empty prompt lists recover', () => {
  const state = initialStore()
  state.extra = { nested: 'not persisted' }
  state.tickets[0].extra = 'not persisted'
  state.ai.extra = 'not persisted'
  state.prompts.unknown = [{ version: 1, content: 'ignored', at: 'demo' }]
  state.prompts['告警研判'] = []
  assert.deepEqual(load(state), defaults)
  for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, '1', null]) {
    state.prompts['告警研判'] = [{ version, content: '模拟', at: '示例' }]
    assert.deepEqual(load(state).prompts, defaults.prompts)
  }
})
test('collections and prompt history are capped in chronological direction', () => {
  const state = initialStore()
  state.tickets = Array.from({ length: 150 }, (_, i) => ({ ...defaults.tickets[0], id: `WO-${i}` }))
  state.feedback = Array.from({ length: 150 }, (_, i) => ({ id: `FB-${i}`, department: 'IT 部门', module: '验收反馈', text: '模拟', priority: '一般', state: '待评审', createdAt: '示例' }))
  state.prompts['告警研判'] = Array.from({ length: 50 }, (_, i) => ({ version: i + 1, content: '模拟', at: '示例' }))
  const result = load(state)
  assert.equal(result.tickets.length, storeLimits.tickets)
  assert.equal(result.feedback.length, storeLimits.feedback)
  assert.equal(result.tickets[0].id, 'WO-0')
  assert.equal(result.prompts['告警研判'].length, storeLimits.promptVersions)
  assert.equal(result.prompts['告警研判'].at(-1).version, 50)
  assert.deepEqual(sanitizeStore(result), result)
})
test('huge raw input and overlong strings recover without persistence growth', () => {
  raw = ' '.repeat(storeLimits.rawCharacters + 1)
  assert.deepEqual(loadStore(), defaults)
  const state = initialStore()
  state.tickets[0].title = 'x'.repeat(121)
  state.prompts['告警研判'][0].content = 'x'.repeat(4001)
  assert.deepEqual(load(state), defaults)
})
test('sensitive text heuristic checks decoded strings, not JSON escapes', () => {
  raw = JSON.stringify({ ...defaults, tickets: [{ ...defaults.tickets[0], title: 'password=DEMO_ONLY_NOT_A_SECRET' }] }).replace('password', '\\u0070assword')
  assert.deepEqual(loadStore().tickets, defaults.tickets)
})
test('AI config accepts only bounded reserved demo endpoints and enumerations', () => {
  for (const endpoint of ['https://ai.example.invalid/v1', 'https://demo.invalid/v2']) {
    const state = initialStore(); state.ai.endpoint = endpoint
    assert.equal(load(state).ai.endpoint, endpoint)
  }
  for (const endpoint of ['http://demo.invalid/v1', 'https://example.com/v1', 'https://demo.invalid.example.com', 'https://user:demo@demo.invalid', 'https://demo.invalid?key=demo', 'https://demo.invalid/#demo', 'https://.invalid', 'not a URL']) {
    const state = initialStore(); state.ai.endpoint = endpoint
    assert.deepEqual(load(state).ai, defaults.ai)
  }
  for (const patch of [{ provider: 'unknown' }, { model: 'production-model' }, { capabilities: [null] }, { capabilities: '文本生成' }, { secretRef: {} }]) {
    assert.deepEqual(load({ ...defaults, ai: { ...defaults.ai, ...patch } }).ai, defaults.ai)
  }
  const state = initialStore(); state.ai.secretRef = 'secret://other/reference'
  assert.equal(load(state).ai.secretRef, defaults.ai.secretRef)
})
test('duplicate IDs, invalid enums, and malformed prompt items recover', () => {
  const state = initialStore()
  state.tickets.push({ ...state.tickets[0] })
  assert.deepEqual(load(state).tickets, defaults.tickets)
  for (const patch of [{ priority: 'P0' }, { state: 'unknown' }, { id: '' }, { title: '   ' }]) {
    assert.deepEqual(load({ ...defaults, tickets: [{ ...defaults.tickets[0], ...patch }] }).tickets, defaults.tickets)
  }
  for (const versions of [[null], [false], [{ version: 1, content: '', at: 'demo' }], [{ version: 2, content: 'demo', at: 'demo' }, { version: 2, content: 'demo', at: 'demo' }]]) {
    assert.deepEqual(load({ ...defaults, prompts: { ...defaults.prompts, '告警研判': versions } }).prompts, defaults.prompts)
  }
  const unrelated = initialStore(); unrelated.database = 'MySQL（候选）'; unrelated.ai.endpoint = 'bad URL'
  assert.equal(load(unrelated).database, unrelated.database)
})
test('all UI feedback modules and maximum bounded payload round-trip', () => {
  const modules = ['工作台','资产','告警','工单','AD 目录','共享权限','打印管理','虚拟化','备份巡检','知识库 / AI 助手','后端联调','设备接入','系统数据库','AI 配置','提示词管理','验收反馈']
  const state = initialStore()
  state.feedback = Array.from({ length: storeLimits.feedback }, (_, i) => ({ id: `FB-${i}`, department: 'IT 部门', module: modules[i % modules.length], text: '模拟'.repeat(1000), priority: '一般', state: '待评审', createdAt: '示例' }))
  state.tickets = Array.from({ length: storeLimits.tickets }, (_, i) => ({ id: `WO-${i}`, title: '模拟'.repeat(60), priority: 'P1', state: '待处理' }))
  state.alerts = Array.from({ length: storeLimits.alerts }, (_, i) => ({ ...defaults.alerts[0], id: `ALT-${i}`, title: '模拟'.repeat(60) }))
  for (const name of Object.keys(state.prompts)) state.prompts[name] = Array.from({ length: storeLimits.promptVersions }, (_, i) => ({ version: i + 1, content: '模拟'.repeat(2000), at: '示例' }))
  const serialized = serializeStore(state)
  assert.ok(serialized.length < storeLimits.rawCharacters)
  assert.deepEqual(JSON.parse(serialized), state)
  assert.deepEqual(load(state), state)
})
test('storage access failure returns fresh defaults', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage unavailable') } })
  const result = loadStore(); assert.deepEqual(result, defaults)
  result.alerts[0].state = '处理中'
  assert.deepEqual(loadStore(), defaults)
})
console.log(`${passed} state tests passed; ${reads} in-memory storage reads; no real localStorage access`)
