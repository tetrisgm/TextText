param([Parameter(Mandatory=$true)][int]$RootPid)
$ErrorActionPreference='Stop'
$out=@{observedUtc=[DateTime]::UtcNow.ToString('o');processes=@();error=$null}
try{
 $all=@(Get-CimInstance Win32_Process)
 $ids=[Collections.Generic.HashSet[int]]::new();[void]$ids.Add($RootPid)
 for($i=0;$i -lt 256;$i++){ $changed=$false;foreach($v in $all){if($ids.Contains([int]$v.ParentProcessId)-and $ids.Add([int]$v.ProcessId)){$changed=$true}};if(!$changed){break}}
 if($ids.Count -gt 256){throw 'process-bound'}
 foreach($id in @($ids|Sort-Object)){
  $meta=@($all|Where-Object ProcessId -eq $id)
  if($meta.Count -ne 1){throw 'unavailable'}
  $proc=Get-Process -Id $id -ErrorAction Stop
  $start=$proc.StartTime.ToUniversalTime().ToString('o')
  $hash=(Get-FileHash -LiteralPath $proc.Path -Algorithm SHA256).Hash.ToLowerInvariant()
  $proc.Refresh()
  if($proc.StartTime.ToUniversalTime().ToString('o') -ne $start){throw 'identity-changed'}
  $out.processes+=@{identity=@{pid=$id;parentPid=[int]$meta[0].ParentProcessId;startKey=$start;session=[string]$proc.SessionId;executableSha256=$hash};cpuSeconds=$proc.TotalProcessorTime.TotalSeconds;rssBytes=$proc.WorkingSet64;privateBytes=$proc.PrivateMemorySize64}
 }
 $after=@(Get-CimInstance Win32_Process)
 $ids2=[Collections.Generic.HashSet[int]]::new();[void]$ids2.Add($RootPid)
 for($i=0;$i -lt 256;$i++){ $changed=$false;foreach($v in $after){if($ids2.Contains([int]$v.ParentProcessId)-and $ids2.Add([int]$v.ProcessId)){$changed=$true}};if(!$changed){break}}
 if(!$ids.SetEquals($ids2)){throw 'tree-unavailable'}
 foreach($id in $ids){if(@($all|Where-Object ProcessId -eq $id)[0].ParentProcessId -ne @($after|Where-Object ProcessId -eq $id)[0].ParentProcessId){throw 'tree-unavailable'}}
}catch{$out.error=if($_.Exception.Message -in @('process-bound','identity-changed','tree-unavailable')){$_.Exception.Message}else{'unavailable'}}
$out|ConvertTo-Json -Depth 7 -Compress
