$ErrorActionPreference = 'Stop'
# Optional local mode: keeps the four demo stores in files under artifacts/demo-data so the department can see
# what survives a restart. It is still Demo-only: no transactions, no multi-instance coordination, no production use.
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'src\backend\OpsPlatform.Api\OpsPlatform.Api.csproj'
$dataDir = Join-Path $root 'artifacts\demo-data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$env:WSL_UTF8 = '1'
$linuxProject = (& wsl -d Ubuntu-24.04 --exec wslpath -a $project).Trim()
if ($LASTEXITCODE -ne 0 -or -not $linuxProject) { throw 'Cannot map project into Ubuntu-24.04' }
$linuxData = (& wsl -d Ubuntu-24.04 --exec wslpath -a $dataDir).Trim()
if ($LASTEXITCODE -ne 0 -or -not $linuxData) { throw 'Cannot map the demo data directory into Ubuntu-24.04' }
Write-Host "Demo data directory: $dataDir"
Write-Host 'Files: feedback.json, ledger.json, tasks.json, prompts.json (delete them to start from seeds)'
# Never expose these paths through the API: the storage-mode route reports the implementation only.
& wsl -d Ubuntu-24.04 --exec env ASPNETCORE_ENVIRONMENT=Development Demo__Enabled=true `
    "Demo__FeedbackFile=$linuxData/feedback.json" `
    "Demo__OperationLedgerFile=$linuxData/ledger.json" `
    "Demo__TaskFile=$linuxData/tasks.json" `
    "Demo__PromptStateFile=$linuxData/prompts.json" `
    dotnet run --project $linuxProject --no-launch-profile
exit $LASTEXITCODE
