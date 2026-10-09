# Explicit test invocation only. Runs a prebuilt test executable once in the
# signed-in desktop. Does not build, install, change credentials or select a root.
param(
  [Parameter(Mandatory=$true)][string]$Assembly,
  [Parameter(Mandatory=$true)][string]$Plan,
  [Parameter(Mandatory=$true)][string]$Receipts
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$dotnet = Join-Path $env:LOCALAPPDATA 'TextTextBuild/dotnet/dotnet.exe'
foreach ($file in @($Assembly,$Plan,$dotnet)) { if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing input: $file" } }
if (Test-Path -LiteralPath $Receipts) { throw 'Use a new receipt directory for each run.' }
if (Get-Process TextText -ErrorAction SilentlyContinue) { throw 'Close the normal TextText app first; preserve any pending edits.' }
$taskName = 'TextText-live-acceptance-' + [guid]::NewGuid().ToString('N')
try {
  $action = New-ScheduledTaskAction -Execute $dotnet -Argument "`"$Assembly`" `"$Plan`" `"$Receipts`""
  $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -Priority 4 -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
  Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 3
  $deadline = (Get-Date).AddMinutes(15)
  while ((Get-Date) -lt $deadline -and (Get-ScheduledTask -TaskName $taskName).State -eq 'Running') { Start-Sleep -Seconds 1 }
  $result = (Get-ScheduledTaskInfo -TaskName $taskName).LastTaskResult
  if ($result -ne 0) { throw "Live desktop acceptance failed ($result). Inspect $Receipts; preserve pending journals." }
  $report = Get-Content -LiteralPath (Join-Path $Receipts 'result.json') -Raw | ConvertFrom-Json
  if (!$report.ok) { throw "Live desktop assertions failed. Inspect $Receipts." }
  Write-Output "Live desktop acceptance passed. Receipts: $Receipts"
} finally {
  # Removing the registration never deletes app state or recovery journals.
  # Do not terminate a window that refused to close because flushing failed.
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
}
