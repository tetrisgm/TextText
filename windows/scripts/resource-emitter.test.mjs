import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const read=n=>readFileSync(new URL(n,import.meta.url),'utf8');
const browser=read('stress-browser-task.ps1'),native=read('stress-native-task.ps1'),helper=read('resource-ownership-task.ps1');
test('browser enrichment is explicit inspect-only after existing owned task, headed/profile/mitigation checks',()=>{
 assert.match(browser,/if\(\$OwnershipRequest -and !\$Inspect\)/);
 const at=browser.indexOf('if($OwnershipRequest) {');assert.ok(at>browser.indexOf("Browser feature defaults changed"));
 assert.ok(at>browser.indexOf('Owned headed browser unavailable'));assert.match(browser,/-RuntimePid \$rows\[0\].ProcessId -ModulePath \$Driver/);assert.match(browser,/-VerifyTask \{ \$null=OwnedTask;/);
 assert.match(browser,/\$flags\[-1\] -cne \$ExpectedFeatures/);assert.match(browser,/AutofillAiWalletPrivatePasses/);
});
test('native enrichment is existing-runtime-only and proves task/action/assembly/session before actor PID',()=>{
 assert.match(native,/if\(\$OwnershipRequest -and !\$InspectOwnership\)/);
 const branch=native.slice(native.indexOf('if($InspectOwnership)'),native.indexOf('if ($Crash)'));
 assert.match(branch,/AssertLifetime \$task/);assert.match(branch,/\$process.Path -cne \$dotnet/);assert.match(branch,/\$meta.CommandLine.Contains\(\$expectedArgs\)/);
 assert.match(branch,/-RuntimePid \$actorPid -ModulePath \$Assembly/);assert.doesNotMatch(branch,/Start-ScheduledTask|Register-ScheduledTask|Stop-Process/);
});
test('collector rechecks task and PID/start/module/executable/session around capture',()=>{
 assert.equal((helper.match(/& \$VerifyTask/g)||[]).length,2);assert.match(helper,/\$fresh.StartTime.*-cne\$startKey/);assert.match(helper,/\$fresh.SessionId-ne\$sessionId/);assert.match(helper,/\$metaAfter.ParentProcessId-ne\$meta.ParentProcessId/);assert.match(helper,/\$moduleHash/);assert.match(helper,/\$exeHash/);
 assert.doesNotMatch(helper,/CommandLine|Stop-Process|Stop-ScheduledTask|Start-Process|Register-ScheduledTask/);
});
test('collector uses local monotonic bracket, bounded capture and explicit incomplete renderer scope',()=>{
 assert.match(helper,/Stopwatch\]::GetTimestamp/);assert.match(helper,/monotonicStart=\$start;monotonicEnd=\$end;monotonicFrequency=\$frequency/);assert.match(helper,/-gt5000/);assert.match(helper,/collectorNowMs=/);assert.match(helper,/scope='bound-process-tree';rendererCoverage='unavailable'/);
});
test('collector outputs bounded typed data create-only and emits no command lines or tokens',()=>{
 assert.match(helper,/requestBytes.Length-gt8192/);assert.match(helper,/New-Object Text.UTF8Encoding\(\$false,\$true\)/);assert.equal((helper.match(/FileMode\]::CreateNew/g)||[]).length,2);assert.match(helper,/receiptSha256=\$digest/);assert.match(helper,/root=\$root/);assert.doesNotMatch(helper,/authorization|password|accessToken|refreshToken|cookie/i);
});
test('legacy native crash/finish/start and browser finish/start remain byte-exact outside opt-in ingress',()=>{
 const originalNative='0b148c82d2fd37a8f853ad7e5033fe5b7c6fad8977575c043e82be330e6dddad';const restoredNative=native.replace('      [string]$ExpectedModuleSha256,\n      [switch]$InspectOwnership,\n      [string]$OwnershipRequest)','      [string]$ExpectedModuleSha256)').replace(native.slice(native.indexOf('if($OwnershipRequest'),native.indexOf('if ($InspectLifetime)')),'');assert.equal(sha(restoredNative),originalNative);
 const originalBrowser='531943ea737349ac93e01c8e26c00cb051dc162f06e122d2a6ab04ae0842d5ee';let restored=browser.replace("  # Match the genuine launcher: no OS timeout may kill a guarded editor.\n  if ([Xml.XmlConvert]::ToTimeSpan($task.Settings.ExecutionTimeLimit) -ne [TimeSpan]::Zero) {\n    throw 'Owned browser task lifetime changed'\n  }\n",'').replace('  [string]$ExpectedFeatures,\n  [string]$OwnershipRequest\n','  [string]$ExpectedFeatures\n').replace("if($OwnershipRequest -and !$Inspect){throw 'Resource collection requires existing-runtime inspect only'}\n",'');const start=restored.indexOf('  if($OwnershipRequest) {'),end=restored.indexOf('  exit 0\n}\nif($Finish)',start);restored=restored.slice(0,start)+restored.slice(end);assert.equal(sha(restored),originalBrowser);
});

test('native diagnostic ingress validates paths, protected isolation parent and selected process again',()=>{assert.match(native,/SafeDiagnosticPath/);assert.match(native,/AreAccessRulesProtected/);assert.match(native,/GetOwner/);assert.match(native,/Selected native runtime changed/);assert.match(browser,/Selected browser runtime changed/);assert.match(helper,/Duplicate resource request key/);assert.match(helper,/generation-gt999/);assert.match(helper,/scopeClaimsVerified=\$false;authority='os-process-identity-only'/);});

test('native diagnostics reuse lifetime validation and collector rejects coerced request scalars',()=>{
 assert.ok(native.indexOf('AssertInputIdentity\nfunction AssertLifetime')<native.indexOf('if($InspectOwnership)'));
 assert.match(native,/AssertLifetime \$current/);
 assert.match(helper,/request.version-isnot\[int\]-and\$request.version-isnot\[long\]/);
 assert.match(helper,/request.\$key-isnot\[string\]/);
 assert.match(helper,/Resource request changed during capture/);
 for(const file of ['../../scripts/test-sync.sh','./build.ps1']) assert.match(readFileSync(new URL(file,import.meta.url),'utf8'),/windows\/scripts\/resource-emitter[.]test[.]mjs/);
});
