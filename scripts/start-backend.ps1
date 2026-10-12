$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'src\backend\OpsPlatform.Api\OpsPlatform.Api.csproj'
$env:WSL_UTF8 = '1'
$linuxProject = (& wsl -d Ubuntu-24.04 --exec wslpath -a $project).Trim()
if ($LASTEXITCODE -ne 0 -or -not $linuxProject) { throw 'Cannot map project into Ubuntu-24.04' }
# Force Development + demo at process scope; never enable production access here.
& wsl -d Ubuntu-24.04 --exec env ASPNETCORE_ENVIRONMENT=Development Demo__Enabled=true dotnet run --project $linuxProject --no-launch-profile
exit $LASTEXITCODE
