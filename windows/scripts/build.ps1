# Explicit developer invocation only. This script never installs or launches the app.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$dotnet = Join-Path $env:LOCALAPPDATA 'TextTextBuild/dotnet/dotnet.exe'
if (!(Test-Path $dotnet)) { throw 'Run windows/scripts/bootstrap-sdk.ps1 first.' }
Push-Location $root
try {
  if (!(Test-Path 'windows/TextText.Windows/Runtime/bin/codex.exe')) { throw 'Run node windows/TextText.Windows/fetch-runtime.mjs before building.' }
  $source = (& node windows/scripts/receipt.mjs source)
  if ($LASTEXITCODE -ne 0) { throw 'Source fingerprint failed.' }
  $candidate = Join-Path $root ('windows/build/candidate-' + [guid]::NewGuid().ToString('N'))
  & $dotnet run --project windows/TextText.Core.Tests/TextText.Core.Tests.csproj --configuration Release
  if ($LASTEXITCODE -ne 0) { throw 'Native core regression tests failed.' }
  & $dotnet run --project windows/TextText.Agent.Tests/TextText.Agent.Tests.csproj --configuration Release
  if ($LASTEXITCODE -ne 0) { throw 'Native agent regression tests failed.' }
  & node node_modules/vitest/vitest.mjs run --config sync/vitest.client.config.mts
  if ($LASTEXITCODE -ne 0) { throw 'Shared client regression tests failed.' }
  & node node_modules/typescript/bin/tsc --noEmit --pretty false
  if ($LASTEXITCODE -ne 0) { throw 'Type checking failed.' }
  & node windows/scripts/build-ui.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Shared UI build failed.' }
  & $dotnet publish windows/TextText.Windows/TextText.Windows.csproj --configuration Release --runtime win-x64 --self-contained true --output $candidate
  if ($LASTEXITCODE -ne 0) { throw 'Windows desktop publish failed.' }
  & powershell -NoProfile -ExecutionPolicy Bypass -File windows/scripts/smoke.ps1
  if ($LASTEXITCODE -ne 0) { throw 'Native desktop editor/close regression tests failed.' }
  & node windows/scripts/receipt.mjs seal $candidate $source
  if ($LASTEXITCODE -ne 0) { throw 'Windows verification receipt failed.' }
  Write-Output "Verified candidate: $candidate"
} finally { Pop-Location }
