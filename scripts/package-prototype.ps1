param([string]$Label = 'department-demo', [switch]$AllowIncomplete)
$ErrorActionPreference = 'Stop'
if ($Label -notmatch '^[a-zA-Z0-9-]{1,40}$') { throw 'Label must contain only letters, digits or hyphens.' }
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'src\frontend\dist'
if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw 'Run the verified frontend build first.' }
$commit = (& git -C $root rev-parse --short HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify source revision.' }
$dirty = @(& git -C $root status --porcelain).Count -gt 0
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$destination = Join-Path $root "artifacts\packages\$Label-$commit-$stamp"
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -Path (Join-Path $dist '*') -Destination $destination -Recurse
$server = Join-Path $PSScriptRoot 'prototype-static-server.mjs'
if (Test-Path $server) { Copy-Item -LiteralPath $server -Destination (Join-Path $destination 'serve-demo.mjs') }
# The department fills this record file; the template ships unfilled so no result can be pre-filled.
# It is regenerated here so its build id matches the packaged build rather than an older verification run.
$recordsPath = Join-Path $root 'artifacts\prototype\case-records-template.csv'
$runtime = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$nodeExe = if (Test-Path $runtime) { $runtime } else { 'node' }
try {
    $env:PROTOTYPE_BUILD_ID = $commit
    & $nodeExe (Join-Path $PSScriptRoot 'prototype-case-records.mjs') --template
    if ($LASTEXITCODE -ne 0) { Write-Warning 'case-record template generation failed; the packaged file may carry an older build id.' }
} catch { Write-Warning "case-record template generation skipped: $($_.Exception.Message)" }
if (Test-Path $recordsPath) { Copy-Item -LiteralPath $recordsPath -Destination (Join-Path $destination 'case-records-template.csv') }
else { Write-Warning 'case-records-template.csv missing; run scripts/prototype-case-records.mjs --template before packaging so reviewers receive the record file.' }
# Review materials the department needs alongside the static app.
$materials = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'review-package.json') -Raw -Encoding utf8 | ConvertFrom-Json)
foreach ($document in $materials.materials) {
    $sourcePath = Join-Path $root ($document.source -replace '/', '\')
    if (Test-Path $sourcePath) { Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $destination $document.target) }
    else { Write-Warning "Missing review material: $($document.source)" }
}

# The scope summary is produced by scripts/prototype-scope-map.mjs during verification.
$summaryPath = Join-Path $root 'artifacts\prototype\scope-summary.json'
$scope = $null
if (Test-Path $summaryPath) { $scope = (Get-Content -LiteralPath $summaryPath -Raw -Encoding utf8 | ConvertFrom-Json) }
else { Write-Warning 'scope-summary.json missing; run scripts/verify-prototype.ps1 before packaging so the manifest can state page coverage.' }
@{
    sourceCommit=$commit; buildId=$commit; uncommittedChanges=$dirty; createdAt=(Get-Date).ToUniversalTime().ToString('o')
    mode='mock'; backendIncluded=$false; productionReady=$false
    pageCount = if ($scope) { $scope.pages } else { $null }
    caseScope = if ($scope) { [ordered]@{ referenced=$scope.casesReferenced; total=$scope.casesTotal; excluded=$scope.excluded } } else { $null }
    reviewMaterials = @($materials.required)
    assetHashes = (Get-ChildItem -Path (Join-Path $destination 'assets') -File | Sort-Object Name | ForEach-Object { @{ name = $_.Name; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash; bytes = $_.Length } })
    entrySha256 = (Get-FileHash -LiteralPath (Join-Path $destination 'index.html') -Algorithm SHA256).Hash
    notes='Static UI only. Configure SPA fallback. The local Development API proxy is not included. Never enter real credentials or personal data. API calls return 503 and must be shown as failures, never as local fallbacks.'
} | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $destination 'prototype-manifest.json') -Encoding UTF8
$guide = ($materials.readme -join [Environment]::NewLine)
$guide | Set-Content -Path (Join-Path $destination 'DEMO-README.txt') -Encoding UTF8
# The checklist requires these artifacts in every release package; refuse to ship an incomplete one.
$expected = @($materials.required)
$missing = @($expected | Where-Object { -not (Test-Path (Join-Path $destination $_)) })
if ($missing.Count -gt 0) {
    $list = ($missing -join ', ')
    if ($AllowIncomplete) { Write-Warning "Packaging an incomplete review package (-AllowIncomplete): $list" }
    else { throw "Review package is missing required materials: $list. Run scripts/verify-prototype.ps1 first, or pass -AllowIncomplete for a development-only archive." }
}
Write-Output ("Review materials included ({0}): {1}" -f $expected.Count, ($expected -join ', '))
# Verify the packaged folder before compressing: materials, manifest and built-asset build id must agree.
& $nodeExe (Join-Path $PSScriptRoot 'prototype-package-check.mjs') $destination
if ($LASTEXITCODE -ne 0) { throw 'Package check failed; refusing to produce an inconsistent archive.' }
$zip = "$destination.zip"
Compress-Archive -Path (Join-Path $destination '*') -DestinationPath $zip
Get-FileHash -Path $zip -Algorithm SHA256 | Select-Object Path, Hash
