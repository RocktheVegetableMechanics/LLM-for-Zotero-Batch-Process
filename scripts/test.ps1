param([switch]$Workflow)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
& (Join-Path $projectRoot 'legacy/3.9.6.16/scripts/test.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Legacy regressions failed' }
Push-Location (Join-Path $projectRoot 'development')
try {
    & npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'Type check failed' }
    & npm run test:unit -- --timeout 10000
    if ($LASTEXITCODE -ne 0) { throw 'Unit tests failed' }
    if ($Workflow) {
        & npm run test:workflow
        if ($LASTEXITCODE -ne 0) { throw 'Native workflow tests failed' }
    }
} finally { Pop-Location }
