param([Parameter(Mandatory=$true)][string]$Assembly,
      [Parameter(Mandatory=$true)][string]$Config,
      [Parameter(Mandatory=$true)][string]$Session,
      [Parameter(Mandatory=$true)][string]$TaskName,
      [switch]$Finish)
$ErrorActionPreference = 'Stop'
if ($Finish) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($null -eq $task) { exit 0 }
  if ($task.State -eq 'Running') { throw 'Native test actor is still running; its session remains for recovery.' }
  $result = (Get-ScheduledTaskInfo -TaskName $TaskName).LastTaskResult
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  if ($result -ne 0) { throw "Native test actor exited with $result." }
  exit 0
}
$dotnet = Join-Path $env:LOCALAPPDATA 'TextTextBuild/dotnet/dotnet.exe'
foreach ($p in @($Assembly,$Config,$dotnet)) { if (!(Test-Path -LiteralPath $p -PathType Leaf)) { throw 'Required test input is missing.' } }
if (Get-Process TextText -ErrorAction SilentlyContinue) { throw 'Close the normal TextText app first.' }
$action = New-ScheduledTaskAction -Execute $dotnet -Argument "`"$Assembly`" --stress `"$Config`" `"$Session`""
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -Priority 4 -ExecutionTimeLimit (New-TimeSpan -Minutes 22)
Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $TaskName
$until = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $until) {
  $task = Get-ScheduledTask -TaskName $TaskName
  if ($task.State -eq 'Running') { exit 0 }
  Start-Sleep -Milliseconds 100
}
$code = (Get-ScheduledTaskInfo -TaskName $TaskName).LastTaskResult
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
throw "Native test actor did not start (result $code)."
