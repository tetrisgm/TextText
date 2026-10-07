# Explicit local invocation only. Preserves previous application and all user data.
param([Parameter(Mandatory=$true)][string]$Candidate)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$Candidate = (Resolve-Path $Candidate).Path
Push-Location $root
try {
  & node windows/scripts/receipt.mjs verify $Candidate
  if ($LASTEXITCODE -ne 0) { throw 'Candidate verification failed; nothing installed.' }
  $parent = Join-Path $env:LOCALAPPDATA 'Programs'
  $target = Join-Path $parent 'TextText'
  foreach ($process in @(Get-Process TextText -ErrorAction SilentlyContinue)) {
    if ($process.Path -and $process.Path.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Close TextText after saving before installing.' }
  }
  New-Item -ItemType Directory -Force $parent | Out-Null
  $stage = Join-Path $parent ('TextText-stage-' + [guid]::NewGuid().ToString('N'))
  Copy-Item -LiteralPath $Candidate -Destination $stage -Recurse
  & node windows/scripts/receipt.mjs verify $stage
  if ($LASTEXITCODE -ne 0) { throw 'Staged candidate verification failed; existing app preserved.' }
  $backup = Join-Path $parent ('TextText-previous-' + (Get-Date -Format 'yyyyMMddTHHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
  $moved = $false
  try {
    if (Test-Path $target) { Move-Item -LiteralPath $target -Destination $backup; $moved = $true }
    Move-Item -LiteralPath $stage -Destination $target
  } catch {
    if ($moved -and !(Test-Path $target)) { Move-Item -LiteralPath $backup -Destination $target }
    throw
  }
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'TextText.lnk'))
  $shortcut.TargetPath = Join-Path $target 'TextText.exe'
  $shortcut.WorkingDirectory = $target
  $shortcut.Save()
  Write-Output "Installed: $target"
  if ($moved) { Write-Output "Previous app preserved: $backup" }
} finally { Pop-Location }
