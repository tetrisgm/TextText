import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeTaskLifetimePins,validateNativeTaskLifetime} from './stress-native-relay.mjs';
test('actual caller derives finite task grace from actor config with legacy default unchanged',()=>{
 for(const [config,actor,task] of [[{},20,22],[{TotalMinutes:1},1,22],[{totalMinutes:80},80,82],[{TotalMinutes:120},120,122]]) {
  const pins=nativeTaskLifetimePins(config,Buffer.from(JSON.stringify(config)),Buffer.from('controlled module'));
  assert.equal(pins.actorMinutes,actor);assert.equal(pins.taskMinutes,task);
 }
 for(const value of [0,121,1.5,'80',null,true]) assert.throws(()=>nativeTaskLifetimePins({TotalMinutes:value},Buffer.from('{}'),Buffer.from('module')));
 assert.throws(()=>nativeTaskLifetimePins({TotalMinutes:80,totalMinutes:80},Buffer.from('{}'),Buffer.from('module')));
});
test('caller refuses task/session/settings/module/config mismatch rather than trusting receipt claims',()=>{
 const pins={...nativeTaskLifetimePins({TotalMinutes:120},Buffer.from('config'),Buffer.from('module')),taskName:'controlled-task',session:'controlled-session'};
 const valid={version:1,...pins,actualLimit:'PT2H2M'};
 validateNativeTaskLifetime(valid,pins);
 for(const [key,value] of Object.entries({version:2,taskName:'foreign',session:'foreign',actorMinutes:20,taskMinutes:22,actualLimit:'PT22M',configSha256:'0'.repeat(64),moduleSha256:'0'.repeat(64)})) assert.throws(()=>validateNativeTaskLifetime({...valid,[key]:value},pins));
});
test('actual start invokes inspection before returning and finish retains settings checks',()=>{
 const caller=readFileSync(new URL('./stress-native-relay.mjs',import.meta.url),'utf8');
 const task=readFileSync(new URL('./stress-native-task.ps1',import.meta.url),'utf8');
 assert.match(caller,/if \(mode === 'start'\) task\('inspect'\)/);
 assert.match(caller,/mode === 'inspect'\) args.push\('-InspectLifetime'\)/);
 assert.match(task,/AssertLifetime \(Get-ScheduledTask[^\n]+\)\nStart-ScheduledTask/);
 assert.match(task,/AssertLifetime \$task\n  if \(\$task.State/);
 assert.doesNotMatch(task,/ExecutionMinutes/);
 for(const path of ['../../scripts/test-sync.sh','./build.ps1']) assert.match(readFileSync(new URL(path,import.meta.url),'utf8'),/windows\/scripts\/stress-native-lifetime[.]test[.]mjs/);
});

test('caller parses and hashes exactly one captured config read and passes independent pins to task before spawn',()=>{
 const source=readFileSync(new URL('./stress-native-relay.mjs',import.meta.url),'utf8');
 assert.match(source,/const configBytes = readFileSync\(configPath\);\n  const config = JSON.parse\(configBytes.toString\('utf8'\)\);\n  lifetimePins = nativeTaskLifetimePins\(config, configBytes,/);
 assert.match(source,/'-ExpectedConfigSha256', lifetimePins.configSha256, '-ExpectedModuleSha256', lifetimePins.moduleSha256/);
 assert.equal((source.match(/readFileSync\(configPath/g)??[]).length,1);
});
