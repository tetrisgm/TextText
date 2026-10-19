import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectPcOwnership, runReadonlyCollector } from './measurement-host-pc.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
const encode = v => Buffer.from(JSON.stringify(v));
const normalized = p => p.replaceAll('\\', '/');
function fixture(role = 'pc-app', mutate = () => {}) {
  const files = new Map(), created = [], calls = [], start = Date.parse('2026-10-19T18:00:00Z');
  const root = { pid: 200, parentPid: 190, startKey: 'start-1', session: '1', executableSha256: hash('executable') };
  const scope = {runId:'owned-1',role,sourceCommit:'a'.repeat(40),generation:1,sessionPath:'/owned/session',moduleSha256:hash('module'),profileScopeHash:role==='pc-web'?'b'.repeat(64):null,taskName:role==='pc-web'?'TextText-stress-browser-'+ 'c'.repeat(32):'TextText-stress-native-'+ 'c'.repeat(32)+'-001'};
  const paths = { powershell:'/tools/powershell.exe',task:'/source/'+(role==='pc-web'?'stress-browser-task.ps1':'stress-native-task.ps1'),helper:'/source/resource-ownership-task.ps1',config:'/owned/config.json',module:'/source/module',executable:'/tools/executable',...(role==='pc-web'?{launcherExecutable:'/tools/node.exe',child:'/source/stress-browser-child.mjs'}:{}) };
  const pinned = {};
  for(const [k,p] of Object.entries(paths)){const b=Buffer.from(k); files.set(p,b); pinned[k]={path:p,sha256:hash(b)};}
  const launch = {version:1,kind:'trusted-pc-launch-owner-v1',scope,root,files:pinned,maxMs:role==='pc-web'?420000:null,features:role==='pc-web'?'FeatureA,FeatureB':null};
  files.set('/owned/launch.json',encode(launch));
  const config={enabled:true,launcherPath:'/owned/launch.json',launcherSha256:hash(files.get('/owned/launch.json')),evidenceDirectory:'/owned/evidence'};
  let now=start,mono=0;
  const d={platform:'win32',read:(p,max)=>{p=normalized(p);assert.ok(files.has(p),'missing '+p);const b=files.get(p);assert.ok(b.length<=max);return Buffer.from(b);},create:(p,b)=>{p=normalized(p);assert.ok(!files.has(p),'create only '+p);files.set(p,Buffer.from(b));created.push(p);},now:()=>now,monotonic:()=>mono,uuid:()=> '12345678-1234-4234-8234-123456789abc',run:async(exe,args,bounds)=>{
    calls.push({exe,args,bounds}); now+=100;mono+=100;
    const request=JSON.parse(files.get(normalized(args.at(-1)))), receipt={version:1,kind:'owned-role-runtime-v1',...scope,root};
    const rb=encode(receipt), os={version:1,observedUtc:new Date(now).toISOString(),receiptSha256:hash(rb),sessionPath:scope.sessionPath,moduleSha256:scope.moduleSha256,profileScopeHash:scope.profileScopeHash,taskName:scope.taskName,processKind:role==='pc-web'?'headed-browser':'native-actor',identity:{...root}};
    const envelope={version:1,scopeClaimsVerified:false,authority:'os-process-identity-only',collectorPlatform:'win32',collectorNowMs:now,monotonicStart:0,monotonicEnd:100,monotonicFrequency:1000,scope:'bound-process-tree',rendererCoverage:'unavailable',receiptSha256:hash(rb),os};
    const result={code:0,signal:null,pid:100,reason:null,parts:[]};
    const state={files,request,receipt,rb,envelope,result,launch,scope,setNow:n=>now=n,setMono:n=>mono=n};mutate(state);
    files.set('/owned/session/'+request.outputName,state.rb); files.set('/owned/session/'+request.outputName+'.collector.json',encode(envelope));return result;
  }};
  return {config,d,files,created,calls,launch};
}
test('default-off does not read, write, spawn or inspect platform',async()=>assert.deepEqual(await inspectPcOwnership({enabled:false},{}),{enabled:false,ready:false}));
for(const role of ['pc-app','pc-web'])test(role+' uses fresh existing inspect-only command and strict returned proof',async()=>{
 const f=fixture(role),out=await inspectPcOwnership(f.config,f.d);assert.equal(out.os.identity.pid,200);assert.equal(Object.getPrototypeOf(out.receiptBytes),Uint8Array.prototype);assert.equal(f.calls.length,1);const a=f.calls[0].args;assert.ok(a.includes(role==='pc-web'?'-Inspect':'-InspectOwnership'));for(const forbidden of ['-Crash','-Finish','-Start'])assert.ok(!a.includes(forbidden));assert.equal(f.created.length,4);assert.equal(f.calls[0].bounds.deadlineMs,10000);assert.equal(a[a.indexOf('-ExecutionPolicy')+1],'Bypass');
});
for(const key of ['pid','parentPid','startKey','session','executableSha256'])test('refuses changed OS '+key,async()=>{const f=fixture('pc-app',s=>s.envelope.os.identity[key]=key==='pid'||key==='parentPid'?999:'wrong');await assert.rejects(inspectPcOwnership(f.config,f.d));});
for(const field of ['config','module','task','helper','executable','powershell'])test('refuses changed pinned '+field+' after command',async()=>{const f=fixture('pc-app',s=>s.files.set(s.launch.files[field].path,Buffer.from('changed')));await assert.rejects(inspectPcOwnership(f.config,f.d));});
for(const change of [s=>s.envelope.collectorNowMs-=6000,s=>s.envelope.monotonicEnd=9000,s=>s.envelope.scopeClaimsVerified=true,s=>s.envelope.os.taskName='other',s=>s.envelope.os.profileScopeHash='f'.repeat(64),s=>s.envelope.os.sessionPath='/other',s=>s.setNow(Date.parse('2026-10-19T18:00:09Z')),s=>s.setMono(7000),s=>s.rb=Buffer.from('bad'),s=>s.result.reason='deadline',s=>s.result.code=1])test('refuses collector replay/drift/failure '+String(change),async()=>{const f=fixture('pc-app',change);await assert.rejects(inspectPcOwnership(f.config,f.d));assert.ok(f.created.some(p=>p.includes('/collector-')));});
test('missing/forged launcher and unsupported role/platform fail before command',async()=>{
 for(const edit of [f=>f.config.launcherSha256='f'.repeat(64),f=>f.d.platform='darwin',f=>{f.launch.scope.role='pc-cli';const b=encode(f.launch);f.files.set(f.config.launcherPath,b);f.config.launcherSha256=hash(b);},f=>f.files.delete(f.config.launcherPath)]){const f=fixture();edit(f);await assert.rejects(inspectPcOwnership(f.config,f.d));assert.equal(f.calls.length,0);}
});
test('prior request cannot be overwritten/reused',async()=>{const f=fixture();await inspectPcOwnership(f.config,f.d);await assert.rejects(inspectPcOwnership(f.config,f.d));assert.equal(f.calls.length,1);});
test('actual bounded collector retains partial output and terminates only its own child',async()=>{
 const r=await runReadonlyCollector(process.execPath,['-e',"process.stdout.write('partial');setTimeout(()=>{},10000)"],{deadlineMs:150,maxBytes:100});assert.equal(r.reason,'deadline');assert.ok(r.pid>1);assert.ok(r.parts.some(p=>p.bytes.toString()==='partial'));
});
test('actual command output bound fails with bounded retained bytes',async()=>{const r=await runReadonlyCollector(process.execPath,['-e',"process.stdout.write('x'.repeat(10000))"],{deadlineMs:1000,maxBytes:20});assert.equal(r.reason,'output-bound');assert.equal(r.parts.reduce((n,p)=>n+p.bytes.length,0),20);});
test('malformed trusted root is refused before a command',async()=>{const f=fixture();delete f.launch.root.startKey;const b=encode(f.launch);f.files.set(f.config.launcherPath,b);f.config.launcherSha256=hash(b);await assert.rejects(inspectPcOwnership(f.config,f.d));assert.equal(f.calls.length,0);});
test('launcher and request mutation across command refuse',async()=>{
 for(const which of ['launch','request']){const f=fixture('pc-app',s=>{const p=which==='launch'?'/owned/launch.json':[...s.files.keys()].find(k=>k.includes('/measurement-request-'));s.files.set(p,Buffer.from('changed'));});await assert.rejects(inspectPcOwnership(f.config,f.d));}
});
test('actual invalid executable resolves bounded spawn error without a signal API',async()=>{const r=await runReadonlyCollector('/does-not-exist-owned-collector',[],{deadlineMs:100,maxBytes:50});assert.equal(r.reason,'spawn-error');assert.equal(r.pid,null);});
test('native task contract includes exact action/lifetime and fresh runtime checks',async()=>{
 const {readFileSync}=await import('node:fs');const s=readFileSync(new URL('../../windows/scripts/stress-native-task.ps1',import.meta.url),'utf8');
 for(const text of ['function AssertLifetime','ExecutionTimeLimit','AssertInputIdentity','if($InspectOwnership)','-VerifyTask','AssertLifetime $current',"$selectedMeta.CommandLine.Contains($expectedArgs)"])assert.ok(s.includes(text));
 const f=fixture();await inspectPcOwnership(f.config,f.d);const a=f.calls[0].args;assert.equal(a[a.indexOf('-ExpectedConfigSha256')+1],f.launch.files.config.sha256);assert.equal(a[a.indexOf('-ExpectedModuleSha256')+1],f.launch.scope.moduleSha256);
});

test('strict host config rejects symbols/nonenumerables/accessors without invoking them',async()=>{
 for(const add of [c=>Object.defineProperty(c,'extra',{value:1}),c=>c[Symbol('extra')]=1,c=>Object.defineProperty(c,'enabled',{enumerable:true,get(){throw Error('accessor invoked');}}),c=>Object.defineProperty(c,'launcherPath',{enumerable:true,get(){throw Error('accessor invoked');}})]){const f=fixture();add(f.config);await assert.rejects(inspectPcOwnership(f.config,f.d));assert.equal(f.calls.length,0);}
});
test('captured collector envelope is read once and preserved byte-for-byte',async()=>{
 const f=fixture(),read=f.d.read,counts=new Map();f.d.read=(p,max)=>{p=normalized(p);counts.set(p,(counts.get(p)||0)+1);return read(p,max);};await inspectPcOwnership(f.config,f.d);
 const p=[...f.files.keys()].find(p=>p.endsWith('.collector.json'));assert.equal(counts.get(p),1);const copy=f.created.find(p=>p.includes('collector-envelope-'));assert.deepEqual(f.files.get(copy),f.files.get(p));
});

test('browser task command preserves trusted features/maxMs/node and pins child source',async()=>{
 const f=fixture('pc-web');await inspectPcOwnership(f.config,f.d);const a=f.calls[0].args;
 for(const [k,v] of [['-Node',f.launch.files.launcherExecutable.path],['-MaxMs','420000'],['-ExpectedFeatures','FeatureA,FeatureB']])assert.equal(a[a.indexOf(k)+1],v);
 for(const field of ['child','launcherExecutable']){const changed=fixture('pc-web',s=>s.files.set(s.launch.files[field].path,Buffer.from('changed')));await assert.rejects(inspectPcOwnership(changed.config,changed.d));}
});
test('browser settings verifier is in the actual task before/after inspect',async()=>{
 const {readFileSync}=await import('node:fs');const s=readFileSync(new URL('../../windows/scripts/stress-browser-task.ps1',import.meta.url),'utf8');
 assert.ok(s.includes('[Xml.XmlConvert]::ToTimeSpan($task.Settings.ExecutionTimeLimit) -ne [TimeSpan]::Zero'));
 assert.ok(s.includes('$null=OwnedTask\n  exit 0'));assert.ok(s.includes('-VerifyTask { $null=OwnedTask;'));
});

test('actual Windows collector executes only disposable pinned script with relay-local policy flag',{skip:process.platform!=='win32'},async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');const{tmpdir}=await import('node:os');const{join}=await import('node:path');
 const root=mkdtempSync(join(tmpdir(),'measurement-inert-')),path=join(root,'inert.ps1'),bytes=Buffer.from("$ErrorActionPreference='Stop';Write-Output 'inert-collector-only'\n");
 try{writeFileSync(path,bytes,{flag:'wx'});const before=hash(readFileSync(path));const r=await runReadonlyCollector('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path],{deadlineMs:5000,maxBytes:1024});assert.equal(r.code,0);assert.equal(r.reason,null);assert.equal(r.closeObserved,true);assert.equal(r.terminationRequested,false);assert.match(r.parts.map(p=>p.bytes.toString()).join(''),/inert-collector-only/);assert.equal(hash(readFileSync(path)),before);}finally{rmSync(root,{recursive:true});}
});
