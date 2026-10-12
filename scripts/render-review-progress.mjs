// Renders a review-progress report from a department-filled case-record file. It never invents results: rows
// that were left unexecuted stay unexecuted, and only rows the department filled count as department findings.
import assert from 'node:assert/strict'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {navRoutes} from '../src/frontend/src/nav.ts'
import {parseCsv, validateRecords} from './prototype-case-records.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = path.join(root, 'artifacts', 'prototype')
const columns = ['route', 'caseId', 'buildId', 'executor', 'mode', 'startedAt', 'expected', 'actual', 'result', 'evidence', 'feedbackId', 'retestVersion']
const cases = new Set([...readFileSync(path.join(root, 'docs', '部门原型验收清单.md'), 'utf8').matchAll(/UI-\d{2}/g)].map(match => match[0]))
export function summarize(text, {knownRoutes = navRoutes.map(route => route.to), buildId = null} = {}) {
  const check = validateRecords(text, {knownCases: [...cases], knownRoutes, buildId})
  if (check.errors.length > 0) throw new Error(`记录文件未通过校验：${check.errors.slice(0, 3).join('；')}`)
  const rows = parseCsv(text)
  const header = rows[0].map(cell => cell.trim())
  const index = Object.fromEntries(header.map((column, position) => [column, position]))
  const read = (line, column) => (line[index[column]] ?? '').trim()
  const records = rows.slice(1).map(line => ({
    route: read(line, 'route'), caseId: read(line, 'caseId'), executor: read(line, 'executor'),
    result: read(line, 'result'), evidence: read(line, 'evidence'), feedbackId: read(line, 'feedbackId'),
    startedAt: read(line, 'startedAt'), actual: read(line, 'actual'), buildId: read(line, 'buildId'),
  }))
  const byResult = {未执行: [], 通过: [], 失败: [], 阻塞: [], 不适用: []}
  for (const record of records) byResult[record.result].push(record)
  const executed = records.filter(record => record.result !== '未执行')
  const department = records.filter(record => record.executor === '部门')
  const executedCases = new Set(executed.map(record => record.caseId))
  return {
    total: records.length, byResult, executed, department, records,
    executedCaseCount: executedCases.size, caseTotal: cases.size,
    buildIds: [...new Set(records.map(record => record.buildId))].sort(),
    routesWithAnyRow: new Set(records.map(record => record.route)).size,
  }
}
export function render(summary, {generatedAt = new Date().toISOString()} = {}) {
  const lines = [
    '# 部门评审进度汇总', '',
    '> 本文件由记录文件渲染生成，只反映记录文件里实际填写的内容：**没有填写的行仍是“未执行”**，不代表通过。',
    '', '## 1. 概况', '',
    '| 项目 | 数量 |', '| --- | --- |',
    `| 记录总行数 | ${summary.total} |`,
    `| 已执行（非“未执行”） | ${summary.executed.length} |`,
    `| 其中由部门填写 | ${summary.department.length} |`,
    `| 覆盖用例 | ${summary.executedCaseCount} / ${summary.caseTotal}（占目标用例） |`,
    `| 覆盖路由 | ${summary.routesWithAnyRow} / ${navRoutes.length} |`,
    `| 涉及构建标识 | ${summary.buildIds.join('、') || '（无）'} |`,
    `| 渲染时间 | ${generatedAt} |`, '',
    '## 2. 结果分布', '',
    '| 结果 | 行数 |', '| --- | --- |',
  ]
  for (const result of ['未执行', '通过', '失败', '阻塞', '不适用']) lines.push(`| ${result} | ${summary.byResult[result].length} |`)
  lines.push('', '## 3. 失败与阻塞（优先处理）', '')
  const problems = [...summary.byResult['失败'], ...summary.byResult['阻塞']]
  if (problems.length === 0) lines.push('记录文件中没有“失败”或“阻塞”行；这不等于没有问题，只等于尚未记录。')
  else {
    lines.push('| 路由 | 用例 | 执行者 | 结果 | 证据引用 | 反馈编号 | 实际观察 |', '| --- | --- | --- | --- | --- | --- | --- |')
    for (const record of problems) lines.push(`| ${record.route} | ${record.caseId} | ${record.executor} | ${record.result} | ${record.evidence || '（缺）'} | ${record.feedbackId || '（无）'} | ${(record.actual || '（空）').replace(/\|/g, '\\|')} |`)
  }
  lines.push('', '## 4. “不适用”的范围依据', '')
  if (summary.byResult['不适用'].length === 0) lines.push('没有“不适用”行。')
  else {
    lines.push('| 路由 | 用例 | 依据（预期或实际列） |', '| --- | --- | --- |')
    for (const record of summary.byResult['不适用']) lines.push(`| ${record.route} | ${record.caseId} | ${(record.actual || '（见记录文件）').replace(/\|/g, '\\|')} |`)
  }
  lines.push('', '## 5. 通过项（需可复核证据）', '')
  if (summary.byResult['通过'].length === 0) lines.push('记录文件中没有“通过”行；自动化检查通过不代填部门结论。')
  else {
    lines.push('| 路由 | 用例 | 执行者 | 证据引用 | 反馈编号 |', '| --- | --- | --- | --- | --- |')
    for (const record of summary.byResult['通过']) lines.push(`| ${record.route} | ${record.caseId} | ${record.executor} | ${record.evidence || '（缺）'} | ${record.feedbackId || '（无）'} |`)
  }
  lines.push('', '## 6. 未执行（仍需部门确认）', '')
  const pending = summary.byResult['未执行']
  lines.push(pending.length === 0 ? '没有未执行行。' : `仍有 ${pending.length} 行未执行：${pending.map(record => record.caseId).join('、')}。`)
  lines.push('', '## 7. 结论口径', '',
    '- 只有记录文件中由部门填写、且带证据引用的行才可作为部门结论；本文件不构成签认。',
    '- “不适用”必须写明范围依据；自动化或开发自测通过不代填部门通过。',
    '- 未执行的行不得在其它文档中被描述为通过或已完成。', '')
  return `${lines.join('\n')}`
}
function selfTest() {
  const base = {route: '/', caseId: 'UI-01', buildId: 'demo-build', executor: '未指定', mode: '模拟', startedAt: '', expected: '', actual: '', result: '未执行', evidence: '', feedbackId: '', retestVersion: ''}
  const text = [columns.join(','),
    ['/', 'UI-01', 'demo-build', '部门', '模拟', '2026-10-10 09:00', '预期', '实际通过', '通过', '截图1', 'FB-1', ''].join(','),
    ['/assets', 'UI-03', 'demo-build', '开发', '模拟', '2026-10-10 09:10', '预期', '实际失败', '失败', '录像2', '', ''].join(','),
    ['/alerts', 'UI-08', 'demo-build', '未指定', '模拟', '', '', '', '未执行', '', '', ''].join(','),
  ].join('\n')
  const summary = summarize(text, {knownRoutes: ['/', '/assets', '/alerts'], buildId: 'demo-build'})
  assert.equal(summary.total, 3)
  assert.equal(summary.executed.length, 2)
  assert.equal(summary.department.length, 1)
  const report = render(summary)
  assert.ok(report.includes('| 通过 | 1 |') && report.includes('| 失败 | 1 |') && report.includes('| 未执行 | 1 |'), report)
  assert.ok(report.includes('截图1') && report.includes('FB-1') && report.includes('录像2'))
  assert.ok(report.includes('仍有 1 行未执行：UI-08'), report)
  assert.ok(report.includes('只有记录文件中由部门填写'), 'the report must state who owns conclusions')
  // An invalid file must fail instead of producing a friendly-looking report.
  assert.throws(() => summarize(text.replace('部门', '客户'), {knownRoutes: ['/', '/assets', '/alerts'], buildId: 'demo-build'}), /未通过校验/)
  console.log('PASS review progress self-test: counts, problems, evidence and refusal of invalid records.')
}
if (process.argv.includes('--self-test')) selfTest()
else {
  const target = process.argv[process.argv.indexOf('--records') + 1]
  if (!target || !existsSync(target)) throw new Error('用法：node scripts/render-review-progress.mjs --records <csv路径>')
  const buildId = (process.env.PROTOTYPE_BUILD_ID || '').trim() || null
  const summary = summarize(readFileSync(target, 'utf8'), {buildId})
  mkdirSync(artifacts, {recursive: true})
  const output = path.join(artifacts, '评审进度.md')
  writeFileSync(output, render(summary), 'utf8')
  console.log(`PASS review progress rendered: ${summary.executed.length}/${summary.total} executed, ${summary.byResult['失败'].length} failed, ${summary.byResult['阻塞'].length} blocked -> ${output}`)
}
