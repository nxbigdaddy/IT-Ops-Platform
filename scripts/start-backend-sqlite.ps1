$ErrorActionPreference = 'Stop'
# Optional local mode: serves all four demo stores from a real SQLite database (transactions and unique
# indexes) so the department can see what the database actually guarantees. Development-only: no migrations,
# retention policy, row-level security or audit, and the API still reports that nothing is durably persisted.
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'src\backend\OpsPlatform.Api\OpsPlatform.Api.csproj'
$dataDir = Join-Path $root 'artifacts\demo-data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$env:WSL_UTF8 = '1'
$linuxProject = (& wsl -d Ubuntu-24.04 --exec wslpath -a $project).Trim()
if ($LASTEXITCODE -ne 0 -or -not $linuxProject) { throw 'Cannot map project into Ubuntu-24.04' }
$linuxDatabase = (& wsl -d Ubuntu-24.04 --exec wslpath -a (Join-Path $dataDir 'demo.db')).Trim()
if ($LASTEXITCODE -ne 0 -or -not $linuxDatabase) { throw 'Cannot map the demo database into Ubuntu-24.04' }
Write-Host "Demo database: $dataDir\demo.db"
Write-Host 'Tables: demo_feedback, demo_operation_ledger, demo_task, demo_task_journal, demo_prompt_version, demo_prompt_published'
Write-Host 'Reset: stop the backend and delete demo.db (there is no migration history to preserve).'
# Never expose this path through the API: the storage-mode route reports the implementation only.
& wsl -d Ubuntu-24.04 --exec env ASPNETCORE_ENVIRONMENT=Development Demo__Enabled=true "Demo__SqlitePath=$linuxDatabase" `
    dotnet run --project $linuxProject --no-launch-profile
exit $LASTEXITCODE
