# Stopped-state backup requires PowerShell 7 for long-path reparse inspection.
param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Stopped backup requires PowerShell 7.' }
if (Get-Process TextText -ErrorAction SilentlyContinue) { throw 'Close TextText normally before backup.' }
New-Item -ItemType Directory $Destination | Out-Null
$sources = @{vault=(Join-Path $env:USERPROFILE 'TextText'); Sync=(Join-Path $env:LOCALAPPDATA 'TextText/Sync')}
foreach ($name in $sources.Keys) {
  $source = $sources[$name]
  $entries = @((Get-Item -LiteralPath $source -Force)) + @(Get-ChildItem -LiteralPath $source -Force -Recurse)
  if ($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Backup requires review of a reparse point; nothing installed.' }
  & node (Join-Path $PSScriptRoot 'backup-directory.mjs') $source (Join-Path $Destination $name)
  if ($LASTEXITCODE -ne 0) { throw "Backup mismatch or copy failure: $name" }
}
$source = Join-Path $env:LOCALAPPDATA 'TextText/account.dpapi'
if ((Get-Item -LiteralPath $source -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Account reparse point requires review.' }
$before = (Get-FileHash -LiteralPath $source).Hash
$target = Join-Path $Destination 'account.dpapi'
Copy-Item -LiteralPath $source -Destination $target
if ($before -ne (Get-FileHash -LiteralPath $source).Hash -or $before -ne (Get-FileHash -LiteralPath $target).Hash) { throw 'Account backup mismatch.' }
if (Get-Process TextText -ErrorAction SilentlyContinue) { throw 'TextText restarted during backup.' }
