param([Parameter(Mandatory=$true)][string]$PowerShell7)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'backup-runtime.ps1')
$old=$env:TEXTTEXT_POWERSHELL7
try {
  $env:TEXTTEXT_POWERSHELL7=$PowerShell7
  if ((Get-TextTextBackupPowerShell) -ne $PowerShell7) { throw 'Explicit runtime was not selected.' }
  Write-Output 'PASS explicit existing PowerShell7 is selected'
  function Get-Command { param($Name,$ErrorAction) return $null }
  function Test-Path { param($LiteralPath,$PathType) return $false }
  $refused=$false
  try { Get-TextTextBackupPowerShell | Out-Null } catch { $refused=$_.Exception.Message -like '*requires PowerShell 7*' }
  if (!$refused) { throw 'Missing runtime was not refused clearly.' }
  Write-Output 'PASS missing runtime fails clearly before release work'
} finally { $env:TEXTTEXT_POWERSHELL7=$old }
