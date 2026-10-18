// Acceptance-driver fault only. The original authenticated browser request reaches
// production unchanged; CDP holds its response, verifies durable evidence, then
// fails delivery once. No forwarding request, replacement writer, or fake ACK.
import { createHash } from 'node:crypto';
const sha = x => createHash('sha256').update(x).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
export function validateLostAckScenario(value) {
  if (!value ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'role,round' ||
      !['mac-web', 'pc-web'].includes(value.role) ||
      value.round !== 1) throw Error('lostAck requires exactly one browser role and round1');
  return {
    role: value.role,
    round: 1
  };
}
export async function createLostAckFault({
  cdp,
  url,
  itemId,
  faultId,
  editId,
  verifyRequest,
  proveCommit
}) {
  if (!/^la-[a-f0-9]{32}$/.test(faultId) ||
      !/^r1-(mac|pc)-web$/.test(editId) ||
      new URL(url).origin !== 'https://texttext.app' ||
      typeof verifyRequest !== 'function' ||
      typeof proveCommit !== 'function') throw Error('lost ACK scope invalid');
  let error,
    activeCallbacks = 0,
    closed = false,
    bound,
    originalResult,
    candidates = 0;
  let value = {
    version: 1,
    faultId,
    editId,
    phase: 'armed',
    operationId: null,
    epoch: null,
    requestSha256: null,
    responseSha256: null,
    responseStatus: null,
    serverArchiveSha256: null,
    serverRevision: null,
    serverDocumentSha256: null,
    serverAssetHashes: null,
    dropped: 0,
    retries: 0,
    serverCommitted: false,
    exactRetry: false
  };
  const tree = await cdp.send('Page.getFrameTree');
  const frameId = tree?.frameTree?.frame?.id;
  if (typeof frameId !== 'string' || !frameId) throw Error('lost ACK frame identity unavailable');
  const listener = async event => {
    activeCallbacks += 1;
    try {
      if (error || closed || activeCallbacks > 1) throw Error('overlapping paused response');
      const request = event.request;
      if (event.frameId !== frameId ||
          request.url !== url ||
          request.method !== 'POST' ||
          event.responseStatusCode !== 200 ||
          typeof request.postData !== 'string' ||
          Buffer.byteLength(request.postData) > 4 * 1024 * 1024) throw Error('unexpected original response');
      const body = JSON.parse(request.postData);
      if (!body ||
          Object.keys(body).some(k => !['operationId', 'epoch', 'updates'].includes(k)) ||
          typeof body.operationId !== 'string' ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(body.operationId) ||
          !Number.isSafeInteger(body.epoch) ||
          body.epoch < 1 ||
          !Array.isArray(body.updates) ||
          !body.updates.length ||
          body.updates.length > 512 ||
          body.updates.some(x => typeof x !== 'string' ||
          !x)) throw Error('invalid immutable batch');
      const requestSha256 = sha(request.postData);
      if (bound && (bound.operationId !== body.operationId || bound.requestSha256 !== requestSha256)) throw Error('retry changed immutable batch');
      if (!(await verifyRequest(body))) throw Error('durable batch unavailable or changed');
      if (error) throw error;
      const response = await cdp.send('Fetch.getResponseBody', {
        requestId: event.requestId
      });
      if (error) throw error;
      const bytes = Buffer.from(response.body, response.base64Encoded ? 'base64' : 'utf8');
      if (bytes.length > 64 * 1024) throw Error('response outside bounds');
      const result = JSON.parse(bytes.toString('utf8'));
      if (Object.keys(result).sort().join(',') !== 'itemId,relativePath,revision,status' ||
          result.status !== 'written' ||
          result.itemId !== itemId ||
          typeof result.relativePath !== 'string' ||
          !HASH.test(result.revision)) throw Error('original write did not commit');
      if (bound) {
        if (JSON.stringify(result) !== JSON.stringify(originalResult)) throw Error('retry receipt changed');
        await cdp.send('Fetch.continueRequest', {
          requestId: event.requestId
        });
        value = {
          ...value,
          phase: 'replayed',
          retries: value.retries + 1,
          exactRetry: true
        };
        return;
      }
      const proof = await proveCommit(result, body);
      if (error) throw error;
      if (proof?.eligible === false) {
        if (++candidates > 64) throw Error('Too many partial original batches');
        await cdp.send('Fetch.continueRequest', {
          requestId: event.requestId
        });
        return;
      }
      if (!proof ||
          !HASH.test(proof.archiveSha256) ||
          !HASH.test(proof.documentSha256) ||
          !proof.assetHashes ||
          Array.isArray(proof.assetHashes) ||
          Object.values(proof.assetHashes).some(x => !HASH.test(x))) throw Error('committed read proof invalid');
      bound = {
        operationId: body.operationId,
        requestSha256
      };
      originalResult = result;
      await cdp.send('Fetch.failRequest', {
        requestId: event.requestId,
        errorReason: 'Failed'
      });
      value = {
        ...value,
        phase: 'dropped',
        operationId: body.operationId,
        epoch: body.epoch,
        requestSha256,
        responseSha256: sha(bytes),
        responseStatus: 200,
        serverArchiveSha256: proof.archiveSha256,
        serverRevision: result.revision,
        serverDocumentSha256: proof.documentSha256,
        serverAssetHashes: proof.assetHashes,
        dropped: 1,
        serverCommitted: true
      };
    } catch {
      error = Error('lost ACK fault refused; original batch and browser journals preserved');
      try {
        await cdp.send('Fetch.failRequest', {
          requestId: event.requestId,
          errorReason: 'Aborted'
        });
      } catch {}
    } finally {
      activeCallbacks -= 1;
    }
  };
  cdp.on('Fetch.requestPaused', listener);
  try {
    await cdp.send('Fetch.enable', {
      patterns: [{
        urlPattern: url,
        resourceType: 'Fetch',
        requestStage: 'Response'
      }]
    });
  } catch (e) {
    cdp.off('Fetch.requestPaused', listener);
    throw e;
  }
  return {
    proof() {
      if (error) throw error;
      return structuredClone(value);
    },
    async close() {
      if (closed) return;
      if (activeCallbacks) throw Error('lost ACK response still paused');
      closed = true;
      await cdp.send('Fetch.disable');
      cdp.off('Fetch.requestPaused', listener);
      await cdp.detach?.();
    }
  };
}

// Runs only inside the already authenticated owned page. Readonly existing DB;
// never opens a missing database or repairs/migrates browser journals.
export async function readLostAckJournal({
  origin,
  accountId,
  workspaceId,
  itemId,
  body = null
}) {
  if (location.origin !== origin || typeof accountId !== 'string') return false;
  const namespace = 'texttext:file-collaboration:v2:' + JSON.stringify([origin, accountId, workspaceId, itemId]);
  const key = sessionStorage.getItem(namespace + ':owner');
  if (!key || key !== namespace && !key.startsWith(namespace + ':owner:')) return false;
  if (typeof indexedDB.databases !== 'function' || !(await indexedDB.databases()).some(x => x.name === 'texttext-file-collaboration' && x.version === 1)) return false;
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open('texttext-file-collaboration', 1);
    r.onupgradeneeded = () => {
      r.transaction.abort();
      reject(Error('No existing journal'));
    };
    r.onerror = () => reject(Error('Journal unavailable'));
    r.onsuccess = () => resolve(r.result);
  });
  let stored;
  try {
    if (!db.objectStoreNames.contains('journals')) return false;
    stored = await new Promise((resolve, reject) => {
      const tx = db.transaction('journals', 'readonly');
      const r = tx.objectStore('journals').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(Error('Journal unavailable'));
    });
  } finally {
    db.close();
  }
  if (!stored || stored.schemaVersion !== 1 || stored.key !== key || stored.postId !== key || typeof stored.raw !== 'string' || stored.raw.length > 8 * 1024 * 1024) return false;
  const j = JSON.parse(stored.raw);
  if (j.version !== 1 || j.accountId !== accountId || j.retired || j.recovery || !Array.isArray(j.pending)) return false;
  if (body === null) return j.batch === null && !j.pending.length && !j.unqueuedDirty;
  return j.epoch === body.epoch && j.batch?.operationId === body.operationId && !j.batch.acknowledged && JSON.stringify(j.batch.updates) === JSON.stringify(body.updates);
}
export function validateLostAckProof(p, {
  faultId,
  editId,
  phase,
  assetHashes
}) {
  const keys = 'dropped,editId,epoch,exactRetry,faultId,operationId,phase,requestSha256,responseSha256,responseStatus,retries,serverArchiveSha256,serverAssetHashes,serverCommitted,serverDocumentSha256,serverRevision,version';
  if (!/^la-[a-f0-9]{32}$/.test(faultId ?? '') ||
      !/^r1-(mac|pc)-web$/.test(editId ?? '') ||
      !p ||
      Object.keys(p).sort().join(',') !== keys ||
      p.version !== 1 ||
      p.faultId !== faultId ||
      p.editId !== editId ||
      p.phase !== phase ||
      !Number.isInteger(p.retries) ||
      p.retries < 0 ||
      p.retries > 8) throw Error('lost ACK proof shape or scope invalid');
  if (phase === 'armed') {
    if (p.dropped !== 0 ||
        p.retries !== 0 ||
        p.serverCommitted !== false ||
        p.exactRetry !== false ||
        ['operationId', 'epoch', 'requestSha256', 'responseSha256', 'responseStatus', 'serverArchiveSha256', 'serverRevision', 'serverDocumentSha256', 'serverAssetHashes'].some(k => p[k] !== null)) throw Error('lost ACK arm proof invalid');
  } else if (!['dropped', 'replayed'].includes(phase) ||
      p.dropped !== 1 ||
      p.serverCommitted !== true ||
      p.responseStatus !== 200 ||
      typeof p.operationId !== 'string' ||
      !p.operationId ||
      p.operationId.length > 128 ||
      !Number.isInteger(p.epoch) ||
      p.epoch < 1 ||
      ['requestSha256', 'responseSha256', 'serverArchiveSha256', 'serverRevision', 'serverDocumentSha256'].some(k => !HASH.test(p[k])) ||
      p.exactRetry !== (phase === 'replayed') ||
      phase === 'replayed' &&
      p.retries < 1 ||
      phase === 'dropped' &&
      p.retries !== 0 ||
      !p.serverAssetHashes ||
      JSON.stringify(Object.entries(p.serverAssetHashes).sort()) !== JSON.stringify(Object.entries(assetHashes).sort())) throw Error('lost ACK durable evidence incomplete');
  return p;
}
