# Diagnostic-only, explicit opt-in. Callers must validate exact owned task and
# role-specific runtime selection BEFORE invoking this read-only collector.
function Write-ResourceOwnershipProof {
 param([string]$RequestPath,[string]$Session,[string]$TaskName,[int]$RuntimePid,[string]$ModulePath,[string]$ProcessKind,$ProfileScopeHash,[scriptblock]$VerifyTask,[hashtable]$ReadOnlyDependencies)
 $ErrorActionPreference='Stop'
 # Internal helper-unit seam only; task CLI never exposes this dictionary.
 $read=@{
  process={param($id) Get-Process -Id $id -ErrorAction Stop}
  metadata={param($id) Get-CimInstance Win32_Process -Filter ('ProcessId='+$id) -ErrorAction Stop}
  hash={param($path) (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
  timestamp={[Diagnostics.Stopwatch]::GetTimestamp()}
  frequency={[Diagnostics.Stopwatch]::Frequency}
  utc={[DateTime]::UtcNow}
  attributes={param($path) [IO.File]::GetAttributes($path)}
  acl={param($path) Get-Acl -LiteralPath $path}
 }
 if($ReadOnlyDependencies){
  if(@($ReadOnlyDependencies.Keys).Count-ne$read.Count){throw 'Read-only dependency schema refused'}
  foreach($key in $ReadOnlyDependencies.Keys){if(!$read.ContainsKey($key)-or$ReadOnlyDependencies[$key]-isnot[scriptblock]){throw 'Read-only dependency refused'}}
  $read=$ReadOnlyDependencies
 }
 function ReadDependency([string]$name,$argument){& $read[$name] $argument}
 if(!$VerifyTask){throw 'Exact owned task verifier required'}
 & $VerifyTask
 $start=ReadDependency 'timestamp';$frequency=ReadDependency 'frequency';$wallStart=ReadDependency 'utc'
 if($frequency-le0-or$start-lt0-or$wallStart-isnot[DateTime]){throw 'Collector clock unavailable'}
 function SafeResourcePath([string]$path){for($at=[IO.Path]::GetFullPath($path);$at;$at=[IO.Path]::GetDirectoryName($at)){try{$a=ReadDependency 'attributes' $at}catch [IO.FileNotFoundException]{continue}catch [IO.DirectoryNotFoundException]{continue};if($a-band[IO.FileAttributes]::ReparsePoint){throw 'Resource proof link refused'}}}
 SafeResourcePath $RequestPath;SafeResourcePath $Session;SafeResourcePath $ModulePath
 $currentSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $privateFound=$false
 for($at=[IO.Path]::GetFullPath($Session);$at;$at=[IO.Path]::GetDirectoryName($at)){
  $acl=ReadDependency 'acl' $at
  if(!$acl.GetOwner([Security.Principal.SecurityIdentifier]).Equals($currentSid)){throw 'Resource directory owner refused'}
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.AccessControlType-ne'Allow'-or$rule.IdentityReference.Value-notin@($currentSid.Value,'S-1-5-18')){throw 'Resource directory ACL refused'}}
  if($acl.AreAccessRulesProtected){$privateFound=$true;break}
 }
 if(!$privateFound){throw 'Protected resource ancestor required'}
 $requestBytes=[IO.File]::ReadAllBytes($RequestPath)
 if($requestBytes.Length-gt8192){throw 'Resource proof request bound'}
 $utf8=New-Object Text.UTF8Encoding($false,$true)
 $jsonText=$utf8.GetString($requestBytes).Trim()
 # Flat typed request only. Reject duplicate/case-alias/escaped property names
 # before PowerShell's case-insensitive object conversion can discard them.
 $propertyPattern='"([A-Za-z][A-Za-z0-9]*)"\s*:\s*(?:"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|null|[0-9]+)'
 $bodyPattern='^\{\s*(?:'+$propertyPattern+'(?:\s*,\s*'+$propertyPattern+')*)?\s*\}$'
 if($jsonText -cnotmatch $bodyPattern){throw 'Flat resource request refused'}
 $seen=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
 foreach($match in [regex]::Matches($jsonText,$propertyPattern)){if(!$seen.Add($match.Groups[1].Value)){throw 'Duplicate resource request key'}}
 $request=$jsonText|ConvertFrom-Json
 $keys=@('version','runId','role','sourceCommit','generation','sessionPath','moduleSha256','profileScopeHash','taskName','outputName')
 $actual=@($request.PSObject.Properties.Name|Sort-Object)
 foreach($key in @('runId','role','sourceCommit','sessionPath','moduleSha256','taskName','outputName')){if($request.$key-isnot[string]){throw 'Resource request scalar type refused'}}
 if(($request.version-isnot[int]-and$request.version-isnot[long])-or$request.version-ne1){throw 'Resource request version type refused'}
 if($null-ne$request.profileScopeHash-and$request.profileScopeHash-isnot[string]){throw 'Resource profile scope type refused'}
 if(($actual-join'|')-cne(($keys|Sort-Object)-join'|')-or$request.version-ne1-or$request.runId-cnotmatch'^[A-Za-z0-9_-]{1,100}$'-or$request.sourceCommit-cnotmatch'^[a-f0-9]{40}$'-or$request.generation-isnot[int]-or$request.generation-lt1-or$request.generation-gt999){throw 'Resource request schema refused'}
 if($request.role-cne$(if($ProcessKind-eq'headed-browser'){'pc-web'}else{'pc-app'})-or$request.sessionPath-cne$Session-or$request.taskName-cne$TaskName-or$request.moduleSha256-cnotmatch'^[a-f0-9]{64}$'-or$request.profileScopeHash-cne$ProfileScopeHash-or$request.outputName-cnotmatch'^resource-ownership-[A-Za-z0-9_-]{1,80}[.]json$'){throw 'Resource task scope refused'}
 $moduleHash=(ReadDependency 'hash' $ModulePath)
 if($moduleHash-cne$request.moduleSha256){throw 'Resource module changed'}
 $p=ReadDependency 'process' $RuntimePid
 $meta=ReadDependency 'metadata' $RuntimePid
 $startKey=$p.StartTime.ToUniversalTime().ToString('o');$exe=$p.Path;$sessionId=$p.SessionId
 if($RuntimePid-le1-or$sessionId-le0-or$p.HasExited){throw 'Interactive runtime unavailable'}
 SafeResourcePath $exe
 $exeHash=(ReadDependency 'hash' $exe)
 $p.Refresh();$fresh=ReadDependency 'process' $RuntimePid
 $metaAfter=ReadDependency 'metadata' $RuntimePid
 if($p.HasExited-or$fresh.StartTime.ToUniversalTime().ToString('o')-cne$startKey-or$fresh.Path-cne$exe-or$fresh.SessionId-ne$sessionId-or$metaAfter.ParentProcessId-ne$meta.ParentProcessId-or(ReadDependency 'hash' $ModulePath)-cne$moduleHash-or(ReadDependency 'hash' $exe)-cne$exeHash){throw 'Runtime identity changed'}
 & $VerifyTask
 $observed=ReadDependency 'utc';$end=ReadDependency 'timestamp'
 if($observed-isnot[DateTime]-or$observed-lt$wallStart-or($observed-$wallStart).TotalMilliseconds-gt5000-or$end-lt$start-or(($end-$start)*1000.0/$frequency)-gt5000-or[Math]::Abs(($observed-$wallStart).TotalMilliseconds-(($end-$start)*1000.0/$frequency))-gt1000){throw 'Resource capture incomplete'}
 SafeResourcePath $RequestPath
 $requestNow=[IO.File]::ReadAllBytes($RequestPath)
 if($requestNow.Length-ne$requestBytes.Length-or[Convert]::ToBase64String($requestNow)-cne[Convert]::ToBase64String($requestBytes)){throw 'Resource request changed during capture'}
 $root=[ordered]@{pid=$RuntimePid;parentPid=[int]$meta.ParentProcessId;startKey=$startKey;session=[string]$sessionId;executableSha256=$exeHash}
 $receipt=[ordered]@{version=1;kind='owned-role-runtime-v1';runId=$request.runId;role=$request.role;sourceCommit=$request.sourceCommit;generation=$request.generation;sessionPath=$Session;moduleSha256=$moduleHash;profileScopeHash=$request.profileScopeHash;taskName=$TaskName;root=$root}
 $bytes=$utf8.GetBytes(($receipt|ConvertTo-Json -Depth 6 -Compress));$output=Join-Path $Session $request.outputName;SafeResourcePath $output
 $stream=[IO.File]::Open($output,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 $sha=[Security.Cryptography.SHA256]::Create();try{$digest=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 $enrichment=[ordered]@{version=1;observedUtc=$observed.ToString('o');receiptSha256=$digest;sessionPath=$Session;moduleSha256=$moduleHash;profileScopeHash=$request.profileScopeHash;taskName=$TaskName;processKind=$ProcessKind;identity=$root}
 # Collector-local time/brackets only. Coordinator MUST NOT compare PC UTC to Mac now.
 $envelope=[ordered]@{version=1;scopeClaimsVerified=$false;authority='os-process-identity-only';collectorPlatform='win32';collectorNowMs=([DateTimeOffset]$observed).ToUnixTimeMilliseconds();monotonicStart=$start;monotonicEnd=$end;monotonicFrequency=$frequency;scope='bound-process-tree';rendererCoverage='unavailable';receiptSha256=$digest;os=$enrichment}
 $output2=$output+'.collector.json';$bytes2=$utf8.GetBytes(($envelope|ConvertTo-Json -Depth 8 -Compress));$stream=[IO.File]::Open($output2,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$stream.Write($bytes2,0,$bytes2.Length);$stream.Flush($true)}finally{$stream.Dispose()}
}
