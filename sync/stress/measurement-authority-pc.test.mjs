import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPcMeasurementAuthority } from './measurement-authority-pc.mjs';
import { measurementPreapply } from './measurement-supervisor.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture() {
 const roles=Object.fromEntries(['pc-app','pc-web'].map(role=>[role,{launcherPath:'/owned/'+role+'.json',launcherSha256:'a'.repeat(64),evidenceDirectory:'/owned/'+role}]));
 const config={enabled:true,runId:'run-1',roles},calls=[];let mutate=()=>{},last;
 const inspector=async c=>{
  const role=c.launcherPath.includes('pc-web')?'pc-web':'pc-app';calls.push(c);
  const root={pid:22,parentPid:11,startKey:'start',session:'1',executableSha256:'b'.repeat(64)};
  const scope={runId:'run-1',role,sourceCommit:'c'.repeat(40),generation:1,sessionPath:'/owned/session',moduleSha256:'d'.repeat(64),profileScopeHash:role==='pc-web'?'e'.repeat(64):null,taskName:role==='pc-web'?'TextText-stress-browser-'+'f'.repeat(32):'TextText-stress-native-'+'f'.repeat(32)+'-001'};
  const receiptBytes=new Uint8Array(Buffer.from(JSON.stringify({version:1,kind:'owned-role-runtime-v1',...scope,root})));
  const nowMs=Date.parse('2026-10-19T18:00:00Z')+calls.length;
  last={expected:{...scope,receiptSha256:hash(receiptBytes),rootExecutableSha256:root.executableSha256},receiptBytes,nowMs,os:{version:1,observedUtc:new Date(nowMs).toISOString(),receiptSha256:hash(receiptBytes),sessionPath:scope.sessionPath,moduleSha256:scope.moduleSha256,profileScopeHash:scope.profileScopeHash,taskName:scope.taskName,processKind:role==='pc-web'?'headed-browser':'native-actor',identity:{...root}}};
  mutate(last);return last;
 };
 return{config,inspector,calls,mutate:f=>mutate=f,last:()=>last};
}
test('disabled factory returns before dependencies/config access',()=>{assert.deepEqual(createPcMeasurementAuthority({enabled:false},null),{enabled:false});});
test('strict config refuses accessors/hidden/symbol keys without evaluating them',()=>{
 for(const change of [c=>Object.defineProperty(c,'extra',{value:1}),c=>c[Symbol('x')]=1,c=>Object.defineProperty(c,'runId',{enumerable:true,get(){assert.fail('getter')}})]){const f=fixture();change(f.config);assert.throws(()=>createPcMeasurementAuthority(f.config,f.inspector));assert.equal(f.calls.length,0);}
});
for(const role of ['pc-app','pc-web'])test(role+' initial bytes copied and every inspect uses fresh independent adapter invocation',async()=>{
 const f=fixture(),a=createPcMeasurementAuthority(f.config,f.inspector),p=await a.readLauncher(role),firstNow=f.last().nowMs;
 const s=await a.inspect(role,p.expected);assert.equal(f.calls.length,2);assert.ok(s.nowMs>firstNow);
 p.receiptBytes[0]=0;p.expected.generation=9;f.last().receiptBytes[0]=0;f.last().expected.generation=9;
 const again=await a.readLauncher(role);assert.equal(again.expected.generation,1);assert.equal(again.receiptBytes[0],123);assert.equal(f.calls.length,3);
});
for(const key of ['runId','role','sourceCommit','generation','sessionPath','moduleSha256','profileScopeHash','taskName','rootExecutableSha256','receiptSha256'])test('requested '+key+' drift refuses before fresh command',async()=>{
 const f=fixture(),a=createPcMeasurementAuthority(f.config,f.inspector),p=await a.readLauncher('pc-app');p.expected[key]='changed';await assert.rejects(a.inspect('pc-app',p.expected));assert.equal(f.calls.length,1);
});
for(const change of [p=>p.expected.sourceCommit='f'.repeat(40),p=>p.expected.generation=2,p=>p.receiptBytes[0]=0,p=>p.os.identity.startKey='reuse',p=>p.os.observedUtc='2020-01-01T00:00:00Z',p=>p.expected.runId='other',p=>p.expected.role='pc-web'])test('fresh invalid or changed proof refuses '+change,async()=>{
 const f=fixture(),a=createPcMeasurementAuthority(f.config,f.inspector),p=await a.readLauncher('pc-app');f.mutate(change);await assert.rejects(a.inspect('pc-app',p.expected));
});
test('unchanged valid repeated initial receipt accepted; independent pins captured',async()=>{const f=fixture(),a=createPcMeasurementAuthority(f.config,f.inspector);f.config.roles['pc-app'].launcherPath='/changed';const p=await a.readLauncher('pc-app');await a.readLauncher('pc-app');assert.equal(p.expected.role,'pc-app');assert.equal(f.calls[0].launcherPath,'/owned/pc-app.json');});
test('inspect requires initial proof and unavailable roles issue no command',async()=>{const f=fixture(),a=createPcMeasurementAuthority(f.config,f.inspector);for(const role of ['mac-app','mac-web','mac-cli','pc-cli']){await assert.rejects(a.readLauncher(role));await assert.rejects(a.inspect(role,{}));}await assert.rejects(a.inspect('pc-app',{}));assert.equal(f.calls.length,0);});
test('all-six supervisor refuses unavailable authority before any sampler starts',async()=>{
 const f=fixture(),a=createPcMeasurementAuthority(f.config,f.inspector);let starts=0,preserved=0;
 await assert.rejects(measurementPreapply({enabled:true,runId:'run-1',durationMs:1000,cadenceMs:1000},{readLauncher:a.readLauncher,inspect:a.inspect,startSampler:async()=>{starts++;assert.fail()},preserve:async()=>preserved++}));assert.equal(starts,0);assert.equal(preserved,1);
});
test('individually valid replacement receipt cannot replace captured initial receipt',async()=>{
 const f=fixture(),a=createPcMeasurementAuthority(f.config,f.inspector),p=await a.readLauncher('pc-app');
 f.mutate(q=>{const receipt=JSON.parse(Buffer.from(q.receiptBytes).toString());receipt.root.startKey='new-start';q.receiptBytes=new Uint8Array(Buffer.from(JSON.stringify(receipt)));q.expected.receiptSha256=hash(q.receiptBytes);q.os.receiptSha256=q.expected.receiptSha256;q.os.identity.startKey='new-start';});
 await assert.rejects(a.inspect('pc-app',p.expected),/ownership drift/);
});
test('accessor returned expected data rejected without execution',async()=>{const f=fixture();f.mutate(p=>Object.defineProperty(p.expected,'runId',{enumerable:true,get(){assert.fail('getter executed')}}));const a=createPcMeasurementAuthority(f.config,f.inspector);await assert.rejects(a.readLauncher('pc-app'));});
