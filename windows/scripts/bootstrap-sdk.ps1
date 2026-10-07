$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:LOCALAPPDATA 'TextTextBuild/dotnet'
if (Test-Path (Join-Path $destination 'dotnet.exe')) { & (Join-Path $destination 'dotnet.exe') --version; exit $LASTEXITCODE }
$installer = Join-Path $env:TEMP ('texttext-dotnet-' + [guid]::NewGuid() + '.ps1')
try {
  Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile $installer
  & $installer -Channel '10.0' -InstallDir $destination -NoPath
  if (!(Test-Path (Join-Path $destination 'dotnet.exe'))) { throw 'SDK installation failed.' }
} finally { Remove-Item $installer -ErrorAction SilentlyContinue }
& (Join-Path $destination 'dotnet.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'Installed SDK could not start.' }
