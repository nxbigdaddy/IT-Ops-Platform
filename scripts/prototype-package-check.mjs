// Verifies a packaged review folder: required materials, manifest fields, and that the built assets really
// carry the build id the manifest claims (a stale dist is otherwise indistinguishable from a fresh one).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const spec = JSON.parse(readFileSync(path.join(root, 'scripts', 'review-package.json'), 'utf8').replace(/^\uFEFF/, ''))
const target = process.argv[2]
const packages = path.join(root, 'artifacts', 'packages')
function latestUnpacked() {
  if (!existsSync(packages)) return null
  const candidates = readdirSync(packages)
    .filter(name => !name.endsWith('.zip'))
    .map(name => path.join(packages, name))
    .filter(directory => statSync(directory).isDirectory() && existsSync(path.join(directory, 'prototype-manifest.json')))
  return candidates.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0] ?? null
}
const folder = target ? path.resolve(target) : latestUnpacked()
const problems = []
if (!folder || !existsSync(folder)) problems.push('no packaged folder found; build a package first')
else {
  for (const material of spec.required) if (!existsSync(path.join(folder, material))) problems.push(`missing material: ${material}`)
  const manifestPath = path.join(folder, 'prototype-manifest.json')
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')) : null
  if (!manifest) problems.push('missing prototype-manifest.json')
  else {
    if (manifest.mode !== 'mock') problems.push(`mode must be mock, found ${manifest.mode}`)
    if (manifest.productionReady !== false) problems.push('productionReady must be false')
    if (manifest.backendIncluded !== false) problems.push('backendIncluded must be false')
    if (manifest.pageCount !== 17) problems.push(`pageCount must be 17, found ${manifest.pageCount}`)
    if (!manifest.buildId) problems.push('buildId must be recorded')
    const listed = Array.isArray(manifest.reviewMaterials) ? [...manifest.reviewMaterials].sort() : []
    const actual = spec.required.filter(name => existsSync(path.join(folder, name))).sort()
    if (JSON.stringify(listed) !== JSON.stringify(actual)) problems.push(`reviewMaterials must match the shipped files: declared ${listed.length}, present ${actual.length}`)
    // Packaged bytes must be the bytes that were verified: every asset hash must match the file on disk.
    const assetDir = path.join(folder, 'assets')
    const declared = Array.isArray(manifest.assetHashes) ? manifest.assetHashes : []
    if (declared.length === 0) problems.push('assetHashes must be recorded so packaged bytes can be verified')
    else {
      const present = existsSync(assetDir) ? readdirSync(assetDir).filter(name => statSync(path.join(assetDir, name)).isFile()).sort() : []
      const declaredNames = declared.map(item => item.name).sort()
      if (JSON.stringify(present) !== JSON.stringify(declaredNames)) problems.push(`declared assets must match the folder: declared ${declaredNames.join(', ') || 'none'}, present ${present.join(', ') || 'none'}`)
      for (const item of declared) {
        const filePath = path.join(assetDir, item.name)
        if (!existsSync(filePath)) { problems.push(`declared asset missing: ${item.name}`); continue }
        const bytes = readFileSync(filePath)
        if (bytes.length !== item.bytes) problems.push(`${item.name} byte length differs from the manifest`)
        const digest = createHash('sha256').update(bytes).digest('hex').toUpperCase()
        if (digest !== String(item.sha256).toUpperCase()) problems.push(`${item.name} sha256 differs from the manifest`)
      }
    }
    const entryPath = path.join(folder, 'index.html')
    if (existsSync(entryPath) && manifest.entrySha256) {
      const entryDigest = createHash('sha256').update(readFileSync(entryPath)).digest('hex').toUpperCase()
      if (entryDigest !== String(manifest.entrySha256).toUpperCase()) problems.push('index.html sha256 differs from the manifest')
    } else if (!manifest.entrySha256) problems.push('entrySha256 must be recorded for index.html')
    const assets = existsSync(path.join(folder, 'assets')) ? readdirSync(path.join(folder, 'assets')).filter(name => name.endsWith('.js')) : []
    if (assets.length === 0) problems.push('no built JavaScript asset found')
    else {
      const bundle = assets.map(name => readFileSync(path.join(folder, 'assets', name), 'utf8')).join('\n')
      if (manifest.buildId && !bundle.includes(manifest.buildId)) problems.push(`built assets do not contain buildId ${manifest.buildId} (stale dist?)`)
      if (/productionReady"?\s*:\s*true/.test(bundle)) problems.push('bundle must never claim production readiness')
    }
    // The shipped review sheet must describe this build, not an earlier one.
    const sheetPath = path.join(folder, '评审记录单.md')
    if (existsSync(sheetPath) && manifest.buildId) {
      const sheet = readFileSync(sheetPath, 'utf8')
      if (!sheet.includes(manifest.buildId)) problems.push(`review sheet must reference build ${manifest.buildId}`)
      if (/(\|[^|\n]*\|\s*(通过|失败)\s*\|)/.test(sheet)) problems.push('review sheet must not pre-fill 通过/失败')
    }
    // The exported record template must reference this build, not an older one.
    const recordsPath = path.join(folder, 'case-records-template.csv')
    if (existsSync(recordsPath)) {
      const rows = readFileSync(recordsPath, 'utf8').replace(/^\uFEFF/, '').trim().split('\n').slice(1)
      if (rows.length !== 17) problems.push(`case-record template must have 17 rows, found ${rows.length}`)
      const wrong = rows.filter(row => !row.includes(`,${manifest.buildId},`))
      if (wrong.length > 0) problems.push(`case-record template build id must be ${manifest.buildId} (${wrong.length} row(s) differ)`)
      const preFilled = rows.filter(row => /,(通过|失败),/.test(row))
      if (preFilled.length > 0) problems.push('case-record template must not pre-fill 通过/失败')
    }
  }
}
if (problems.length > 0) {
  console.error(`Package check failed (${problems.length}):`)
  for (const problem of problems) console.error(`- ${problem}`)
  process.exit(1)
}
console.log(`PASS package check: ${spec.required.length} materials, manifest consistent with the built assets (build ${JSON.parse(readFileSync(path.join(folder, 'prototype-manifest.json'), 'utf8').replace(/^\uFEFF/, '')).buildId}).`)
