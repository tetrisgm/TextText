// Pure byte inspection with bounded article-shape checks, not full schema validation.
// The canonical authority is src/lib/documents/model.ts. Future callers MUST compare
// this complete raw observation to an actual product-validated live snapshot before
// accepting proof or treating a projection mismatch as a pending/lag condition.
// Callers retain authenticated/stable-read authority; no adapter is activated here.
import { readPack, validateIdentity, LIMITS } from './file-adapter.mjs';
import { validateAssetProof } from './asset-proof.mjs';
import { documentObservation } from './multi-field.mjs';
import { sha256 } from './identity-observation.mjs';

export class AssetPackInspectionError extends Error {
  constructor(code) {
    super(code === 'projection-mismatch' ? 'Pack projection differs from its bounded document observation.' : 'Pack proof inspection refused.');
    this.code = code;
  }
}
function exactData(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) throw Error();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw Error();
  }
}
function freezeTree(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}
function inspect(bytes, context, serverEnvelope, kind) {
  try {
    exactData(context, ['role', 'sampleId', 'scopeHash', 'workspaceId', 'itemId', 'relativePath', 'selectedItemId', 'selectedPath']);
    const server = context.role === 'mac-web' || context.role === 'pc-web';
    if (!server && !['mac-cli', 'pc-cli'].includes(context.role)) throw Error();
    if (server !== (kind === 'server')) throw Error();
    if (server !== (serverEnvelope !== undefined)) throw Error();
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > LIMITS.fileBytes ||
        bytes.buffer instanceof SharedArrayBuffer) throw Error();
    // Own a detached snapshot of the supplied stable read; never patch/repack it.
    const captured = Uint8Array.from(bytes);
    const pack = readPack(captured);
    const entry = leaf => pack.entries.find(value => value.name === pack.root + leaf);
    const markdownEntry = entry('text.md'), documentEntry = entry('document.json');
    if (!markdownEntry || !documentEntry || markdownEntry.data.byteLength > LIMITS.markdownBytes ||
        documentEntry.data.byteLength > 1024 * 1024) throw Error();
    const decoder = new TextDecoder('utf-8', {fatal: true});
    decoder.decode(markdownEntry.data);
    const parsed = JSON.parse(decoder.decode(documentEntry.data));
    const observed = documentObservation(parsed);
    const identity = validateIdentity(pack, {itemId: context.itemId, title: observed.snapshot.content.title});
    const assetHashes = Object.fromEntries(pack.entries.filter(value =>
      value.name.startsWith(pack.root + 'assets/') && !value.name.endsWith('/'))
      .map(value => [value.name.slice(pack.root.length), sha256(value.data)]));
    const proof = validateAssetProof({
      version: 1, sampleId: context.sampleId,
      source: server ? 'authenticated-server-pack' : 'direct-local-pack',
      scopeHash: context.scopeHash, workspaceId: context.workspaceId, itemId: context.itemId,
      relativePath: context.relativePath, archiveSha256: sha256(captured), documentSha256: observed.hash,
      assetHashes, selectedItemId: context.selectedItemId, selectedPath: context.selectedPath
    }, {...context, documentSnapshot: observed.snapshot});
    if (server) {
      exactData(serverEnvelope, ['status', 'etag', 'encodedPath']);
      if (serverEnvelope.status !== 200 || serverEnvelope.etag !== `"${proof.archiveSha256}"` ||
          typeof serverEnvelope.encodedPath !== 'string' || decodeURIComponent(serverEnvelope.encodedPath) !== context.relativePath) throw Error();
    }
    // This code reports only a raw body mismatch after the bounded checks above.
    // Hidden fields have NOT passed the full product schema. It grants no pending
    // classification or acceptance without the caller's validated live snapshot.
    if (identity.body !== observed.snapshot.content.body) throw new AssetPackInspectionError('projection-mismatch');
    return Object.freeze({proof, documentSnapshot: freezeTree(observed.snapshot), requiresValidatedLiveSnapshot: true});
  } catch (error) {
    if (error instanceof AssetPackInspectionError && error.code === 'projection-mismatch') throw error;
    throw new AssetPackInspectionError('invalid-pack');
  }
}
export function inspectFileAssetPack(bytes, context) {
  return inspect(bytes, context, undefined, 'file');
}
export function inspectServerAssetPack(bytes, context, envelope) {
  return inspect(bytes, context, envelope, 'server');
}
