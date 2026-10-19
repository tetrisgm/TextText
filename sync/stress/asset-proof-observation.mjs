// Guarded readonly adapter seams. The browser callback MUST read the existing
// product-validated live inspection API; this module does not duplicate its schema.
import {validateAssetProofRequest} from './asset-proof.mjs';
import {inspectFileAssetPack,inspectServerAssetPack} from './asset-pack-proof.mjs';
import {documentObservation} from './multi-field.mjs';
import {canonicalJSON} from './identity-observation.mjs';

function ownData(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![null,Object.prototype].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) throw Error('Readonly asset authority unavailable');
  for (const key of keys) {
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor,'value')) throw Error('Readonly asset authority unavailable');
  }
}
async function captureAuthority(capture) {
  const value=await capture();
  ownData(value,['context','authorityHash']);
  ownData(value.context,['role','scopeHash','workspaceId','itemId','relativePath','selectedItemId','selectedPath']);
  const context=value.context;
  if (!['mac-web','pc-web','mac-cli','pc-cli'].includes(context.role) ||
      ['scopeHash','workspaceId','itemId'].some(key=>typeof context[key]!=='string') ||
      ['relativePath','selectedItemId','selectedPath'].some(key=>context[key]!==null && typeof context[key]!=='string')) throw Error('Readonly asset authority unavailable');
  if (typeof value.authorityHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.authorityHash) || value.authorityHash.length!==64) throw Error('Readonly asset authority unavailable');
  const canonical=canonicalJSON(value);
  return {canonical,context:JSON.parse(canonical).context};
}
async function unchanged(capture, before) {
  if ((await captureAuthority(capture)).canonical!==before.canonical) throw Error('Readonly asset authority changed');
}
function state(inspected, requiresValidatedLiveSnapshot) {
  return Object.freeze({assetProof:inspected.proof,documentSnapshot:inspected.documentSnapshot,
    assetProofRequiresValidatedLiveSnapshot:requiresValidatedLiveSnapshot});
}
export async function observeFileAssetProof(raw, {capture,readPack}) {
  const request=validateAssetProofRequest(raw);
  const before=await captureAuthority(capture);
  const bytes=await readPack();
  await unchanged(capture,before);
  const inspected=inspectFileAssetPack(bytes,{...before.context,sampleId:request.sampleId});
  if (inspected.requiresValidatedLiveSnapshot!==true) throw Error('Raw file validation boundary changed');
  // A filesystem actor has no product-renderer or full-schema authority.
  return state(inspected,true);
}
export async function observeBrowserAssetProof(raw, {capture,readPack,readValidatedLiveSnapshot}) {
  const request=validateAssetProofRequest(raw);
  const before=await captureAuthority(capture);
  const first=documentObservation(await readValidatedLiveSnapshot());
  await unchanged(capture,before);
  const pack=await readPack();
  await unchanged(capture,before);
  const last=documentObservation(await readValidatedLiveSnapshot());
  await unchanged(capture,before);
  ownData(pack,['bytes','envelope']);
  ownData(pack.envelope,['status','etag','encodedPath']);
  const relativePath=decodeURIComponent(pack.envelope.encodedPath);
  const inspected=inspectServerAssetPack(pack.bytes,{...before.context,relativePath,sampleId:request.sampleId},pack.envelope);
  if (inspected.requiresValidatedLiveSnapshot!==true || first.canonical!==last.canonical ||
      canonicalJSON(inspected.documentSnapshot)!==first.canonical) throw Error('Pack differs from product-validated live document');
  // The raw helper marker is discharged only by complete canonical equality
  // with both actual product-validated live reads, under unchanged authority.
  return state(inspected,false);
}

export function assertAssetProofObserveOnly(message) {
  if (message && Object.hasOwn(message,'assetProof')) {
    if (message.type!=='observe') throw Error('Asset proof is valid only on observe');
    validateAssetProofRequest(message.assetProof);
  }
}
