import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const path = new URL('stress-browser-task.ps1', import.meta.url);
const source = readFileSync(path, 'utf8');
test('genuine browser task lifetime remains zero and inspect rechecks through existing owner',()=>{
 assert.match(source,/New-ScheduledTaskSettingsSet -Priority 4 -ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
 const owner=source.slice(source.indexOf('function OwnedTask'),source.indexOf('foreach($path'));
 assert.match(owner,/XmlConvert\]::ToTimeSpan\(\$task.Settings.ExecutionTimeLimit\) -ne \[TimeSpan\]::Zero/);
 assert.match(owner,/task.Actions.Arguments -cne \$arguments/);assert.match(owner,/record.nodeSha256/);
 const inspect=source.slice(source.indexOf('if($Inspect)'),source.indexOf('if($Finish)'));
 assert.match(inspect,/if\(\$Inspect\) \{\n  \$null=OwnedTask/);assert.match(inspect,/\$null=OwnedTask\n  exit 0/);
 assert.match(inspect,/-VerifyTask \{ \$null=OwnedTask;/);
 assert.doesNotMatch(inspect,/Start-ScheduledTask|Register-ScheduledTask|Stop-ScheduledTask|Stop-Process/);
});
test('actual Windows PowerShell exercises exact production OwnedTask without tasks or processes',{skip:process.platform!=='win32'},()=>{
 const file=decodeURIComponent(path.pathname).replace(/^\/([A-Za-z]:)/,'$1').replaceAll("'","''");
 const command=`$ErrorActionPreference='Stop';$t=$null;$e=$null;$ast=[Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$t,[ref]$e);if($e.Count){throw 'Task syntax invalid'}
 $fn=@($ast.FindAll({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'OwnedTask'},$true));if($fn.Count-ne1){throw 'Owner function missing'}
 Invoke-Expression $fn[0].Extent.Text
 $TaskName='TextText-stress-browser-test';$Session='C:/owned/session';$Node='C:/owned/node.exe';$arguments='exact-action'
 $script:task=[pscustomobject]@{Actions=@([pscustomobject]@{Execute=$Node;Arguments=$arguments});Settings=[pscustomobject]@{ExecutionTimeLimit='PT0S'}}
 $script:record=[pscustomobject]@{task=$TaskName;node=$Node;nodeSha256=('a'*64)}
 function Get-ScheduledTask {param($TaskName,$ErrorAction) $script:task}
 function Get-Content {param($LiteralPath,[switch]$Raw,$Encoding) $script:record|ConvertTo-Json -Compress}
 function Get-FileHash {param($LiteralPath,$Algorithm) [pscustomobject]@{Hash=('A'*64)}}
 $checks=0;$null=OwnedTask;$checks++
 foreach($value in @('PT1S','PT2H','P1D','garbage','')){$script:task.Settings.ExecutionTimeLimit=$value;$rejected=$false;try{$null=OwnedTask}catch{$rejected=$true};if(!$rejected){throw 'Changed lifetime accepted'};$checks++}
 $script:task.Settings.ExecutionTimeLimit='PT0S';$null=OwnedTask;$checks++
 $script:task.Actions[0].Arguments='changed';$rejected=$false;try{$null=OwnedTask}catch{$rejected=$true};if(!$rejected){throw 'Changed action accepted'};$checks++
 $script:task.Actions[0].Arguments=$arguments;$script:record.nodeSha256=('b'*64);$rejected=$false;try{$null=OwnedTask}catch{$rejected=$true};if(!$rejected){throw 'Changed executable accepted'};$checks++
 @{checks=$checks;actualTaskCalls=0;runtimeLaunches=0}|ConvertTo-Json -Compress`;
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:65536});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout.replace(/^\uFEFF/,'')),{checks:9,actualTaskCalls:0,runtimeLaunches:0});
});
