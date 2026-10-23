# Explicit override supports an existing portable runtime without assuming its owner.
function Get-TextTextBackupPowerShell {
  param([string]$ExplicitPath)
  if ($ExplicitPath -and ![IO.Path]::IsPathRooted($ExplicitPath)) { throw 'PowerShell7Path must be an absolute Windows path.' }
  $candidates = @($ExplicitPath, $env:TEXTTEXT_POWERSHELL7)
  $command = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($command) { $candidates += $command.Source }
  $candidates += (Join-Path $env:ProgramFiles 'PowerShell/7/pwsh.exe')
  foreach ($candidate in $candidates) {
    if (!$candidate -or !(Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    $version = & $candidate -NoProfile -Command '$PSVersionTable.PSVersion.Major'
    if ($LASTEXITCODE -eq 0 -and "$version" -match '^\d+$' -and [int]$version -ge 7) { return $candidate }
  }
  throw 'Windows release backup requires PowerShell 7. Install pwsh or set TEXTTEXT_POWERSHELL7 to an existing pwsh.exe before starting the release.'
}
