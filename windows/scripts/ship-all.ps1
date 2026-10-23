# Invoked explicitly over elevated OpenSSH by release/ship-all.sh on the Mac.
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Commit,
  [Parameter(Mandatory=$true)][ValidateSet('Preflight','Build','Install')][string]$Mode,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9-]+$')][string]$RunId
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location $root
if ((& git branch --show-current) -ne 'main') { throw 'Windows release requires main.' }
if ((& git status --porcelain --untracked-files=no)) { throw 'Windows tracked source is dirty.' }
if ($Mode -eq 'Preflight') {
  & git pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'Windows pull failed.' }
}
if ((& git rev-parse HEAD) -ne $Commit) { throw 'Windows and Mac commits differ.' }
& node windows/scripts/check-checkout.mjs
if ($LASTEXITCODE -ne 0) { throw 'Windows checkout preflight failed.' }
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Windows release requires elevated OpenSSH for symlink tests.' }
$receipt = Join-Path $root ('.texttext/ship-all-' + $RunId + '.json')
if ($Mode -eq 'Preflight') {
  Write-Output "Windows preflight: $Commit"
  exit 0
}
if ($Mode -eq 'Build') {
  if (Test-Path -LiteralPath $receipt) { throw 'Release run already exists.' }
  $candidate = $null
  & powershell -NoProfile -ExecutionPolicy Bypass -File windows/scripts/build.ps1 | ForEach-Object {
    Write-Output $_
    if ($_ -match '^Verified candidate: (.+)$') { $candidate = $Matches[1] }
  }
  if ($LASTEXITCODE -ne 0 -or !$candidate) { throw 'Windows build did not produce a verified candidate.' }
  New-Item -ItemType Directory -Force (Join-Path $root '.texttext') | Out-Null
  @{commit=$Commit; candidate=$candidate} | ConvertTo-Json | Set-Content -LiteralPath $receipt
  exit 0
}
$built = Get-Content -Raw -LiteralPath $receipt | ConvertFrom-Json
if ($built.commit -ne $Commit) { throw 'Windows candidate commit mismatch.' }
foreach ($app in @(Get-Process TextText -ErrorAction SilentlyContinue)) {
  if (!$app.CloseMainWindow() -or !$app.WaitForExit(120000)) { throw 'TextText did not quit normally; installation refused.' }
}
$backup = Join-Path $env:LOCALAPPDATA ('TextText-backups/ship-all-' + $RunId)
if (Test-Path -LiteralPath $backup) { throw 'Backup destination already exists.' }
New-Item -ItemType Directory $backup | Out-Null
$sources = @{
  vault = (Join-Path $env:USERPROFILE 'TextText')
  Sync = (Join-Path $env:LOCALAPPDATA 'TextText/Sync')
  'account.dpapi' = (Join-Path $env:LOCALAPPDATA 'TextText/account.dpapi')
}
function Inventory([string]$Path) {
  $entries = @(Get-ChildItem -LiteralPath $Path -Force -Recurse)
  if ($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Backup requires review of a reparse point; nothing installed.' }
  @($entries | Where-Object { !$_.PSIsContainer } | Sort-Object FullName | ForEach-Object {
    [ordered]@{path=$_.FullName.Substring($Path.Length); hash=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
  }) | ConvertTo-Json -Compress -Depth 4
}
foreach ($name in $sources.Keys) {
  $source = $sources[$name]
  if (!(Test-Path -LiteralPath $source)) { throw "Backup source missing: $name" }
  $target = Join-Path $backup $name
  if (Test-Path -LiteralPath $source -PathType Container) {
    $before = Inventory $source
    Copy-Item -LiteralPath $source -Destination $target -Recurse
    if ($before -ne (Inventory $source) -or $before -ne (Inventory $target)) { throw "Backup mismatch: $name" }
  } else {
    $before = (Get-FileHash -LiteralPath $source).Hash
    Copy-Item -LiteralPath $source -Destination $target
    if ($before -ne (Get-FileHash -LiteralPath $source).Hash -or $before -ne (Get-FileHash -LiteralPath $target).Hash) { throw "Backup mismatch: $name" }
  }
}
if (Get-Process TextText -ErrorAction SilentlyContinue) { throw 'TextText restarted during backup.' }
& powershell -NoProfile -ExecutionPolicy Bypass -File windows/scripts/install.ps1 -Candidate $built.candidate
if ($LASTEXITCODE -ne 0) { throw 'Windows installation failed.' }
& node windows/scripts/receipt.mjs verify (Join-Path $env:LOCALAPPDATA 'Programs/TextText')
if ($LASTEXITCODE -ne 0) { throw 'Installed Windows receipt failed.' }
Write-Output "Windows installed: $Commit"
