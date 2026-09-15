$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$extensionRoot = Join-Path $projectRoot 'src/extension'
$version = (Get-Content (Join-Path $extensionRoot 'manifest.json') -Raw | ConvertFrom-Json).version
$buildRoot = Join-Path $projectRoot 'build'
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
$packagePath = Join-Path $buildRoot "llm-for-zotero-$version.xpi"
if (Test-Path -LiteralPath $packagePath) { Remove-Item -LiteralPath $packagePath }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($extensionRoot, $packagePath)
Write-Output "Created: $packagePath"
