import test from 'node:test';
import assert from 'node:assert/strict';
import { FiniteSoak, SOAK_ROLES, SOAK_LIMITS, validateSoak } from './finite-soak.mjs';
const spec = {version:1,durationMs:3600000,cadenceMs:30000};
const make = (extra={}) => new FiniteSoak({spec,runId:'owned-1',startMs:100,identities:Object.fromEntries(SOAK_ROLES.map(role=>[role,'a'.repeat(64)])),oracle:(_role,value)=>value?.valid===true,...extra});
function reply(s, sample, role, now, extra={}) { return s.receive({sampleId:sample.sampleId,role,identity:'a'.repeat(64),observation:{valid:true},evidenceBytes:100,...extra},now); }
test('exact finite configuration refuses shorter dwell, future fields and cadence changes',()=>{
  assert.deepEqual(validateSoak(spec),spec);
  for(const value of [{...spec,durationMs:1000},{...spec,cadenceMs:1000},{...spec,version:2},{...spec,extra:true}]) assert.throws(()=>validateSoak(value));
});
test('121 correlated samples complete exactly60min without claiming missing telemetry',()=>{
  const s=make(); const ids=new Set();
  for(let i=0;i<121;i++) { const now=100+i*30000,p=s.begin(now);assert.ok(!ids.has(p.sampleId));ids.add(p.sampleId);for(const [n,r] of SOAK_ROLES.entries())assert.equal(reply(s,p,r,now+1),n===5); }
  const result=s.result(3600101);assert.equal(result.acceptance,'partial-not-full-T24');assert.equal(result.samples,121);assert.equal(result.nativeIdleMutations,null);assert.equal(result.resources,null);
});
test('duplicate stale unknown and identity drift responses fail terminally',()=>{
  for(const mutation of [{sampleId:'old'}, {role:'unknown'}, {identity:'b'.repeat(64)}]) {const s=make(),p=s.begin(100);assert.throws(()=>reply(s,p,'mac-app',101,mutation));assert.throws(()=>s.begin(30100),/failed/);}
  const s=make(),p=s.begin(100);reply(s,p,'mac-app',101);assert.throws(()=>reply(s,p,'mac-app',102),/duplicate/);
});
test('deadlines missed cadence overlap and backwards clocks refuse',()=>{
  assert.throws(()=>make().begin(99),/clock/);
  assert.throws(()=>make().begin(1101),/cadence/);
  const early=make();assert.throws(()=>early.begin(101+30000),/cadence/);
  const overlap=make();overlap.begin(100);assert.throws(()=>overlap.begin(101),/Overlapping/);
  const late=make(),p=late.begin(100);assert.throws(()=>reply(late,p,'mac-app',20101),/Late/);
  const missing=make();missing.begin(100);assert.throws(()=>missing.check(20101),/Missing/);
  assert.throws(()=>make().check(1101),/Missed/);
  assert.throws(()=>make().check(3620101),/total deadline/);
});
test('failed or throwing full oracle, incomplete results and bounded evidence refuse',()=>{
  for(const oracle of [()=>false,()=>Promise.resolve(true),()=>{throw Error('bad');}]) {const s=make({oracle}),p=s.begin(100);assert.throws(()=>reply(s,p,'mac-app',101),/oracle/);}
  const s=make(),p=s.begin(100);assert.throws(()=>reply(s,p,'mac-app',101,{evidenceBytes:SOAK_LIMITS.evidenceBytes+1}),/budget/);
  assert.throws(()=>make().result(100),/Incomplete/);
});
