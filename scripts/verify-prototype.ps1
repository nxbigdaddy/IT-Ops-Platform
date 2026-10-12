$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies'
$node = Join-Path $runtime 'node\bin\node.exe'
$pnpm = Join-Path $runtime 'pnpm\bin\pnpm.mjs'
if (-not (Test-Path $node) -or -not (Test-Path $pnpm)) { throw 'This convenience runner needs the bundled runtime; run the documented node/pnpm commands manually elsewhere.' }
$env:PATH = (Split-Path $node) + ';' + $env:PATH
& $node (Join-Path $root 'scripts/prototype-preflight.mjs') --self-test
if ($LASTEXITCODE -ne 0) { throw 'Preflight self-test failed' }
& $node (Join-Path $root 'scripts/prototype-preflight.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Demo preflight failed. Start both services and retry; this is not production readiness.' }
Push-Location (Join-Path $root 'src\frontend')
try {
    # Stamp the built assets with the current revision so reviewers can quote the exact build.
    $revision = (& git -C $root rev-parse --short HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $revision) { $env:PROTOTYPE_BUILD_ID = $revision.Trim() }
    # Builders write progress to stderr; with ErrorActionPreference=Stop that would abort the run, so the
    # preference is relaxed for the native call and the exit code is checked explicitly instead.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $node $pnpm run build 2>&1 | ForEach-Object { Write-Host $_ } }
    finally { $ErrorActionPreference = $previousPreference }
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
} finally { Pop-Location }
Push-Location $root
# The release package embeds this log so reviewers can see what actually ran, and when.
$runLog = [System.Collections.Generic.List[object]]::new()
$runStarted = Get-Date
$runBuild = $env:PROTOTYPE_BUILD_ID
function Invoke-Checked([string]$label, [scriptblock]$action) {
    $started = Get-Date
    & $action
    $code = $LASTEXITCODE
    $runLog.Add([ordered]@{ check = $label; exitCode = $code; seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1) })
    if ($code -ne 0) { throw "Failed: $label" }
}
try {
    foreach ($script in @('scripts/prototype-feedback-filter-tests.mjs','scripts/prototype-feedback-summary-tests.mjs','scripts/prototype-server-feedback-contract-tests.mjs','scripts/prototype-scope-map.mjs','scripts/prototype-bounded-json-tests.mjs','scripts/prototype-state-tests.mjs','scripts/prototype-feedback-tests.mjs','scripts/prototype-prompt-tests.mjs','scripts/backend-contract.mjs','scripts/prototype-smoke.mjs','scripts/prototype-flows.mjs','scripts/prototype-a11y.mjs','scripts/prototype-domains.mjs','scripts/prototype-connector-search.mjs','scripts/prototype-connector-coverage.mjs','scripts/prototype-collection-channels.mjs','scripts/prototype-target-scope.mjs','scripts/prototype-integration.mjs','scripts/prototype-integration-diagnostics.mjs','scripts/prototype-feedback-flow.mjs','scripts/prototype-feedback-draft.mjs','scripts/prototype-operation-ledger.mjs','scripts/prototype-approval-preflight.mjs','scripts/prototype-authorization-preflight.mjs','scripts/prototype-execution-preflight.mjs','scripts/prototype-review-evidence.mjs','scripts/prototype-server-feedback-list.mjs','scripts/prototype-database-candidates.mjs','scripts/prototype-monitored-targets.mjs','scripts/prototype-monitored-query.mjs','scripts/prototype-storage-modes.mjs','scripts/prototype-readiness.mjs','scripts/prototype-migration-plan.mjs','scripts/prototype-ai-candidates.mjs','scripts/prototype-ai-response-preflight.mjs','scripts/prototype-ai-loopback.mjs','scripts/prototype-governance-flow.mjs','scripts/prototype-server-prompt-flow.mjs','scripts/prototype-prompt-history.mjs','scripts/prototype-prompt-bindings.mjs','scripts/prototype-static-check.mjs')) {
        if (-not (Test-Path $script)) { throw "Missing expected test: $script" }
        Invoke-Checked $script { & $node $script }
    }
    Invoke-Checked 'case-record validator self-test' { & $node scripts/prototype-case-records.mjs --self-test }
    Invoke-Checked 'case-record template' { & $node scripts/prototype-case-records.mjs --template }
    Invoke-Checked 'case-record template validation' { & $node scripts/prototype-case-records.mjs --check (Join-Path $root 'artifacts\prototype\case-records-template.csv') }
    Invoke-Checked 'actual HTTP task simulation' { & $node scripts/prototype-task-demo.mjs --live }
    Invoke-Checked 'actual HTTP database preflight' { & $node scripts/prototype-database-preflight.mjs --live }
    Invoke-Checked 'actual HTTP connector intent preflight' { & $node scripts/prototype-connector-preflight.mjs --live }
    Invoke-Checked 'actual HTTP AI preflight' { & $node scripts/prototype-ai-preflight.mjs --live }
    $summary = [ordered]@{
        generatedAt = (Get-Date).ToUniversalTime().ToString('o')
        startedAt = $runStarted.ToUniversalTime().ToString('o')
        buildId = if ($runBuild) { $runBuild } else { $null }
        totalSeconds = [math]::Round(((Get-Date) - $runStarted).TotalSeconds, 1)
        checksRun = $runLog.Count
        checksFailed = 0
        kind = 'automated-development-check'
        notes = 'Automated checks only. They do not prove department acceptance, device connectivity, model transport or production readiness.'
        checks = $runLog
    }
    $summaryPath = Join-Path $root 'artifacts\prototype\verify-summary.json'
    $summary | ConvertTo-Json -Depth 5 | Set-Content -Path $summaryPath -Encoding UTF8
    # Rendering the log is not itself a logged check, so the reported count stays consistent.
    & $node scripts/render-review-sheet.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Failed: render review sheet' }
    & $node scripts/render-review-sheet.mjs --check
    if ($LASTEXITCODE -ne 0) { throw 'Failed: review sheet check' }
    & $node scripts/render-check-log.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Failed: render check log' }
    Write-Output "All prototype checks passed ($($runLog.Count) checks). Summary written to artifacts/prototype/verify-summary.json."
} finally { Pop-Location }
