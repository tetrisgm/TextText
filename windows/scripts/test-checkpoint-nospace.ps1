# Explicit manual test. Creates and fills only a new 64 MiB virtual disk.
# Detaches its own image in finally; retains the image and failure receipts.
param([ValidateSet('checkpoint','adoption')][string]$Scenario='checkpoint')
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$dotnet=Join-Path $env:LOCALAPPDATA 'TextTextBuild/dotnet/dotnet.exe'
if(!(Test-Path $dotnet)){throw 'Existing .NET SDK is required'}
$variable=if($Scenario -eq 'adoption'){'TEXTTEXT_ADOPTION_NOSPACE_VOLUME'}else{'TEXTTEXT_CHECKPOINT_NOSPACE_VOLUME'}
$previousVolume=[Environment]::GetEnvironmentVariable($variable)
function Invoke-CoreProcess([string]$arguments,[string]$label) {
 $info=New-Object Diagnostics.ProcessStartInfo
 $info.FileName=$dotnet;$info.Arguments=$arguments;$info.WorkingDirectory=$root
 $info.UseShellExecute=$false;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.CreateNoWindow=$true
 $process=New-Object Diagnostics.Process;$process.StartInfo=$info
 try {
  if(!$process.Start()){throw 'Core process did not start'}
  $out=$process.StandardOutput.ReadToEndAsync();$err=$process.StandardError.ReadToEndAsync()
  if(!$process.WaitForExit(120000)){$process.Kill();throw 'Bounded core process timeout'}
  [IO.File]::WriteAllText((Join-Path $base ($label+'.log')),$out.GetAwaiter().GetResult())
  [IO.File]::WriteAllText((Join-Path $base ($label+'-error.log')),$err.GetAwaiter().GetResult())
  if($process.ExitCode -ne 0){Get-Content (Join-Path $base ($label+'.log')) -Tail 12;Get-Content (Join-Path $base ($label+'-error.log')) -Tail 20;throw ('Core process failed: '+$label)}
 } finally {$process.Dispose()}
}
$base=Join-Path $env:TEMP ('texttext-checkpoint-enospc-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $base|Out-Null
$image=Join-Path $base 'isolated.vhd';if(Test-Path $image){throw 'Image already exists'}
$project=Join-Path $root 'windows/TextText.Core.Tests/TextText.Core.Tests.csproj'
Invoke-CoreProcess ('build "'+$project+'" --configuration Release --disable-build-servers /p:UseSharedCompilation=false') 'core-build'
$script=Join-Path $base 'create.txt'
@("create vdisk file=`"$image`" maximum=64 type=fixed","select vdisk file=`"$image`"","attach vdisk","exit")|Set-Content $script -Encoding ASCII
try {
 & diskpart /s $script > (Join-Path $base 'diskpart.log') 2>&1
 if($LASTEXITCODE -ne 0){throw 'New-image setup failed'}
 $disk=Get-DiskImage -ImagePath $image | Get-Disk
 if($disk.IsBoot -or $disk.IsSystem -or $disk.Size -lt 60MB -or $disk.Size -gt 70MB -or $disk.PartitionStyle -ne 'RAW'){throw 'Refusing anything except the fresh tiny virtual disk'}
 $disk|Initialize-Disk -PartitionStyle MBR
 $partition=New-Partition -DiskNumber $disk.Number -UseMaximumSize -AssignDriveLetter
 $partition|Format-Volume -FileSystem NTFS -NewFileSystemLabel 'TTCheckpointFixture' -Confirm:$false|Out-Null
 if(!$partition.DriveLetter){throw 'New test partition has no drive letter'}
 $volume=([string]$partition.DriveLetter)+':\'
 [IO.File]::WriteAllText((Join-Path $volume '.texttext-checkpoint-test-volume'),"texttext checkpoint ENOSPC fixture v1`n")
 [Environment]::SetEnvironmentVariable($variable,$volume)
 [pscustomobject]@{Image=$image;DiskNumber=$disk.Number;Volume=$volume;Size=$disk.Size}|ConvertTo-Json|Set-Content (Join-Path $base 'fixture.json')
 $assembly=Join-Path $root 'windows/TextText.Core.Tests/bin/Release/net10.0/TextText.Core.Tests.dll'
 Invoke-CoreProcess ('"'+$assembly+'"') 'core-test'
 $text=[IO.File]::ReadAllText((Join-Path $base 'core-test.log'))
 $expected=if($Scenario -eq 'adoption'){'PASS real disk-full adoption resumes original pending work'}else{'PASS real disk-full repair retries and reopens retained pending work'}
 if(!$text.Contains($expected)){throw 'Required real disk-full test did not execute'}
 Select-String -SimpleMatch -Pattern 'real disk-full' -Path (Join-Path $base 'core-test.log')
 Write-Output "Isolated image and receipts retained at $base"
} finally {
 [Environment]::SetEnvironmentVariable($variable,$previousVolume)
 if(Test-Path $image){$i=Get-DiskImage -ImagePath $image -ErrorAction SilentlyContinue;if($i.Attached){Dismount-DiskImage -ImagePath $image|Out-Null}}
}
