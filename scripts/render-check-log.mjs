// Renders the Chinese check log from the machine-written summary, so the PowerShell runner stays ASCII-only.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const summaryPath = path.join(root, 'artifacts', 'prototype', 'verify-summary.json')
const labels = JSON.parse(readFileSync(path.join(root, 'scripts', 'review-package.json'), 'utf8')).checkLog
const summary = JSON.parse(readFileSync(summaryPath, 'utf8').replace(/^\uFEFF/, ''))
const buildId = summary.buildId ? summary.buildId : labels.unsetBuildId
const lines = [
  labels.title, '',
  `${labels.buildIdLabel}：${buildId}`,
  `${labels.runTimeLabel}：${summary.startedAt} UTC ${labels.durationUnit === '秒' ? '起，共' : 'from,'} ${summary.totalSeconds} ${labels.durationUnit}；${labels.checksLabel} ${summary.checksRun} ${labels.allPassed}`,
  labels.scopeNote, '',
  labels.tableHeader, labels.tableDivider,
]
for (const check of summary.checks) lines.push(`| ${check.check} | ${check.exitCode} | ${check.seconds} |`)
lines.push('', labels.footer)
writeFileSync(path.join(root, 'artifacts', 'prototype', '检查记录.md'), `${lines.join('\n')}\n`, 'utf8')
console.log(`PASS check log rendered: ${summary.checksRun} checks, build ${buildId}`)
