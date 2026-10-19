// Pure staged oracle. Producers supply product validation; this module never
// validates or normalizes the product schema and enables no adapter capability.
import {validateAssetProof, validateAssetProofRequest, validateAssetHashes} from './asset-proof.mjs';
import {checkIdentity, normalizeIdentity} from './identity.mjs';
import {canonicalJSON, sha256} from './identity-observation.mjs';

export const ASSET_WAVE_ROLES = Object.freeze(['mac-app','mac-web','mac-cli','pc-app','pc-web','pc-cli']);
// One oracle owns a single pre/reopen convergence phase, not a whole100-round
// campaign. A future coordinator must construct a new owner with fresh checked
// pins for each phase; 256 bounds retries/UUID storage within that phase.
export const MAX_ASSET_WAVES = 256;
const fail = () => { throw Error('Invalid or unavailable same-wave asset evidence'); };
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length!==keys.length || keys.some(key=>
    !Object.hasOwn(descriptors,key) || !Object.hasOwn(descriptors[key],'value') || !descriptors[key].enumerable)) fail();
}
// Strict JSON transport boundary only; not a DocumentSnapshot schema validator.
function detach(value, depth=0, budget={nodes:0,bytes:0}) {
  if (++budget.nodes>100000 || depth>32) fail();
  if (value===null || typeof value==='boolean') return value;
  if (typeof value==='number') { if(!Number.isFinite(value)) fail(); return value; }
  if (typeof value==='string') { budget.bytes+=Buffer.byteLength(value); if(budget.bytes>512*1024) fail(); return value; }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value)!==Array.prototype) fail();
    if (Reflect.ownKeys(value).length!==value.length+1 || value.length>100000) fail();
    const result=[];
    for(let i=0;i<value.length;i++) {
      const d=Object.getOwnPropertyDescriptor(value,String(i));
      if(!d || !Object.hasOwn(d,'value') || !d.enumerable) fail();
      result.push(detach(d.value,depth+1,budget));
    }
    return result;
  }
  object(value,Reflect.ownKeys(value??{}));
  const result=Object.create(null);
  for(const key of Reflect.ownKeys(value)) {
    if(typeof key!=='string') fail();
    budget.bytes+=Buffer.byteLength(key); if(budget.bytes>512*1024) fail();
    result[key]=detach(Object.getOwnPropertyDescriptor(value,key).value,depth+1,budget);
  }
  return result;
}
function freeze(value) {
  if(value && typeof value==='object') { for(const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function session(value,role) {
  if(role.endsWith('-cli')) { if(value!==null) fail(); return; }
  object(value,['id','generation']);
  if(typeof value.id!=='string' || [...value.id].some(char=>!/[A-Za-z0-9_-]/.test(char)) || value.id.length<1 || value.id.length>160 ||
     !Number.isInteger(value.generation) || value.generation<1 || value.generation>10000) fail();
}

// Exact six roles; caller cannot reduce quorum. All times are supplied monotonic
// milliseconds. This owner rejects reused UUIDs and accepts only one active wave.
export function createAssetProofOracle(raw) {
  const config=detach(raw);
  object(config,['fixture','pins','timeoutMs','expectedAssetHashes']);
  config.expectedAssetHashes=validateAssetHashes(config.expectedAssetHashes);
  object(config.fixture,['workspaceId','itemId','relativePath']);
  object(config.pins,ASSET_WAVE_ROLES);
  for(const key of ['workspaceId','itemId']) {
    if(typeof config.fixture[key]!=='string' || config.fixture[key].length!==36 ||
       !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(config.fixture[key])) fail();
  }
  if(typeof config.fixture.relativePath!=='string' || Buffer.byteLength(config.fixture.relativePath)>1024 ||
     !config.fixture.relativePath.endsWith('.textpack') || /[\\:\x00-\x1f\x7f<>"|?*]/.test(config.fixture.relativePath) ||
     config.fixture.relativePath.split('/').some(part=>!part || part==='.' || part==='..')) fail();
  if(!Number.isInteger(config.timeoutMs) || config.timeoutMs<1 || config.timeoutMs>120000) fail();
  for(const role of ASSET_WAVE_ROLES) {
    object(config.pins[role],['identity','session']);
    normalizeIdentity(config.pins[role].identity,role,{expected:true});
    session(config.pins[role].session,role);
  }
  freeze(config);
  const used=new Set(); let current=null,lastTime=-Infinity,previous=null,stable=0,failed=false;
  function time(now) {
    if(failed || typeof now!=='number' || !Number.isFinite(now) || now<0 || now<lastTime || now>Number.MAX_SAFE_INTEGER) fail();
    lastTime=now;
  }
  function active(now) {
    time(now);
    if(!current || now>=current.deadline) fail();
  }
  function guarded(action) {
    try { return action(); } catch(error) { failed=true; current=null; throw error; }
  }
  return Object.freeze({
    begin(sampleId,now) { return guarded(()=>{
      time(now); if(current || used.size>=MAX_ASSET_WAVES) fail();
      validateAssetProofRequest({version:1,sampleId});
      if(used.has(sampleId) || now+config.timeoutMs>Number.MAX_SAFE_INTEGER) fail();
      used.add(sampleId); current={sampleId,deadline:now+config.timeoutMs,replies:new Map()};
      return Object.freeze({version:1,sampleId});
    }); },
    add(role,rawReply,now) { return guarded(()=>{
      active(now); if(!ASSET_WAVE_ROLES.includes(role) || current.replies.has(role)) fail();
      const reply=detach(rawReply);
      object(reply,['assetProof','documentSnapshot','assetProofRequiresValidatedLiveSnapshot','identity','session']);
      const pin=config.pins[role];
      const identity=checkIdentity(reply.identity,pin.identity,role);
      session(reply.session,role);
      if(canonicalJSON(reply.session)!==canonicalJSON(pin.session) ||
         reply.assetProofRequiresValidatedLiveSnapshot!==role.endsWith('-cli')) fail();
      const proof=validateAssetProof(reply.assetProof,{role,sampleId:current.sampleId,
        scopeHash:identity.principalScopeHash,...config.fixture,documentSnapshot:reply.documentSnapshot});
      current.replies.set(role,freeze({proof,documentSnapshot:reply.documentSnapshot,identity,session:reply.session}));
    }); },
    finish(now) { return guarded(()=>{
      active(now); if(current.replies.size!==6) fail();
      const replies=Object.fromEntries(ASSET_WAVE_ROLES.map(role=>[role,current.replies.get(role)]));
      const validated=replies['mac-app'];
      const canonical=canonicalJSON(validated.documentSnapshot),assets=canonicalJSON(validated.proof.assetHashes);
      if(assets!==canonicalJSON(config.expectedAssetHashes)) fail();
      for(const role of ASSET_WAVE_ROLES) {
        const reply=replies[role];
        if(canonicalJSON(reply.documentSnapshot)!==canonical || canonicalJSON(reply.proof.assetHashes)!==assets) fail();
      }
      // Archive hashes are independent across sources, stable per role only.
      const digest=canonicalJSON({canonical,roles:ASSET_WAVE_ROLES.map(role=>{
        const {sampleId,...proof}=replies[role].proof;
        return {role,proof,identity:replies[role].identity,session:replies[role].session};
      })});
      stable=digest===previous?stable+1:1; previous=digest;
      const result=freeze({sampleId:current.sampleId,documentSha256:sha256(canonical),
        assetHashes:detach(validated.proof.assetHashes),replies,stableWaves:stable,stable:stable>=3});
      current=null;return result;
    }); }
  });
}
