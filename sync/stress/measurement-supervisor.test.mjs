import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {measurementPreapply, MEASUREMENT_ROLES} from './measurement-supervisor.mjs';
import {sample} from './resource-telemetry.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const config=()=>({enabled:true,runId:'owned-run',durationMs:7200000,cadenceMs:5000});
function harness() {
  const calls=[], preserved=[], fixtures=new Map();
  for(const [i,role] of MEASUREMENT_ROLES.entries()) {
    const root={pid:100+i,parentPid:10,startKey:'real-start-'+i,session:'1',executableSha256:'e'.repeat(64)};
    const receipt={version:1,kind:'owned-role-runtime-v1',runId:'owned-run',role,sourceCommit:'a'.repeat(40),generation:1,sessionPath:'/owned/'+role,moduleSha256:'b'.repeat(64),profileScopeHash:role.endsWith('-web')?'c'.repeat(64):null,taskName:role.startsWith('pc-')&&!role.endsWith('-cli')?'TextText-owned-'+i:null,root};
    const receiptBytes=new TextEncoder().encode(JSON.stringify(receipt));
    const expected={...receipt,receiptSha256:sha(receiptBytes),rootExecutableSha256:root.executableSha256};delete expected.version;delete expected.kind;delete expected.root;
    const os={version:1,observedUtc:'2026-10-19T17:00:00.000Z',receiptSha256:expected.receiptSha256,sessionPath:receipt.sessionPath,moduleSha256:receipt.moduleSha256,profileScopeHash:receipt.profileScopeHash,taskName:receipt.taskName,processKind:role.endsWith('-web')?'headed-browser':role.endsWith('-app')?'native-actor':'file-driver',identity:root};
    fixtures.set(role,{expected,receiptBytes,os,nowMs:Date.parse(os.observedUtc)+100});
  }
  const authority={
    async readLauncher(role){calls.push('launcher:'+role);const f=fixtures.get(role);return {expected:f.expected,receiptBytes:f.receiptBytes}},
    async inspect(role){calls.push('os:'+role);const f=fixtures.get(role);return {os:f.os,nowMs:f.nowMs}},
    async startSampler(role,{scope,cadenceMs}){calls.push('sampler:'+role);return {firstSample:sample({scope,index:0,monotonicMs:1000,dueMs:1000,cadenceMs,raw:{observedUtc:'2026-10-19T17:00:00Z',error:null,processes:[{identity:scope.root,cpuSeconds:1,rssBytes:1024,privateBytes:null}]}}),configSha256:'d'.repeat(64),outputPath:'/owned/'+role+'.jsonl'}},
    async preserve(v){preserved.push(v)}
  };
  return {authority,calls,preserved,fixtures};
}
test('default off invokes no authority or OS collection',async()=>{
  const a=new Proxy({}, {get(){throw Error('must not read')}});
  assert.equal((await measurementPreapply({...config(),enabled:false},a)).ready,false);
});
test('six ownership validations precede sampling and final barrier reinspects all roles',async()=>{
  const h=harness(),r=await measurementPreapply(config(),h.authority);
  assert.equal(r.ready,true);assert.equal(r.coverageComplete,false);assert.equal(r.manifest.roles.length,6);
  assert.equal(h.calls.filter(x=>x.startsWith('os:')).length,12);
  assert.ok(h.calls.indexOf('sampler:mac-app')>h.calls.indexOf('os:pc-cli'));
  assert.equal(r.manifest.rendererCoverage,'unavailable');assert.equal(r.manifest.logicalCounters,null);
  assert.equal(r.manifest.roles[0].firstSample.metrics.cpuCores,null);assert.equal(r.manifest.roles[0].firstSample.metrics.privateBytes,null);
  assert.match(r.manifestSha256,/^[a-f0-9]{64}$/);
});
for(const change of ['pid','startKey','session','executableSha256'])test('fresh OS '+change+' disagreement prevents all sampling',async()=>{
 const h=harness(),f=h.fixtures.get('pc-app');f.os=structuredClone(f.os);f.os.identity[change]=typeof f.os.identity[change]==='number'?999:'changed';
 await assert.rejects(measurementPreapply(config(),h.authority));assert.equal(h.calls.some(x=>x.startsWith('sampler:')),false);assert.equal(h.preserved.length,1);
});
for(const change of ['moduleSha256','profileScopeHash','taskName','processKind'])test('independent '+change+' disagreement refuses',async()=>{
 const h=harness();h.fixtures.get('pc-web').os[change]='untrusted';await assert.rejects(measurementPreapply(config(),h.authority));assert.equal(h.calls.some(x=>x.startsWith('sampler:')),false);
});
test('stale host-local time rejects; no cross-host clock substitution',async()=>{const h=harness();h.fixtures.get('pc-cli').nowMs+=6000;await assert.rejects(measurementPreapply(config(),h.authority))});
test('raw caller JSON cannot supply authority/PID',async()=>{await assert.rejects(measurementPreapply({...config(),pid:123},{}));await assert.rejects(measurementPreapply(config(),{readLauncher:{},inspect:{},startSampler:{},preserve:{}}))});
test('missing genuine launcher refuses before sampling',async()=>{const h=harness();h.authority.readLauncher=async()=>{throw Error('No genuine Mac/file launcher emitter')};await assert.rejects(measurementPreapply(config(),h.authority));assert.equal(h.calls.length,0)});
test('PID reuse after sampler startup blocks barrier and preserves all requested outputs',async()=>{
 const h=harness(),original=h.authority.inspect;let n=0;h.authority.inspect=async(...a)=>{const v=await original(...a);if(++n===7)return {...v,os:{...v.os,identity:{...v.os.identity,startKey:'reused'}}};return v};
 await assert.rejects(measurementPreapply(config(),h.authority));assert.equal(h.preserved[0].requestedSamplerRoles.length,6);
});
test('incomplete initial sample refuses readiness and retains requested role',async()=>{
 const h=harness(),original=h.authority.startSampler;h.authority.startSampler=async(...a)=>{const v=await original(...a);v.firstSample.complete=false;v.firstSample.reason='unavailable';return v};
 await assert.rejects(measurementPreapply(config(),h.authority));assert.deepEqual(h.preserved[0].requestedSamplerRoles,[...MEASUREMENT_ROLES]);
});
test('finite bounds reject before authority activity',async()=>{for(const patch of [{durationMs:7200001},{cadenceMs:1000},{durationMs:NaN},{enabled:'true'}]){const h=harness();await assert.rejects(measurementPreapply({...config(),...patch},h.authority));assert.equal(h.calls.length,0)}});
test('config accessors/symbols refuse without execution',async()=>{let n=0;const c=config();Object.defineProperty(c,'enabled',{enumerable:true,get(){n++;return true}});await assert.rejects(measurementPreapply(c,{}));assert.equal(n,0);const c2=config();c2[Symbol()]=true;await assert.rejects(measurementPreapply(c2,{}))});

test('stale initial raw sample cannot cross the barrier',async()=>{
 const h=harness(),original=h.authority.startSampler;h.authority.startSampler=async(...a)=>{const v=await original(...a);v.firstSample.raw.observedUtc='2020-01-01T00:00:00Z';return v};
 await assert.rejects(measurementPreapply(config(),h.authority));assert.equal(h.preserved.length,1);
});
test('samplers cannot reuse an output path or advertise a relative path',async()=>{
 for(const outputPath of ['/owned/shared.jsonl','relative.jsonl']){const h=harness(),original=h.authority.startSampler;h.authority.startSampler=async(...a)=>({...await original(...a),outputPath});await assert.rejects(measurementPreapply(config(),h.authority));assert.equal(h.preserved.length,1)}
});
test('launcher expected getters rejected before OS callback can inspect them',async()=>{
 const h=harness();let n=0;Object.defineProperty(h.fixtures.get('mac-app').expected,'role',{enumerable:true,get(){n++;return 'mac-app'}});await assert.rejects(measurementPreapply(config(),h.authority));assert.equal(n,0);assert.equal(h.calls.includes('os:mac-app'),false);
});

const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('parallel ownership settles all failures before preserve and never starts samplers',async()=>{
 const h=harness(),read=h.authority.readLauncher,finished=[];h.authority.readLauncher=async role=>{if(role==='mac-app')throw Error('missing');await delay(15);finished.push(role);return read(role)};
 h.authority.preserve=async v=>{assert.equal(finished.length,5);h.preserved.push(v)};
 await assert.rejects(measurementPreapply(config(),h.authority));assert.equal(h.calls.some(x=>x.startsWith('sampler:')),false);
});
test('failed parallel sampler waits for every delayed callback before preserving',async()=>{
 const h=harness(),start=h.authority.startSampler,finished=[];let preserved=false;
 h.authority.startSampler=async(...args)=>{if(args[0]==='mac-app')throw Error('failed startup');await delay(15);assert.equal(preserved,false);const v=await start(...args);finished.push(args[0]);return v};
 h.authority.preserve=async v=>{assert.equal(finished.length,5);preserved=true;h.preserved.push(v)};
 await assert.rejects(measurementPreapply(config(),h.authority));assert.equal(h.preserved[0].validatedSamplerRoles.length,5);
});
test('all six sampler starts are concurrent rather than remote-duration cumulative',async()=>{
 const h=harness(),start=h.authority.startSampler;let active=0,peak=0;
 h.authority.startSampler=async(...args)=>{active++;peak=Math.max(peak,active);await delay(10);active--;return start(...args)};
 await measurementPreapply(config(),h.authority);assert.equal(peak,6);
});
test('receipt bytes and expected pins captured before later callbacks mutate originals',async()=>{
 const h=harness(),start=h.authority.startSampler;
 h.authority.startSampler=async(...args)=>{for(const f of h.fixtures.values()){f.receiptBytes.fill(0);f.expected.sourceCommit='f'.repeat(40)}return start(...args)};
 const r=await measurementPreapply(config(),h.authority);assert.equal(r.ready,true);assert.equal(r.manifest.roles.length,6);
});
test('first samples are detached immutable and manifest hash survives callback mutations',async()=>{
 const h=harness(),start=h.authority.startSampler,inspect=h.authority.inspect,returned=[];let calls=0;
 h.authority.startSampler=async(...args)=>{const v=await start(...args);returned.push(v);return v};
 h.authority.inspect=async(...args)=>{if(++calls>6)for(const v of returned){v.firstSample.metrics.rssBytes=999;v.firstSample.raw.processes[0].rssBytes=999;v.configSha256='f'.repeat(64)}return inspect(...args)};
 const r=await measurementPreapply(config(),h.authority),before=r.manifestSha256;
 assert.equal(r.manifest.roles[0].firstSample.metrics.rssBytes,1024);assert.equal(r.manifest.roles[0].configSha256,'d'.repeat(64));
 returned[0].firstSample.raw.processes.length=0;assert.equal(r.manifest.roles[0].firstSample.raw.processes.length,1);
 assert.throws(()=>{r.manifest.roles[0].firstSample.metrics.rssBytes=1});
 const canon=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
 assert.equal(sha(canon(r.manifest)),before);
});
