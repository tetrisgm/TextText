param(
  [Parameter(Mandatory=$true)][string]$Driver,
  [Parameter(Mandatory=$true)][string]$Config,
  [Parameter(Mandatory=$true)][string]$Session,
  [Parameter(Mandatory=$true)][string]$Node,
  [Parameter(Mandatory=$true)][string]$TaskName,
  [int]$MaxMs=420000,
  [switch]$Finish,
  [switch]$Inspect,
  [string]$ExpectedFeatures
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

function SafeAncestors([string]$Path) {
  for($at=[IO.Path]::GetFullPath($Path);$at;$at=[IO.Path]::GetDirectoryName($at)) {
    try { $attributes=[IO.File]::GetAttributes($at) }
    catch [IO.FileNotFoundException] { continue }
    catch [IO.DirectoryNotFoundException] { continue }
    if(($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'Browser test links refused'
    }
  }
}
function PrivateAcl([string]$Path) {
  $acl=Get-Acl -LiteralPath $Path
  $user=[Security.Principal.WindowsIdentity]::GetCurrent().User
  if(!$acl.AreAccessRulesProtected -or !$acl.GetOwner([Security.Principal.SecurityIdentifier]).Equals($user)) {
    throw 'Protected current-user runner directory required'
  }
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
    if($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -notin @($user.Value,'S-1-5-18')) {
      throw 'Unexpected runner principal'
    }
  }
}
function Audit([string]$Stage,[DateTime]$Since) {
  $events=@()
  try {
    $events=@(Get-WinEvent -FilterHashtable @{
      LogName='Security'; Id=4625,4740; StartTime=$Since
    } -MaxEvents 10000 -ErrorAction Stop)
  } catch {
    if($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') {
      throw 'Security query unavailable'
    }
  }
  if($events.Count -ge 10000) { throw 'Security query bound' }
  $matched=@()
  foreach($event in $events) {
    $data=[xml]$event.ToXml()
    $users=@($data.Event.EventData.Data | Where-Object Name -eq 'TargetUserName')
    foreach($user in $users) {
      if($user.InnerText -ieq [Environment]::UserName) {
        $matched+=@{id=$event.Id;utc=$event.TimeCreated.ToUniversalTime().ToString('o')}
      }
    }
  }
  $registry='HKLM:\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'
  $policy=[string](Get-ItemProperty -LiteralPath $registry).'*'
  @{
    utc=[DateTime]::UtcNow.ToString('o')
    matched=$matched
    mitigationPresent=$policy.Contains('AutofillAiWalletPrivatePasses')
  } | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $Session ('security-'+$Stage+'.json'))
  if($matched.Count -or !$policy.Contains('AutofillAiWalletPrivatePasses')) {
    throw 'Security/mitigation refused'
  }
}
function OwnedTask {
  $task=Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $record=Get-Content -LiteralPath (Join-Path $Session 'task.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if(@($task.Actions).Count -ne 1 -or $task.Actions.Execute -cne $Node -or
      $task.Actions.Arguments -cne $arguments -or $record.task -cne $TaskName -or
      $record.node -cne $Node -or
      $record.nodeSha256 -cne (Get-FileHash -LiteralPath $Node -Algorithm SHA256).Hash.ToLowerInvariant()) {
    throw 'Owned task identity changed'
  }
  return $task
}
foreach($path in @($Driver,$Config,$Session,$Node)) { SafeAncestors $path }
$configValue=Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
$profile=[IO.Path]::GetFullPath([string]$configValue.profile)
SafeAncestors $profile
if($profile -ne [IO.Path]::Combine([IO.Path]::GetFullPath($Session),'browser-profile')) {
  throw 'Owned profile scope refused'
}
if($TaskName -notmatch '^TextText-stress-browser-[a-f0-9]{32}$') {
  throw 'Owned task name refused'
}
$child=Join-Path $PSScriptRoot 'stress-browser-child.mjs'
$arguments='"'+$child+'" "'+$Driver+'" "'+$Config+'" "'+$Session+'" '+$MaxMs

if($Inspect) {
  $null=OwnedTask
  $record=Get-Content -LiteralPath (Join-Path $Session 'child-ready.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $process=Get-Process -Id $record.pid -ErrorAction Stop
  $command=(Get-CimInstance Win32_Process -Filter ('ProcessId='+$record.pid)).CommandLine
  if($process.Path -cne $Node -or $process.SessionId -le 0 -or
      $process.SessionId -ne $record.sessionId -or
      $process.StartTime.ToUniversalTime().ToString('o') -cne $record.startUtc -or
      !$command -or !$command.Contains($child) -or !$command.Contains($Session)) {
    throw 'Exact interactive child changed'
  }
  $rows=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object {
    $_.CommandLine -and
    $_.CommandLine.Replace([char]92,[char]47).Contains($profile.Replace([char]92,[char]47)) -and
    $_.CommandLine -notmatch '--type='
  })
  if($rows.Count -ne 1 -or $rows[0].SessionId -ne $process.SessionId -or
      $rows[0].CommandLine -match '--headless') {
    throw 'Owned headed browser unavailable'
  }
  $flags=@([regex]::Matches($rows[0].CommandLine,'--disable-features=("[^"]*"|[^\s]+)') |
    ForEach-Object { $_.Groups[1].Value.Trim('"') })
  if(!$flags.Count -or $flags[-1] -cne $ExpectedFeatures) {
    throw 'Browser feature defaults changed'
  }
  $generation=[guid]::NewGuid().ToString('N')
  Audit ('generation-'+$generation) (Get-Item -LiteralPath $Session).CreationTime
  @{
    pid=$rows[0].ProcessId
    session=$rows[0].SessionId
    headless=$false
    features=$flags[-1]
  } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Session ('runtime-'+$generation+'.json'))
  exit 0
}
if($Finish) {
  $task=OwnedTask
  if($task.State -eq 'Running') { throw 'Owned task exit not proven' }
  $result=Get-ScheduledTaskInfo -TaskName $TaskName
  Audit ('after-'+[guid]::NewGuid().ToString('N')) (Get-Item -LiteralPath $Session).CreationTime
  $adapter=Get-Content -LiteralPath (Join-Path $Session 'adapter-pid.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $remaining=@(Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -eq $adapter.pid -or
    ($_.Name -eq 'node.exe' -and $_.CommandLine -and
      $_.CommandLine.Contains($child) -and $_.CommandLine.Contains($Session)) -or
    ($_.Name -eq 'msedge.exe' -and $_.CommandLine -and
      $_.CommandLine.Replace([char]92,[char]47).Contains($profile.Replace([char]92,[char]47)))
  })
  if($remaining.Count -or $result.LastTaskResult -ne 0) {
    throw 'Owned runtime failed or remains; retain task/session'
  }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  @{
    taskAbsent=$true; ownedProcesses=0; forceTermination=$false
  } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Session 'cleanup.json')
  exit 0
}
$parent=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Session))
if(!(Test-Path -LiteralPath $parent -PathType Container)) {
  throw 'Explicit runner parent missing'
}
PrivateAcl $parent
if($MaxMs -lt 1000 -or $MaxMs -gt 7200000 -or
    (Test-Path -LiteralPath $Session) -or
    (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
  throw 'Fresh bounded task/session required'
}
if(Get-Process TextText -ErrorAction SilentlyContinue) { throw 'Close normal TextText first' }
New-Item -ItemType Directory -Path $Session -ErrorAction Stop | Out-Null
$user=[Security.Principal.WindowsIdentity]::GetCurrent().User
$system=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($user)
$acl.SetAccessRuleProtection($true,$false)
foreach($sid in @($user,$system)) {
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
    $sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'
  )))
}
Set-Acl -LiteralPath $Session -AclObject $acl
PrivateAcl $Session
Audit 'before' ([DateTime]::UtcNow.AddMinutes(-15))
$action=New-ScheduledTaskAction -Execute $Node -Argument $arguments
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
# Supervision requests orderly shutdown; an OS execution limit must never kill a guarded editor.
$settings=New-ScheduledTaskSettingsSet -Priority 4 -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings | Out-Null
@{
  task=$TaskName; node=$Node
  nodeSha256=(Get-FileHash -LiteralPath $Node -Algorithm SHA256).Hash.ToLowerInvariant()
  session=$Session; forceTermination=$false
} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Session 'task.json')
Start-ScheduledTask -TaskName $TaskName
