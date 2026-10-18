// Physical receipts retain only this bounded observed identity, never arbitrary
// adapter fields, configuration paths, authentication responses or credentials.
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const text = (value, max = 160) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f]/.test(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
export function digestMap(value, { empty = false } = {}) {
  if (!record(value) || Object.keys(value).length > 64 || (!empty && !Object.keys(value).length)) throw new Error('artifact map missing or over bound');
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  if (entries.some(([name, hash]) => !text(name, 240) || !/^[A-Za-z0-9._/-]+$/.test(name)
    || name.split('/').some(part => part === '..' || part === '.') || !HASH.test(hash))) throw new Error('artifact map invalid');
  return Object.fromEntries(entries);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function normalizeIdentity(value, role, { expected = false } = {}) {
  if (!record(value) || value.schemaVersion !== 1 || value.role !== role
    || value.platform !== (role.startsWith('mac-') ? 'darwin' : 'win32')) throw new Error('identity role/platform missing or mismatched');
  const kind = role.endsWith('-cli') ? 'direct-file-driver' : role.endsWith('-web') ? 'browser' : 'private-acceptance';
  const principal = role.endsWith('-cli') ? 'workspace-owner-binding' : 'authenticated-account';
  if (value.artifactKind !== kind || value.principalKind !== principal || !HASH.test(value.principalScopeHash ?? '')
    || !text(value.runtimeName, 80) || !text(value.runtimeVersion, 100)) throw new Error('identity runtime/principal missing or invalid');
  const result = { schemaVersion: 1, role, platform: value.platform, artifactKind: kind,
    principalKind: principal, principalScopeHash: value.principalScopeHash,
    runtimeName: value.runtimeName, runtimeVersion: value.runtimeVersion, artifacts: digestMap(value.artifacts) };
  if (kind === 'browser') {
    if (!text(value.deploymentId, 160) || !text(value.browserVersion, 100)) throw new Error('observed browser/build version missing');
    if (!COMMIT.test(value.driverSourceCommit ?? '') || !HASH.test(value.sourceReceiptSha256 ?? '')) throw new Error('browser driver source receipt missing');
    result.driverSourceCommit = value.driverSourceCommit; result.sourceReceiptSha256 = value.sourceReceiptSha256;
    result.deploymentId = value.deploymentId; result.browserVersion = value.browserVersion;
    // A browser observes a serving deployment and loaded assets. Source mapping
    // belongs to the independently verified Oracle deployment pin, not the page.
    if (expected) { if (!COMMIT.test(value.sourceCommit ?? '')) throw new Error('trusted web source mapping missing'); result.sourceCommit = value.sourceCommit; }
    else if (value.sourceCommit !== undefined) throw new Error('browser cannot assert unobserved source commit');
  } else {
    if (!COMMIT.test(value.sourceCommit ?? '') || !HASH.test(value.sourceReceiptSha256 ?? '')) throw new Error('sealed source evidence missing');
    result.sourceCommit = value.sourceCommit; result.sourceReceiptSha256 = value.sourceReceiptSha256;
  }
  return result;
}
export function checkIdentity(value, pin, role) {
  const observed = normalizeIdentity(value, role), expected = normalizeIdentity(pin, role, { expected: true });
  if (role.endsWith('-web')) {
    const { sourceCommit, ...comparable } = expected;
    if (!same(observed, comparable)) throw new Error('observed browser identity does not match trusted deployment pin');
    return { ...observed, sourceCommit, sourceProvenance: 'trusted-web-deployment-pin' };
  }
  if (!same(observed, expected)) throw new Error('observed identity does not match expected artifact pins');
  return { ...observed, sourceProvenance: 'verified-source-receipt' };
}
export function normalizeInitialPack(value) {
  if (!record(value) || !HASH.test(value.packSha256 ?? '') || !HASH.test(value.bodySha256 ?? '')
    || !HASH.test(value.documentSha256 ?? '')) throw new Error('initial file fixture evidence missing');
  return { packSha256: value.packSha256, bodySha256: value.bodySha256,
    documentSha256: value.documentSha256, assetHashes: digestMap(value.assetHashes, { empty: true }) };
}
export function verifyReopenIdentity(receipt, config) {
  if (!record(receipt) || receipt.mode !== 'real' || receipt.status !== 'passed' || receipt.acceptance === 'none'
    || !Number.isInteger(receipt.roundsCompleted) || receipt.roundsCompleted < 1
    || receipt.fixture?.workspaceId !== config.fixture.workspaceId || receipt.fixture?.itemId !== config.fixture.itemId
    || receipt.finalHash !== config.expectedBaselineHash) throw new Error('reopen must reference a prior passing physical mutation receipt and exact fixture/hash');
  if (Boolean(receipt.scenario?.multiField) !== Boolean(config.multiField) || ((config.multiField || config.fileWrites || config.malformedRepair) && receipt.finalDocumentHash !== config.expectedDocumentHash) || JSON.stringify(receipt.scenario?.fileWrites ?? null) !== JSON.stringify(config.fileWrites ?? null) || JSON.stringify(receipt.scenario?.malformedRepair ?? null) !== JSON.stringify(config.malformedRepair ?? null)) throw new Error('reopen full document field pins differ from prior receipt');
  if (JSON.stringify(digestMap(receipt.expectedAssetHashes ?? {}, { empty: true })) !== JSON.stringify(digestMap(config.expectedAssetHashes ?? {}, { empty: true }))) throw new Error('reopen asset pins differ from prior receipt');
  for (const [role, pin] of Object.entries(config.expectedIdentities)) {
    const previous = normalizeIdentity(receipt.attestations?.[role]?.identity, role, { expected: true });
    if (!same(previous, normalizeIdentity(pin, role, { expected: true }))) throw new Error(`reopen identity pin changed for ${role}`);
  }
  return { runId: receipt.runId, finalHash: receipt.finalHash };
}
export function checkRestartAttestation(value, pin, role, { fixture, machineId, sessionId, generation }) {
  if (!record(value) || value.type !== 'attest' || value.round !== 0 || value.mode !== 'real' || value.adapter === 'fake-adapter'
    || value.machineId !== machineId || value.workspaceId !== fixture.workspaceId || value.itemId !== fixture.itemId
    || value.generation !== generation || typeof value.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.sessionId)
    || value.sessionId === sessionId) throw new Error('restarted actor mode, fixture, machine, generation or fresh session invalid');
  return { identity: checkIdentity(value.identity, pin, role), sessionId: value.sessionId };
}
