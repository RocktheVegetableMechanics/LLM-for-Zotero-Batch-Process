$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
& node --check (Join-Path $projectRoot 'src/extension/content/scripts/llmforzotero.js')
if ($LASTEXITCODE -ne 0) { throw 'JavaScript syntax check failed' }
foreach ($testFile in (Get-ChildItem (Join-Path $projectRoot 'tests') -Filter 'test-*.mjs' | Sort-Object Name)) {
    Write-Output $testFile.Name
    & node $testFile.FullName
    if ($LASTEXITCODE -ne 0) { throw "Test failed: $($testFile.Name)" }
}
