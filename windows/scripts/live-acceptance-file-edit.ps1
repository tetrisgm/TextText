# Direct file actor for a coordinated acceptance run. No app or HTTP API is used.
param(
  [Parameter(Mandatory=$true)][string]$Plan,
  [Parameter(Mandatory=$true)][string]$Receipts,
  [ValidateRange(0,300000)][int]$OffsetMs = 7000
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression
$p = Get-Content -LiteralPath $Plan -Raw | ConvertFrom-Json
if (!$p.title.StartsWith('Six-client acceptance ') -or [IO.Path]::GetFileNameWithoutExtension($p.file) -ne $p.title -or $p.runId -notmatch '^[a-zA-Z0-9_-]{1,40}$') { throw 'Not a dedicated acceptance file.' }
$marker = '[pc-cli:' + $p.runId + ':00]'
$receipt = Join-Path $Receipts 'pc-cli.json'
$backup = Join-Path $Receipts 'pc-cli-before.textpack'
if (Test-Path -LiteralPath $Receipts) { throw 'Use a new receipt directory for each run.' }
if ((Test-Path -LiteralPath $receipt) -or (Test-Path -LiteralPath $backup)) { throw 'This CLI actor has already run; use a new run.' }
$due = [DateTimeOffset]::Parse($p.startUtc).AddMilliseconds($OffsetMs)
if ($due -lt [DateTimeOffset]::UtcNow -or $due -gt [DateTimeOffset]::UtcNow.AddMinutes(6)) { throw 'Expired or unbounded coordinated start.' }
New-Item -ItemType Directory -Path $Receipts -ErrorAction Stop | Out-Null
while ([DateTimeOffset]::UtcNow -lt $due) { Start-Sleep -Milliseconds 100 }
$bytes = [IO.File]::ReadAllBytes($p.file)
if ($bytes.Length -gt 64MB) { throw 'Acceptance fixture is too large.' }
$memory = [IO.MemoryStream]::new()
$memory.Write($bytes,0,$bytes.Length); $memory.Position = 0
$archive = [IO.Compression.ZipArchive]::new($memory,[IO.Compression.ZipArchiveMode]::Update,$true)
try {
  $entries = @($archive.Entries | Where-Object { $_.FullName -match '(^|/)text\.md$' })
  if ($entries.Count -ne 1 -or $entries[0].Length -gt 1MB) { throw 'Invalid acceptance Markdown.' }
  $entry = $entries[0]
  $reader = [IO.StreamReader]::new($entry.Open())
  try { $markdown = $reader.ReadToEnd() } finally { $reader.Dispose() }
  if ($markdown -notmatch ('(?m)^textTextId:\s*"?' + [regex]::Escape($p.itemId) + '"?\s*$')) { throw 'Identity mismatch.' }
  if ($markdown.Contains($marker)) { throw 'Marker already exists.' }
  $writer = [IO.StreamWriter]::new($entry.Open(),[Text.UTF8Encoding]::new($false))
  try { $writer.BaseStream.SetLength(0); $writer.Write($markdown + "`n" + $marker + "`n") } finally { $writer.Dispose() }
} finally { $archive.Dispose() }
$next = $memory.ToArray(); $memory.Dispose()
$temporary = $p.file + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
[IO.File]::WriteAllBytes($temporary,$next)
$sha = [Security.Cryptography.SHA256]::Create()
try {
  if ([Convert]::ToBase64String($sha.ComputeHash([IO.File]::ReadAllBytes($p.file))) -ne [Convert]::ToBase64String($sha.ComputeHash($bytes))) { throw 'File changed during CLI preparation; original not replaced.' }
  [IO.File]::Replace($temporary,$p.file,$backup)
  @{ utc=[DateTimeOffset]::UtcNow.ToString('o'); marker=$marker; mode='direct atomic text.md replacement' } | ConvertTo-Json | Set-Content -LiteralPath $receipt -Encoding UTF8
} finally { $sha.Dispose() }
