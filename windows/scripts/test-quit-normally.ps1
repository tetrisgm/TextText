# Pure process doubles only. Never closes an app or registers a task.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'quit-normally.ps1')

function Fake-App([bool]$CloseResult = $true, [bool]$WaitResult = $true, [int]$Session = 4) {
  $app = [pscustomobject]@{SessionId=$Session; HasExited=$false; CloseResult=$CloseResult; WaitResult=$WaitResult; CloseCalls=0; WaitCalls=0}
  $app | Add-Member ScriptMethod CloseMainWindow { $this.CloseCalls++; return $this.CloseResult }
  $app | Add-Member ScriptMethod WaitForExit { param($Timeout); $this.WaitCalls++; return $this.WaitResult }
  return $app
}
function Expect-Refusal([scriptblock]$Action, [string]$Message) {
  $caught = $false
  try { & $Action } catch {
    if ($_.Exception.Message -notlike "*$Message*") { throw }
    $caught = $true
  }
  if (!$caught) { throw "Expected refusal: $Message" }
}

$app = Fake-App
Invoke-TextTextNormalQuit @($app) 4
if ($app.CloseCalls -ne 1 -or $app.WaitCalls -ne 1) { throw 'Normal close was not requested and awaited.' }
$app = Fake-App -CloseResult $false
Expect-Refusal { Invoke-TextTextNormalQuit @($app) 4 } 'refused the normal close'
if ($app.WaitCalls -ne 0) { throw 'Refused close unexpectedly continued.' }
$app = Fake-App -WaitResult $false
Expect-Refusal { Invoke-TextTextNormalQuit @($app) 4 } 'before the deadline'
$local = Fake-App
$foreign = Fake-App -Session 9
Expect-Refusal { Invoke-TextTextNormalQuit @($local, $foreign) 4 } 'another desktop session'
if ($local.CloseCalls -ne 0 -or $foreign.CloseCalls -ne 0) { throw 'Session refusal happened after sending close.' }
$app = Fake-App
$app.HasExited = $true
Invoke-TextTextNormalQuit @($app) 4
if ($app.CloseCalls -ne 0) { throw 'Already exited process received close.' }
Invoke-TextTextNormalQuit @() 4

$fixture = Join-Path ([IO.Path]::GetTempPath()) ('texttext-normal-quit-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$proof = Join-Path $fixture 'receipt.json'
Expect-Refusal { Assert-TextTextQuitReceipt $proof @() } 'receipt is missing'
@{ok=$false;error='Fixture refusal'} | ConvertTo-Json | Set-Content -LiteralPath $proof
Expect-Refusal { Assert-TextTextQuitReceipt $proof @() } 'Fixture refusal'
@{ok=$true} | ConvertTo-Json | Set-Content -LiteralPath $proof
Expect-Refusal { Assert-TextTextQuitReceipt $proof @((Fake-App)) } 'still running'
Assert-TextTextQuitReceipt $proof @()
Write-Output 'Normal quit regressions passed (process doubles; no installed acceptance).'
