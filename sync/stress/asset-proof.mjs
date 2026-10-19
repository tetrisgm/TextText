// Readonly proof validation only. No adapter or writer is enabled by this module.
import { canonicalJSON } from './identity-observation.mjs';
import { documentObservation } from './multi-field.mjs';

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ROLES = ['mac-app', 'mac-web', 'mac-cli', 'pc-app', 'pc-web', 'pc-cli'];
function data(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('Expected plain proof object');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key =>
    !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) {
    throw Error('Proof keys must be exact own data fields');
  }
}
function uuid(value) { return typeof value === 'string' && value.length === 36 && UUID.test(value); }
function hash(value) { return typeof value === 'string' && value.length === 64 && HASH.test(value); }
function text(value, max) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= max &&
    !/[\x00-\x1f\x7f]/.test(value) && !/[\uD800-\uDFFF]/u.test(value);
}
function path(value, asset = false) {
  return text(value, 1024) && !/[\\:<>"|?*]/.test(value) && !value.startsWith('/') &&
    value.split('/').every(part => part && part !== '.' && part !== '..') &&
    (asset ? value.startsWith('assets/') : value.endsWith('.textpack'));
}
function plainTree(value, depth = 0) {
  if (depth > 32) throw Error('Document nesting exceeds bound');
  if (value === null || typeof value === 'boolean' || typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))) return;
  if (!value || typeof value !== 'object') throw Error('Document is not JSON data');
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (keys.length !== value.length + 1 || keys.some(key => typeof key !== 'string')) throw Error('Sparse or extended document array');
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('Accessor or sparse document array');
      plainTree(descriptor.value, depth + 1);
    }
  } else {
    data(value, keys);
    for (const key of keys) {
      if (typeof key !== 'string') throw Error('Symbol document field');
      plainTree(Object.getOwnPropertyDescriptor(value, key).value, depth + 1);
    }
  }
}
export function validateAssetProofConfig(value) {
  if (value === undefined) return undefined;
  data(value, ['version']);
  if (value.version !== 1) throw Error('Unsupported asset proof version');
  return Object.freeze({ version: 1 });
}
export function validateAssetProofRequest(value) {
  data(value, ['version', 'sampleId']);
  if (value.version !== 1 || !uuid(value.sampleId)) throw Error('Invalid asset proof sample');
  return Object.freeze({ version: 1, sampleId: value.sampleId });
}
export function validateAssetProof(value, context) {
  data(value, ['version', 'sampleId', 'source', 'scopeHash', 'workspaceId', 'itemId', 'relativePath',
    'archiveSha256', 'documentSha256', 'assetHashes', 'selectedItemId', 'selectedPath']);
  validateAssetProofRequest({ version: value.version, sampleId: value.sampleId });
  if (!ROLES.includes(context.role)) throw Error('Unknown proof role');
  const source = context.role.endsWith('-cli') ? 'direct-local-pack' :
    context.role.endsWith('-web') ? 'authenticated-server-pack' : 'native-local-pack';
  if (value.sampleId !== context.sampleId || value.source !== source || value.scopeHash !== context.scopeHash ||
      value.workspaceId !== context.workspaceId || value.itemId !== context.itemId || value.relativePath !== context.relativePath ||
      !uuid(value.workspaceId) || !uuid(value.itemId) || !hash(value.scopeHash) || !hash(value.archiveSha256) || !hash(value.documentSha256) ||
      !path(value.relativePath)) throw Error('Asset proof identity or scope mismatch');
  if (context.role.endsWith('-cli') ? value.selectedItemId !== null || value.selectedPath !== null :
    value.selectedItemId !== value.itemId || (context.role.endsWith('-web') ? value.selectedPath !== null : value.selectedPath !== value.relativePath)) {
    throw Error('Asset proof selected session mismatch');
  }
  const assets = validateAssetHashes(value.assetHashes);
  plainTree(context.documentSnapshot);
  if (documentObservation(context.documentSnapshot).hash !== value.documentSha256) throw Error('Asset proof full document mismatch');
  // Detach the map so later actor mutations cannot alter accepted evidence.
  return Object.freeze({ ...value, assetHashes: assets });
}

// Shared strict transport map validator. The returned detached map is a pin or
// an observation according to its caller; it never manufactures observed data.
export function validateAssetHashes(assets) {
  data(assets, Reflect.ownKeys(assets));
  if (Reflect.ownKeys(assets).some(key => typeof key !== 'string')) throw Error('Invalid bounded asset map');
  const names = Object.keys(assets);
  if (names.length < 1 || names.length > 32 || names.some(name => !path(name, true) || !hash(assets[name]))) throw Error('Invalid bounded asset map');
  return Object.freeze(JSON.parse(canonicalJSON(assets)));
}
