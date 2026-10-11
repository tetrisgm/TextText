param([Parameter(Mandatory=$true)][string]$Assembly,
      [Parameter(Mandatory=$true)][string]$Config,
      [Parameter(Mandatory=$true)][string]$Session,
      [Parameter(Mandatory=$true)][string]$TaskName,
      [switch]$Crash,
      [switch]$Finish)
$ErrorActionPreference = 'Stop'
$dotnet = Join-Path $env:LOCALAPPDATA 'TextTextBuild/dotnet/dotnet.exe'
if ($Crash) {
  $pidFile = Join-Path $Session 'actor.pid'
  if (!(Test-Path -LiteralPath $pidFile -PathType Leaf)) { throw 'Native actor PID evidence is missing.' }
  $actorPid = 0
  if (![int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$actorPid) -or $actorPid -le 0) { throw 'Native actor PID evidence is invalid.' }
  $process = Get-Process -Id $actorPid -ErrorAction Stop
  if ($process.Path -ne $dotnet) { throw 'Native actor PID does not identify the private test runtime.' }
  $command = (Get-CimInstance Win32_Process -Filter "ProcessId=$actorPid").CommandLine
  if (!$command -or !$command.Contains($Assembly) -or !$command.Contains($Session) -or !$command.Contains('--stress')) {
    throw 'Native actor PID no longer belongs to this test session.'
  }
  Stop-Process -Id $actorPid -Force
  Wait-Process -Id $actorPid -Timeout 15 -ErrorAction SilentlyContinue
  if (Get-Process -Id $actorPid -ErrorAction SilentlyContinue) { throw 'Native actor remained running after the crash signal.' }
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($null -ne $task) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
  exit 0
}
if ($Finish) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($null -eq $task) { exit 0 }
  if ($task.State -eq 'Running') { throw 'Native test actor is still running; its session remains for recovery.' }
  $result = (Get-ScheduledTaskInfo -TaskName $TaskName).LastTaskResult
  if ($result -ne 0) { throw "Native test actor exited with $result; its task and session remain for recovery." }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  exit 0
}
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
