param([int]$Port = 5173)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root 'src\frontend'
$runtime = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies'
$node = Join-Path $runtime 'node\bin\node.exe'
$pnpm = Join-Path $runtime 'pnpm\bin\pnpm.mjs'
if ((Test-Path $node) -and (Test-Path $pnpm)) {
    $env:PATH = (Split-Path $node) + ';' + $env:PATH
    Push-Location $frontend
    try { & $node $pnpm dev --host 127.0.0.1 --port $Port --strictPort; exit $LASTEXITCODE }
    finally { Pop-Location }
}
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $nodeCmd -or -not $pnpmCmd) { throw 'Install Node.js LTS and pnpm, then run pnpm install inside src/frontend.' }
Push-Location $frontend
try { & $pnpmCmd.Source dev --host 127.0.0.1 --port $Port --strictPort; exit $LASTEXITCODE }
finally { Pop-Location }
