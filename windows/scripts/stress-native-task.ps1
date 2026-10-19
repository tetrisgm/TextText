param([Parameter(Mandatory=$true)][string]$Assembly,
      [Parameter(Mandatory=$true)][string]$Config,
      [Parameter(Mandatory=$true)][string]$Session,
      [Parameter(Mandatory=$true)][string]$TaskName,
      [switch]$Crash,
      [switch]$Finish,
      [switch]$InspectLifetime,
      [string]$ExpectedConfigSha256,
      [string]$ExpectedModuleSha256)
$ErrorActionPreference = 'Stop'
$dotnet = Join-Path $env:LOCALAPPDATA 'TextTextBuild/dotnet/dotnet.exe'
# Read the same immutable config supplied to the actor; no independent minutes override.
$configBytes = [IO.File]::ReadAllBytes($Config)
if ($configBytes.Length -gt 16384) { throw 'Native actor config exceeds the bound.' }
$configText = (New-Object Text.UTF8Encoding($false,$true)).GetString($configBytes)
$durationKeys = [regex]::Matches($configText, '"(?i:TotalMinutes)"\s*:')
if ($durationKeys.Count -gt 1) { throw 'Native actor duration is ambiguous.' }
$configValue = $configText | ConvertFrom-Json
$parsedDurationKeys = @($configValue.PSObject.Properties | Where-Object { $_.Name -ieq 'TotalMinutes' })
if ($parsedDurationKeys.Count -ne $durationKeys.Count) { throw 'Native actor duration property spelling is unsupported.' }
$duration = 20
if ($durationKeys.Count -eq 1) {
  $value = $configValue.TotalMinutes
  if (($value -isnot [int] -and $value -isnot [long]) -or $value -lt 1 -or $value -gt 120) { throw 'Native actor duration is invalid.' }
  $duration = [int]$value
}
$executionMinutes = [Math]::Max(22, $duration + 2)
$hasher = [Security.Cryptography.SHA256]::Create()
try { $boundConfigHash = ([BitConverter]::ToString($hasher.ComputeHash($configBytes))).Replace('-','') } finally { $hasher.Dispose() }
$boundAssemblyHash = (Get-FileHash -LiteralPath $Assembly -Algorithm SHA256).Hash
function AssertInputIdentity {
  if ($ExpectedConfigSha256 -and ($ExpectedConfigSha256 -cnotmatch '^[a-f0-9]{64}$' -or $ExpectedConfigSha256 -cne $boundConfigHash.ToLowerInvariant())) { throw 'Native caller config identity differs.' }
  if ($ExpectedModuleSha256 -and ($ExpectedModuleSha256 -cnotmatch '^[a-f0-9]{64}$' -or $ExpectedModuleSha256 -cne $boundAssemblyHash.ToLowerInvariant())) { throw 'Native caller module identity differs.' }
  if ((Get-FileHash -LiteralPath $Config -Algorithm SHA256).Hash -cne $boundConfigHash -or
      (Get-FileHash -LiteralPath $Assembly -Algorithm SHA256).Hash -cne $boundAssemblyHash) { throw 'Native task inputs changed.' }
}
AssertInputIdentity
function AssertLifetime($task) {
  if ($null -eq $task -or @($task.Actions).Count -ne 1 -or
      $task.Actions[0].Execute -cne $dotnet -or
      $task.Actions[0].Arguments -cne "`"$Assembly`" --stress `"$Config`" `"$Session`"") { throw 'Native task action differs from the requested actor.' }
  if ([Xml.XmlConvert]::ToTimeSpan($task.Settings.ExecutionTimeLimit).TotalMinutes -ne $executionMinutes) { throw 'Native task lifetime differs from actor config.' }
  AssertInputIdentity
}
if ($InspectLifetime) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  AssertLifetime $task
  # Scope claims are checked against actual settings and unchanged input bytes above.
  [ordered]@{ version=1; taskName=$TaskName; session=$Session; actorMinutes=$duration;
    taskMinutes=$executionMinutes; actualLimit=$task.Settings.ExecutionTimeLimit;
    configSha256=$boundConfigHash.ToLowerInvariant(); moduleSha256=$boundAssemblyHash.ToLowerInvariant() } | ConvertTo-Json -Compress
  exit 0
}
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
  # Wait on the validated process object. A just-terminated PID may briefly
  # remain enumerable (or be reused); neither proves this actor is still open.
  if (!$process.WaitForExit(15000)) { throw 'Native actor remained running after the crash signal.' }
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($null -ne $task) { AssertLifetime $task; Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
  exit 0
}
if ($Finish) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($null -eq $task) { exit 0 }
  AssertLifetime $task
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
$settings = New-ScheduledTaskSettingsSet -Priority 4 -ExecutionTimeLimit (New-TimeSpan -Minutes $executionMinutes)
AssertInputIdentity
Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings | Out-Null
AssertLifetime (Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop)
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
