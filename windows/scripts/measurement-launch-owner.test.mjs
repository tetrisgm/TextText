import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { prepareLaunchMeasurement, measurementLaunchOptions, browserMeasurementOwner } from './measurement-launch-owner.mjs';
import { inspectPcOwnership } from '../../sync/stress/measurement-host-pc.mjs';
const hash = v => createHash('sha256').update(v).digest('hex'), norm = p => p.replaceAll('\\','/'), encode=v=>Buffer.from(JSON.stringify(v));
const here=dirname(fileURLToPath(import.meta.url));
function fixture(role='pc-app') {
 const web=role==='pc-web',root='/owned/session',seal='/owned/seal.json';let now=Date.parse('2026-10-19T18:00:00Z'),mono=0,uuid=0;
 const owner={role,sessionRoot:root,maxMs:web?420000:null,features:web?'One,Two':null,sealPath:seal,relayPath:resolve(here,web?'stress-browser-relay.mjs':'stress-native-relay.mjs'),files:{module:'/build/module',config:'/owned/config.json',executable:'/tools/runtime',powershell:'/tools/powershell.exe',task:resolve(here,web?'stress-browser-task.ps1':'stress-native-task.ps1'),helper:resolve(here,'resource-ownership-task.ps1'),...(web?{launcherExecutable:'/tools/node.exe',child:resolve(here,'stress-browser-child.mjs')}:{})}};
 const paths={...owner.files,seal,relay:owner.relayPath,launchHelper:resolve(here,'measurement-launch-owner.mjs'),inspector:resolve(here,'../../sync/stress/measurement-host-pc.mjs'),ownership:resolve(here,'../../sync/stress/resource-ownership.mjs'),observation:resolve(here,'../../sync/stress/identity-observation.mjs'),launchNode:process.execPath};
 const files=new Map(),pins={};for(const[k,p]of Object.entries(paths)){const bytes=k==='config'?encode({IdentityReceipt:seal}):Buffer.from(k);files.set(norm(p),bytes);pins[k]={path:p,sha256:hash(bytes)};}
 const intent={version:1,kind:'pc-measurement-launch-intent-v1',runId:'run-1',role,sourceCommit:'a'.repeat(40),launchSourceCommit:'b'.repeat(40),sessionRoot:root,maxGenerations:3,maxMs:owner.maxMs,features:owner.features,files:pins};
 const options={enabled:true,path:'/owned/intent.json',sha256:''};
 const repin=()=>{const b=encode(intent);files.set(options.path,b);options.sha256=hash(b);};repin();
 const writes=[],commands=[];let mutate=()=>{};
 const runtimeRoot={pid:222,parentPid:111,startKey:'start-1',session:'1',executableSha256:pins.executable.sha256};
 let source={sourceCommit:intent.sourceCommit,sourceReceiptSha256:'c'.repeat(64),artifacts:{fixture:'d'.repeat(64)}};
 const d={platform:'win32',read:(p,max)=>{p=norm(p);assert.ok(files.has(p),'missing '+p);const b=files.get(p);assert.ok(b.length<=max);return Buffer.from(b);},create:(p,b)=>{p=norm(p);assert.ok(!files.has(p),'create-only '+p);files.set(p,Buffer.from(b));writes.push(p);},exists:p=>files.has(norm(p)),realpath:p=>p,verifySeal:()=>source,now:()=>now,monotonic:()=>mono,uuid:()=>`12345678-1234-4234-8234-${String(++uuid).padStart(12,'0')}`,run:async(exe,args,bounds)=>{
  commands.push({exe,args,bounds});const request=JSON.parse(files.get(norm(args.at(-1))));now+=50;mono+=50;
  const {outputName,version,...scope}=request;
  const receipt={version:1,kind:'owned-role-runtime-v1',...scope,root:{...runtimeRoot}},rb=encode(receipt);
  const os={version:1,observedUtc:new Date(now).toISOString(),receiptSha256:hash(rb),sessionPath:scope.sessionPath,moduleSha256:scope.moduleSha256,profileScopeHash:scope.profileScopeHash,taskName:scope.taskName,processKind:web?'headed-browser':'native-actor',identity:{...runtimeRoot}};
  const envelope={version:1,scopeClaimsVerified:false,authority:'os-process-identity-only',collectorPlatform:'win32',collectorNowMs:now,monotonicStart:0,monotonicEnd:50,monotonicFrequency:1000,scope:'bound-process-tree',rendererCoverage:'unavailable',receiptSha256:hash(rb),os};
  const result={code:0,signal:null,pid:99,reason:null,closeObserved:true,terminationRequested:false,parts:[]};
  const state={files,receipt,rb,envelope,result,request,setNow:x=>now=x,setMono:x=>mono=x};mutate(state);
  files.set(norm(join(scope.sessionPath,outputName)),state.rb);files.set(norm(join(scope.sessionPath,outputName+'.collector.json')),encode(envelope));return result;
 }};
 return{owner,options,intent,d,files,writes,commands,runtimeRoot,repin,mutate:f=>mutate=f,setSource:s=>source=s,scope:(generation=1)=>({generation,sessionPath:web?root:join(root,`generation-${String(generation).padStart(3,'0')}`),taskName:web?'TextText-stress-browser-'+'e'.repeat(32):'TextText-stress-native-'+'e'.repeat(32)+`-${String(generation).padStart(3,'0')}`})};
}
test('disabled returns before any owner, dependency, filesystem or command access',()=>{assert.equal(prepareLaunchMeasurement({enabled:false},null,{}),null);assert.deepEqual(measurementLaunchOptions([]),{enabled:false});});
test('launcher CLI flags are strict, no actor config/protocol input',()=>{for(const a of [['x'],['--measurement-intent','/a'],['--other','/a','--measurement-intent-sha256','a'.repeat(64)]])assert.throws(()=>measurementLaunchOptions(a));assert.equal(measurementLaunchOptions(['--measurement-intent','/a','--measurement-intent-sha256','a'.repeat(64)]).enabled,true);});
for(const role of ['pc-app','pc-web'])test(role+' publishes actual OS receipt under caller-pinned launch scope and host adapter can inspect',async()=>{
 const f=fixture(role),c=prepareLaunchMeasurement(f.options,f.owner,f.d);assert.equal(f.commands.length,0);c.beforeStart();const out=await c.publish(f.scope());
 const record=JSON.parse(f.files.get(norm(out.recordPath)));assert.equal(record.root.pid,222);assert.equal(record.scope.sourceCommit,'a'.repeat(40));assert.equal(record.scope.runId,'run-1');assert.ok(out.recordPath.endsWith('measurement-launch-owner-001.json'));
 const proof=await inspectPcOwnership({enabled:true,launcherPath:out.recordPath,launcherSha256:out.recordSha256,evidenceDirectory:'/owned/evidence'},f.d);assert.equal(proof.os.identity.pid,222);assert.equal(f.commands.length,2);
 const args=f.commands[0].args;assert.ok(args.includes(role==='pc-web'?'-Inspect':'-InspectOwnership'));assert.ok(!args.includes('-Start'));assert.ok(!args.includes('-Crash'));assert.ok(!args.includes('-Finish'));
});
for(const key of ['role','runId','sourceCommit','sessionRoot','maxGenerations','maxMs','features'])test('refuses invalid caller intent '+key+' before any task command',()=>{
 const f=fixture();f.intent[key]=key==='maxGenerations'?1000:'wrong';f.repin();if(key==='runId')f.intent.runId='bad space',f.repin();assert.throws(()=>prepareLaunchMeasurement(f.options,f.owner,f.d));assert.equal(f.commands.length,0);
});
test('intent/source pin and actual seal are mandatory before start',()=>{for(const mutation of [f=>f.options.sha256='f'.repeat(64),f=>f.files.delete(f.options.path),f=>f.setSource({sourceCommit:'f'.repeat(40)}),f=>{f.intent.files.module.sha256='f'.repeat(64);f.repin();}]){const f=fixture();mutation(f);assert.throws(()=>prepareLaunchMeasurement(f.options,f.owner,f.d));assert.equal(f.commands.length,0);}});
for(const key of ['task','helper','module','config','executable','relay','launchHelper','inspector','ownership','observation','seal','launchNode'])test('changed launch bytes '+key+' refuse before publication',async()=>{
 const f=fixture(),c=prepareLaunchMeasurement(f.options,f.owner,f.d);f.mutate(s=>s.files.set(norm(f.intent.files[key].path),Buffer.from('changed')));await assert.rejects(c.publish(f.scope()));assert.ok(!f.writes.some(p=>p.includes('measurement-launch-owner-')));
});
test('beforeStart catches intent/config changes and never runs an OS command',()=>{const f=fixture(),c=prepareLaunchMeasurement(f.options,f.owner,f.d);f.files.set(f.options.path,Buffer.from('changed'));assert.throws(()=>c.beforeStart());assert.equal(f.commands.length,0);});
for(const mutation of [s=>s.envelope.scopeClaimsVerified=true,s=>s.envelope.os.taskName='other',s=>s.envelope.os.identity.startKey='changed',s=>s.envelope.os.profileScopeHash='f'.repeat(64),s=>s.envelope.collectorNowMs-=6000,s=>s.result.reason='deadline',s=>s.result.closeObserved=false,s=>s.setNow(Date.parse('2026-10-19T18:00:06Z')),s=>s.rb=Buffer.from('bad')])test('stale/wrong/incomplete collector never becomes launch authority '+mutation,async()=>{const f=fixture('pc-web'),c=prepareLaunchMeasurement(f.options,f.owner,f.d);f.mutate(mutation);await assert.rejects(c.publish(f.scope()));assert.ok(!f.writes.some(p=>p.includes('measurement-launch-owner-')));});
test('same-generation hello reinspection is idempotent, runtime drift refuses; generations create new records',async()=>{
 const f=fixture(),c=prepareLaunchMeasurement(f.options,f.owner,f.d),a=await c.publish(f.scope());await c.publish(f.scope());assert.equal(f.writes.filter(p=>p===norm(a.recordPath)).length,1);
 f.runtimeRoot.pid++;await assert.rejects(c.publish(f.scope()));await c.publish(f.scope(2));assert.ok(f.writes.some(p=>p.endsWith('measurement-launch-owner-002.json')));await assert.rejects(c.publish(f.scope(4)));
});
test('publication collision retains existing bytes and cannot forward ready',async()=>{const f=fixture(),c=prepareLaunchMeasurement(f.options,f.owner,f.d);const p=norm(join(f.scope().sessionPath,'measurement-launch-owner-001.json'));f.files.set(p,Buffer.from('prior'));await assert.rejects(c.publish(f.scope()));assert.equal(f.files.get(p).toString(),'prior');});
test('browser generation is correlated to caller restart, never response fields',async()=>{const calls=[],c=browserMeasurementOwner({publish:async s=>calls.push(s)},'/owned/session','ownedTask');await assert.rejects(c.attest('restart'));assert.throws(()=>c.request('restart'));await c.attest('attest');c.request('restart');assert.throws(()=>c.request('restart'));await assert.rejects(c.attest('attest'));await c.attest('restart');assert.deepEqual(calls.map(c=>c.generation),[1,2]);});
test('default-off browser correlation adds no behavior',async()=>{const c=browserMeasurementOwner(null);c.request('restart');await c.attest('invented');});
test('freshness includes post-command input/seal revalidation',async()=>{const f=fixture(),read=f.d.read;let slow=false;f.d.read=(p,max)=>{if(slow&&norm(p)===f.options.path)f.mutate(()=>{}),f.d.now=()=>Date.parse('2026-10-19T18:00:07Z');return read(p,max);};const c=prepareLaunchMeasurement(f.options,f.owner,f.d);slow=true;await assert.rejects(c.publish(f.scope()));});
test('both real relays place publication before forwarding attestation and keep defaultoff lazy',()=>{
 const native=readFileSync(new URL('stress-native-relay.mjs',import.meta.url),'utf8'),browser=readFileSync(new URL('stress-browser-relay.mjs',import.meta.url),'utf8');
 assert.match(native,/measureOptions.enabled \? prepareLaunchMeasurement/);assert.match(browser,/measureOptions.enabled \? prepareLaunchMeasurement/);
 assert.ok(native.indexOf('await measure.publish')<native.indexOf("process.stdout.write(JSON.stringify(answer)"));assert.match(browser,/onRequest: type => measure.request\(type\)/);assert.match(browser,/taskCall\('inspect'\); if \(channel\) await measure.attest\(value.type\)/);
});

test('future PCweb sealed artifact inventories include every newly loaded authority module',async()=>{
 const {fixedDriverFiles}=await import('../../sync/stress/identity-observation.mjs');const{fixedArtifactPaths}=await import('../../sync/stress/artifact-source.mjs');
 const actual=fixedDriverFiles('pc-web'),declared=fixedArtifactPaths('pc-web',resolve(here,'../..'));
 for(const k of ['measurementLaunch','measurementHost','resourceOwnership']){assert.equal(actual[k],declared[k]);assert.ok(readFileSync(actual[k]).length>0);}
});

test('disabled and enabled options refuse accessors and hidden extra keys without invoking them',()=>{
 let reads=0;const getter={get enabled(){reads++;return false;}};assert.throws(()=>prepareLaunchMeasurement(getter,null,{}));assert.equal(reads,0);
 for(const extra of [Symbol('extra'),'hidden']){const options={enabled:false};Object.defineProperty(options,extra,{value:true});assert.throws(()=>prepareLaunchMeasurement(options,null,{}));}
 const f=fixture();f.intent.runId=123;f.repin();assert.throws(()=>prepareLaunchMeasurement(f.options,f.owner,f.d));assert.equal(f.commands.length,0);
});
