# Explicit developer test. Compiles in caller session; only the test executable
# runs in a temporary interactive task so WebView2 has a real desktop window.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$dotnet = Join-Path $env:LOCALAPPDATA 'TextTextBuild/dotnet/dotnet.exe'
$taskName = 'TextText-native-smoke-' + [guid]::NewGuid().ToString('N')
$receipts = Join-Path $root ('windows/build/smoke-receipts-' + [guid]::NewGuid().ToString('N'))
Push-Location $root
try {
  & node windows/scripts/build-smoke-ui.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Smoke UI bundle failed.' }
  & $dotnet build windows/TextText.Smoke/TextText.Smoke.csproj --configuration Release
  if ($LASTEXITCODE -ne 0) { throw 'Native smoke compile failed.' }
  $assembly = Join-Path $root 'windows/TextText.Smoke/bin/Release/net10.0-windows/TextText.Smoke.dll'
  $bundle = Join-Path $root 'windows/build/smoke-ui'
  $action = New-ScheduledTaskAction -Execute $dotnet -Argument "`"$assembly`" `"$bundle`" `"$receipts`""
  $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -Priority 4 -ExecutionTimeLimit (New-TimeSpan -Seconds 100)
  Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings | Out-Null
  if ((Get-ScheduledTask -TaskName $taskName).Settings.Priority -ne 4) { throw 'Desktop smoke requires normal interactive process/I/O/memory priority.' }
  Start-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 3
  $deadline = (Get-Date).AddSeconds(100)
  while ((Get-Date) -lt $deadline -and (Get-ScheduledTask -TaskName $taskName).State -eq 'Running') { Start-Sleep -Seconds 1 }
  $result = (Get-ScheduledTaskInfo -TaskName $taskName).LastTaskResult
  if (Test-Path (Join-Path $receipts 'desktop-smoke.log')) { Get-Content (Join-Path $receipts 'desktop-smoke.log') -Tail 30 }
  if ($result -ne 0) { throw "Native desktop smoke failed ($result). Receipts: $receipts" }
  $report = Get-Content (Join-Path $receipts 'desktop-smoke.json') -Raw | ConvertFrom-Json
  if (!$report.ok) { throw "Native desktop assertions failed. Receipts: $receipts" }
  $closeReport = Get-Content (Join-Path $receipts 'main-window-close.json') -Raw | ConvertFrom-Json
  if (!$closeReport.ok) { throw "Native close assertions failed. Receipts: $receipts" }
  Write-Output "Native desktop smoke passed. Receipts: $receipts"
} finally {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  Pop-Location
}
