// Bundled Node 24: node --experimental-strip-types scripts/prototype-feedback-tests.mjs
// Pure synthetic fixtures only; no filesystem/browser/user storage reads.
import assert from 'node:assert/strict'
import { exportFeedbackJson, feedbackImportMaxBytes, mergeFeedbackImport, previewFeedbackImport } from '../src/frontend/src/feedback-transfer.ts'
import { initialStore, sanitizeStore } from '../src/frontend/src/data.ts'
const at = '2026-10-10T01:00:00.000Z'
const row = (id = 'FB-demo', extra = {}) => ({ id, department: 'IT 部门', module: '验收反馈', text: '仅模拟反馈', priority: '一般', state: '待评审', createdAt: at, ...extra })
const pack = feedback => JSON.stringify({ schemaVersion: 1, mode: 'mock', exportedAt: at, feedback })
let passed = 0
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`) }
test('existing JSON export roundtrips and preview does not mutate', () => {
  const existing = Object.freeze([Object.freeze(row('FB-local'))])
  const raw = exportFeedbackJson([row()], at)
  const p = previewFeedbackImport(raw, existing)
  assert.deepEqual([p.total, p.added, p.duplicate, p.invalid, p.canMerge], [1, 1, 0, 0, true])
  assert.equal(existing.length, 1)
  assert.deepEqual(mergeFeedbackImport(raw, existing), [row('FB-local'), row()])
})
test('buildId in the envelope is optional, validated and never silently tolerated when malformed', () => {
  const withBuild = JSON.stringify({ ...JSON.parse(pack([row()])), buildId: 'b07b647' })
  const preview = previewFeedbackImport(withBuild, [])
  assert.deepEqual(preview.errors, []); assert.equal(preview.added, 1)
  // Legacy four-key packages keep importing unchanged.
  assert.equal(previewFeedbackImport(pack([row()]), []).added, 1)
  for (const bad of ['', 'x'.repeat(41), 'bad/id', 'bad\\id', 'bad id!']) {
    const raw = JSON.stringify({ ...JSON.parse(pack([row()])), buildId: bad })
    assert.ok(previewFeedbackImport(raw, []).errors.length, `buildId ${JSON.stringify(bad)} must be rejected`)
  }
  for (const bad of [42, null, { value: 'x' }]) {
    const raw = JSON.stringify({ ...JSON.parse(pack([row()])), buildId: bad })
    assert.ok(previewFeedbackImport(raw, []).errors.length)
  }
})
test('bad JSON/root/envelope rejected with no mutation', () => {
  for (const raw of ['{', 'null', '[]', '42', JSON.stringify({ schemaVersion: 1, mode: 'mock', feedback: [] }), ...[{ schemaVersion: 2 }, { mode: 'production' }, { exportedAt: 'invalid' }, { extra: true }, { feedback: null }].map(patch => JSON.stringify({ ...JSON.parse(pack([])), ...patch }))]) {
    assert.ok(previewFeedbackImport(raw, []).errors.length)
    assert.throws(() => mergeFeedbackImport(raw, [row()]))
  }
})
test('field whitelist rejects extras, missing fields and prototype keys', () => {
  for (const key of Object.keys(row())) {
    const missing = row(); delete missing[key]
    assert.equal(previewFeedbackImport(pack([missing]), []).invalid, 1)
  }
  for (const bad of [{ ...row(), extra: true }, JSON.parse(JSON.stringify(row()).replace('"id":', '"__proto__":{"polluted":true},"id":'))]) {
    const p = previewFeedbackImport(pack([bad]), [])
    assert.equal(p.invalid, 1); assert.equal(p.canMerge, false)
  }
  assert.equal({}.polluted, undefined)
})
test('wrong types, enums, IDs, length and empty text rejected', () => {
  for (const patch of [{ id: 'bad' }, { id: 'FB-' }, { id: `FB-${'a'.repeat(62)}` }, { department: '未知' }, { module: '未知' }, { state: '已关闭' }, { priority: 'P1' }, { text: '' }, { text: '   ' }, { text: 'x'.repeat(2001) }, { text: {} }, { createdAt: '2026-02-30T00:00:00.000Z' }, { createdAt: '昨天' }, { createdAt: null }]) {
    assert.equal(previewFeedbackImport(pack([row('FB-x', patch)]), []).invalid, 1, JSON.stringify(patch))
  }
  for (const bad of [null, 1, [], 'text']) assert.equal(previewFeedbackImport(pack([bad]), []).invalid, 1)
})
test('sensitive decoded content rejected without echoing it', () => {
  const raw = pack([row('FB-a', { text: 'password=synthetic-placeholder' })]).replace('password', '\\u0070assword')
  const p = previewFeedbackImport(raw, [])
  assert.equal(p.invalid, 1); assert.ok(!JSON.stringify(p).includes('synthetic-placeholder'))
})
test('mixed valid and invalid batches cannot partially merge', () => {
  const raw = pack([row(), row('FB-invalid', { unwanted: true })])
  const p = previewFeedbackImport(raw, [])
  assert.deepEqual([p.added, p.invalid, p.canMerge], [1, 1, false])
  assert.throws(() => mergeFeedbackImport(raw, [row('FB-existing')]))
})
test('duplicates by ID retain existing content and workflow state', () => {
  const old = row('FB-x', { state: '已验收', text: '本地模拟结论' })
  const raw = pack([row('FB-x'), row('FB-new'), row('FB-new', { state: '开发中' })])
  const p = previewFeedbackImport(raw, [old])
  assert.deepEqual([p.added, p.duplicate, p.invalid], [1, 2, 0])
  assert.deepEqual(mergeFeedbackImport(raw, [old]), [old, row('FB-new')])
})
test('latest store at confirmation wins over stale preview', () => {
  const raw = pack([row()])
  assert.equal(previewFeedbackImport(raw, []).added, 1)
  const current = row('FB-demo', { state: '开发中' })
  assert.deepEqual(mergeFeedbackImport(raw, [current]), [current])
})
test('newest 100 retained with previewed trimming and stable ties', () => {
  const incoming = Array.from({ length: 105 }, (_, i) => row(`FB-${i}`, { createdAt: new Date(Date.parse(at) + i * 1000).toISOString() }))
  const p = previewFeedbackImport(pack(incoming), [])
  assert.equal(p.dropped, 5); assert.equal(p.retained, 100)
  const merged = mergeFeedbackImport(pack(incoming), [])
  assert.equal(merged.length, 100); assert.equal(merged[0].id, 'FB-104'); assert.equal(merged.at(-1).id, 'FB-5')
  const existing = Array.from({ length: 100 }, (_, i) => row(`FB-local-${i}`))
  assert.deepEqual(mergeFeedbackImport(pack([row()]), existing), existing)
})
test('byte boundary uses UTF-8 not JavaScript string length', () => {
  const raw = pack([row()])
  const exact = raw + ' '.repeat(feedbackImportMaxBytes - new TextEncoder().encode(raw).byteLength)
  assert.equal(previewFeedbackImport(exact, []).canMerge, true)
  assert.equal(previewFeedbackImport(exact + ' ', []).canMerge, false)
  const multibyte = pack([row('FB-long', { text: '中'.repeat(90000) })])
  assert.ok(multibyte.length < feedbackImportMaxBytes)
  assert.match(previewFeedbackImport(multibyte, []).errors[0], /256 KB/)
})
test('empty and all duplicate imports are safe no-ops', () => {
  assert.equal(previewFeedbackImport(pack([]), []).canMerge, false)
  assert.equal(previewFeedbackImport(pack([row()]), [row()]).canMerge, false)
  assert.deepEqual(mergeFeedbackImport(pack([]), [row()]), [row()])
})
test('accepted values survive sanitizeStore unchanged including governance module', () => {
  const rows = [row(), row('FB-governance', { module: '提示词治理' }), row('WO-legacy'), row('ALT-legacy')]
  const merged = mergeFeedbackImport(pack(rows), [])
  assert.deepEqual(sanitizeStore({ ...initialStore(), feedback: merged }).feedback, merged)
})
test('error list is bounded and does not echo payloads', () => {
  const p = previewFeedbackImport(pack(Array(20).fill({})), [])
  assert.equal(p.invalid, 20); assert.equal(p.errors.length, 8)
})
console.log(JSON.stringify({ passed: true, checks: passed }))
