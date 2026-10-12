// Renders the department review sheet from the same data the app and the package use, so it cannot drift.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { navRoutes } from '../src/frontend/src/nav.ts'
import { reviewPath } from '../src/frontend/src/review-path.ts'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = path.join(root, 'artifacts', 'prototype')
const spec = JSON.parse(readFileSync(path.join(root, 'scripts', 'review-package.json'), 'utf8').replace(/^\uFEFF/, ''))
function buildId() {
  const injected = (process.env.PROTOTYPE_BUILD_ID || '').trim()
  if (injected) return injected
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'unknown' } catch { return 'unknown' }
}
const scopePath = path.join(artifacts, 'scope-summary.json')
const scope = existsSync(scopePath) ? JSON.parse(readFileSync(scopePath, 'utf8').replace(/^\uFEFF/, '')) : null
const summaryPath = path.join(artifacts, 'verify-summary.json')
const verify = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8').replace(/^\uFEFF/, '')) : null
const id = buildId()
const lines = [
  '# 部门原型评审记录单',
  '',
  '> 本记录单由脚本按当前构建生成，供评审时逐条填写。它本身不是验收结论：未填写即视为“未执行”。',
  '',
  '## 1. 基本信息（评审时填写）',
  '',
  '| 项目 | 内容 |',
  '| --- | --- |',
  `| 构建标识 | ${id} |`,
  `| 数据模式 | 模拟／Demo内存样本（无真实来源；未连接真实设备、数据库或模型） |`,
  `| 页面数量 | ${navRoutes.length} 条路由 |`,
  scope ? `| 用例范围 | 已纳入 ${scope.casesReferenced} / 共 ${scope.casesTotal}；显式排除 ${scope.excluded.length} 项 |` : '| 用例范围 | 范围摘要缺失，请先运行 scripts/prototype-scope-map.mjs |',
  verify ? `| 自动检查 | 本次实跑 ${verify.checksRun} 项，全部通过（${verify.startedAt}） |` : '| 自动检查 | 未提供检查摘要 |',
  '| 评审日期 | 待填写 |',
  '| 参与者（角色，勿填个人信息） | 待填写 |',
  '| 浏览器与分辨率 | 待填写 |',
  '',
  '## 2. 观看顺序（建议，不代表已通过）',
  '',
]
for (const step of reviewPath) lines.push(`- [ ] ${step.label}　（${step.to}）　${step.hint}`)
lines.push('', '## 3. 逐项结论（每条都需证据引用）', '',
  '| 步骤 | 结果（未执行/通过/失败/阻塞/不适用） | 证据引用 | 反馈编号 | 备注 |',
  '| --- | --- | --- | --- | --- |')
for (const step of reviewPath) lines.push(`| ${step.label} | 未执行 |  |  |  |`)
lines.push('', '## 4. 边界状态与缺口', '',
  '| 检查项 | 结果 | 证据引用 |',
  '| --- | --- | --- |',
  '| 空数据（资产搜索无匹配等） | 未执行 |  |',
  '| 未接入（静态包 503 显示失败而非本地回退） | 未执行 |  |',
  '| 加载与取消等待（无结论提示） | 未执行 |  |',
  '| 部分失败（拟接入清单定位失败项） | 未执行 |  |',
  '| 未知（任务结果未知→对账） | 未执行 |  |',
  '| 无权限 | 不适用（本原型无鉴权，需 L2 试点后再演示） |  |',
  '',
  '## 5. 已知缺口确认',
  '',
  '逐项确认《已知问题与下一迭代》中的 K-01…K-07 是否已被评审知晓：',
  '')
for (const item of ['K-01 无鉴权与页面级无权限态', 'K-02 无真实持久化', 'K-03 无真实设备/数据库/模型连接', 'K-04 提示词无审批与发布生效', 'K-05 任务与研究型 AI 无执行链路', 'K-06 部分验收清单用例未纳入本批', 'K-07 工单/资产等业务域为固定样本'])
  lines.push(`- [ ] 已知晓：${item}`)
lines.push('', '## 6. 结论与下一步', '',
  '| 项目 | 内容 |', '| --- | --- |',
  '| 部门结论（满足 L0 可交部门评审／已交付待部门评审／有真实意见记录） | 待填写 |',
  '| 是否认为可进入 L1 部门评审 | 待填写 |',
  '| P0/P1 未清问题数量 | 待填写 |',
  '| 下一步与复测版本 | 待填写 |', '',
  `本记录单随包提供；材料清单见包内 ${spec.required.join('、')}。`,
  '无实际签认不得写“用户已验收”；自动化检查通过不代填部门结论。',
  '')
writeFileSync(path.join(artifacts, '评审记录单.md'), `${lines.join('\n')}`, 'utf8')
// --check re-reads what was written: the sheet must be complete and must not pre-fill any conclusion.
if (process.argv.includes('--check')) {
  const text = readFileSync(path.join(artifacts, '评审记录单.md'), 'utf8')
  const problems = []
  if (!text.includes(id)) problems.push('build id missing')
  if (!text.includes(`${navRoutes.length} 条路由`)) problems.push('route count missing')
  for (const step of reviewPath) if (!text.includes(step.label)) problems.push(`review step missing: ${step.label}`)
  for (const item of ['K-01', 'K-02', 'K-03', 'K-04', 'K-05', 'K-06', 'K-07']) if (!text.includes(item)) problems.push(`known gap missing: ${item}`)
  if (!text.includes('不适用（本原型无鉴权')) problems.push('no-permission row must be marked 不适用 with a reason')
  if (!text.includes('未执行')) problems.push('unfilled results marker missing')
  if (/(\|[^|\n]*\|\s*(通过|失败)\s*\|)/.test(text)) problems.push('review sheet must not pre-fill 通过/失败')
  if (!text.includes('无实际签认不得写')) problems.push('sign-off rule missing')
  if (problems.length > 0) { console.error(`Review sheet check failed (${problems.length}):`); for (const problem of problems) console.error(`- ${problem}`); process.exit(1) }
  console.log(`PASS review sheet check: ${reviewPath.length} steps, ${navRoutes.length} routes, no pre-filled results.`)
}
console.log(`PASS review sheet rendered for build ${id}: ${reviewPath.length} steps, ${navRoutes.length} routes.`)
