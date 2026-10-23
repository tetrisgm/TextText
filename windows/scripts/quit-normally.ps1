# The release caller runs this quit-only helper in the owner's interactive session.
param([string]$ReceiptPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-TextTextNormalQuit([object[]]$Processes, [int]$SessionId, [int]$TimeoutMs = 120000) {
  foreach ($app in $Processes) {
    if ($app.SessionId -ne $SessionId) { throw 'TextText is in another desktop session; no quit requested.' }
  }
  $timer = [Diagnostics.Stopwatch]::StartNew()
  foreach ($app in $Processes) {
    if ($app.HasExited) { continue }
    if (!$app.CloseMainWindow() -and !$app.HasExited) { throw 'TextText refused the normal close request; left running.' }
    $remaining = [Math]::Max(0, $TimeoutMs - [int]$timer.ElapsedMilliseconds)
    if (!$app.WaitForExit($remaining)) { throw 'TextText did not quit normally before the deadline; left running.' }
  }
}

function Assert-TextTextQuitReceipt([string]$Path, [object[]]$RemainingProcesses) {
  if (!(Test-Path -LiteralPath $Path)) { throw 'Normal quit receipt is missing; installation refused.' }
  $report = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
  if ($report.ok -ne $true) { throw "Normal quit failed; installation refused: $($report.error)" }
  if ($RemainingProcesses.Count -ne 0) { throw 'TextText is still running; installation refused.' }
}

if ($MyInvocation.InvocationName -ne '.') {
  if (!$ReceiptPath) { throw 'Provide a new receipt path.' }
  if (Test-Path -LiteralPath $ReceiptPath) { throw 'Quit receipt already exists.' }
  try {
    Invoke-TextTextNormalQuit @(Get-Process TextText -ErrorAction SilentlyContinue) (Get-Process -Id $PID).SessionId
    if (Get-Process TextText -ErrorAction SilentlyContinue) { throw 'TextText restarted during normal quit.' }
    @{ok=$true} | ConvertTo-Json | Set-Content -LiteralPath $ReceiptPath
  } catch {
    @{ok=$false; error=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath $ReceiptPath
    Write-Error $_ -ErrorAction Continue
    exit 1
  }
}
