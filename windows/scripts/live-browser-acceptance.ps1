# Explicit one-shot visible Edge test. No build, install or credential changes.
param(
  [Parameter(Mandatory=$true)][string]$Runner,
  [Parameter(Mandatory=$true)][string]$Plan,
  [Parameter(Mandatory=$true)][string]$Receipts
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$node = (Get-Command node.exe).Source
foreach ($file in @($Runner,$Plan)) { if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing test input: $file" } }
if (Test-Path -LiteralPath $Receipts) { throw 'Use a new receipt directory.' }
$taskName = 'TextText-browser-acceptance-' + [guid]::NewGuid().ToString('N')
try {
  $action = New-ScheduledTaskAction -Execute $node -Argument "`"$Runner`" `"$Plan`" `"$Receipts`""
  $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -Priority 4 -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
  Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 3
  $deadline = (Get-Date).AddMinutes(10)
  while ((Get-Date) -lt $deadline -and (Get-ScheduledTask -TaskName $taskName).State -eq 'Running') { Start-Sleep -Seconds 1 }
  if ((Get-ScheduledTask -TaskName $taskName).State -eq 'Running') { throw 'Browser test still running; inspect the same task and receipt directory.' }
  $result = (Get-ScheduledTaskInfo -TaskName $taskName).LastTaskResult
  if ($result -ne 0) { throw "Browser acceptance failed ($result). Inspect $Receipts; profile journals are preserved." }
  $report = Get-Content -LiteralPath (Join-Path $Receipts 'result.json') -Raw | ConvertFrom-Json
  if (!$report.ok) { throw "Browser assertions failed. Inspect $Receipts." }
  Write-Output "Visible Edge acceptance passed. Receipts: $Receipts"
} finally {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
}
