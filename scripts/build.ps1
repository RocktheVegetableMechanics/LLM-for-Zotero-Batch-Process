$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$developmentRoot = Join-Path $projectRoot 'development'
Push-Location $developmentRoot
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed' }
} finally { Pop-Location }
$version = (Get-Content (Join-Path $developmentRoot 'package.json') -Raw | ConvertFrom-Json).version
$artifact = Join-Path $developmentRoot '.scaffold/build'
$extensionRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'src/extension'))
if (-not $extensionRoot.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must remain inside this project' }
if (Test-Path -LiteralPath $extensionRoot) { Remove-Item -LiteralPath $extensionRoot -Recurse -Force }
Copy-Item -LiteralPath (Join-Path $artifact 'addon') -Destination $extensionRoot -Recurse
New-Item -ItemType Directory -Path (Join-Path $projectRoot 'dist') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $artifact 'llm-for-zotero.xpi') -Destination (Join-Path $projectRoot "dist/llm-for-zotero-$version.xpi") -Force
Write-Output "Built $version from development/ and synchronized src/extension/ and dist/."
