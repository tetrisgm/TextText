import { createHash } from "node:crypto";
import * as Y from "yjs";
import { encodeDocumentBaseline, documentSnapshotFromYDoc } from "@/lib/collab/document";
import { MAX_UPDATE_CHARS } from "@/lib/collab/limits";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { openPack, encodePack } from "@/local-vault/pack";
import { readDocument, readTemplate, writePayload } from "@/local-vault/model";

export type VaultCollaborationState = { epoch: number; seq: number; revision: string; update: string };
export const MAX_VAULT_COLLABORATION_BYTES = 4 * 1024 * 1024;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function canonicalJSON(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : entry);
}
function canonicalDocument(snapshot: ReturnType<typeof validateDocumentSnapshot>): string {
  return canonicalJSON({ ...snapshot, content: { ...snapshot.content, subtitle: snapshot.content.subtitle || undefined } });
}
function fail(): never { throw new Error("Invalid or incomplete file collaboration state."); }
function decode(value: string, maximumChars: number): Uint8Array {
  if (typeof value !== "string" || !value.length || value.length > maximumChars || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail();
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail();
  return bytes;
}
function boundedState(doc: Y.Doc): string {
  const bytes = Y.encodeStateAsUpdate(doc);
  if (bytes.byteLength > MAX_VAULT_COLLABORATION_BYTES) fail();
  return Buffer.from(bytes).toString("base64");
}
function jsonValue(value: unknown, depth = 0): void {
  if (depth > 32) fail();
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) { for (const entry of value) jsonValue(entry, depth + 1); return; }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, entry] of Object.entries(value)) { if (["__proto__", "constructor", "prototype"].includes(key)) fail(); jsonValue(entry, depth + 1); }
    return;
  }
  fail();
}
function checkedSnapshot(doc: Y.Doc) {
  if (doc.store.pendingStructs || doc.store.pendingDs) fail();
  if ([...doc.share.keys()].some(key => key !== "document" && key !== "agentOperations")) fail();
  const root = doc.getMap("document");
  const allowed = ["schemaVersion", "title", "subtitle", "body", "fields", "tags", "assets", "presentation"];
  if (root._start !== null || root.size !== allowed.length || [...root.keys()].some(key => !allowed.includes(key)) || root.get("schemaVersion") !== 1) fail();
  for (const key of ["title", "subtitle", "body"]) {
    const text = root.get(key);
    if (!(text instanceof Y.Text) || text._map.size !== 0 || text.toDelta().some((part: { insert?: unknown; attributes?: unknown }) => typeof part.insert !== "string" || part.attributes)) fail();
  }
  const fields = root.get("fields"), tags = root.get("tags"), assets = root.get("assets"), presentation = root.get("presentation");
  if (!(fields instanceof Y.Map) || fields._start !== null || !(tags instanceof Y.Array) || tags._map.size !== 0 || !(assets instanceof Y.Array) || assets._map.size !== 0 || !(presentation instanceof Y.Map) || presentation._start !== null) fail();
  if (presentation.size !== 3 || [...presentation.keys()].some(key => !["templateId", "templateVersion", "theme"].includes(key))) fail();
  const theme = presentation.get("theme");
  if (!(theme instanceof Y.Map) || theme._start !== null) fail();
  for (const value of [...fields.values(), ...tags.toArray(), ...assets.toArray(), ...theme.values()]) jsonValue(value);
  if (doc.share.has("agentOperations")) {
    const operations = doc.getMap("agentOperations");
    if (operations._start !== null || operations.size > 256 || [...operations.values()].some(value => typeof value !== "number" || !Number.isFinite(value))) fail();
  }
  // Validate raw fields before the shared projection, which intentionally cleans
  // malformed fields for legacy callers. Collaboration must reject them instead.
  const snapshot = validateDocumentSnapshot({ schemaVersion: root.get("schemaVersion"), content: {
    title: (root.get("title") as Y.Text).toString(), subtitle: (root.get("subtitle") as Y.Text).toString() || undefined,
    body: (root.get("body") as Y.Text).toString(), fields: fields.toJSON(), tags: tags.toArray(), assets: assets.toArray(),
  }, presentation: { template: { id: presentation.get("templateId"), version: presentation.get("templateVersion") }, theme: theme.toJSON() } });
  if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_VAULT_COLLABORATION_BYTES) fail();
  return validateDocumentSnapshot(JSON.parse(canonicalJSON(documentSnapshotFromYDoc(doc))));
}

export function seedVaultCollaboration(bytes: Uint8Array, itemId: string, epoch: number): VaultCollaborationState {
  if (!Number.isSafeInteger(epoch) || epoch < 1 || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(itemId)) fail();
  const revision = hash(bytes);
  const pack = openPack(bytes, "Document.textpack", revision, itemId);
  const snapshot = readDocument(pack.file);
  readTemplate(pack.file, snapshot);
  if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_VAULT_COLLABORATION_BYTES) fail();
  const update = encodeDocumentBaseline(snapshot, `vault:${itemId}:${epoch}:${revision}`);
  if (update.byteLength > MAX_VAULT_COLLABORATION_BYTES) fail();
  return { epoch, seq: 0, revision, update: Buffer.from(update).toString("base64") };
}

export function applyVaultCollaboration(state: VaultCollaborationState, currentPackBytes: Uint8Array, updates: string[]): { state: VaultCollaborationState; bytes: Uint8Array } {
  if (!Number.isSafeInteger(state.epoch) || state.epoch < 1 || !Number.isSafeInteger(state.seq) || state.seq < 0 || state.seq >= Number.MAX_SAFE_INTEGER || state.revision !== hash(currentPackBytes)) fail();
  if (!Array.isArray(updates) || updates.length < 1 || updates.length > 64) fail();
  const baseline = decode(state.update, Math.ceil(MAX_VAULT_COLLABORATION_BYTES / 3) * 4);
  if (baseline.byteLength > MAX_VAULT_COLLABORATION_BYTES) fail();
  const decoded = updates.map(update => decode(update, MAX_UPDATE_CHARS));
  if (decoded.reduce((sum, bytes) => sum + bytes.byteLength, 0) > MAX_VAULT_COLLABORATION_BYTES) fail();
  const pack = openPack(currentPackBytes, "Document.textpack", state.revision);
  const before = readDocument(pack.file);
  const doc = new Y.Doc();
  try {
    doc.getMap("document");
    Y.applyUpdate(doc, baseline);
    if (canonicalDocument(checkedSnapshot(doc)) !== canonicalDocument(before)) fail();
    for (const update of decoded) Y.applyUpdate(doc, update);
    const snapshot = checkedSnapshot(doc);
    const update = boundedState(doc);
    const changedReference = JSON.stringify(before.presentation.template) !== JSON.stringify(snapshot.presentation.template);
    if (changedReference) {
      if (!pack.file.templateJSON) fail();
      const embedded = validateTemplateDefinition(JSON.parse(pack.file.templateJSON));
      if (embedded.id !== snapshot.presentation.template.id || embedded.version !== snapshot.presentation.template.version) fail();
    }
    readTemplate(pack.file, snapshot);
    let bytes = currentPackBytes;
    if (canonicalDocument(before) !== canonicalDocument(snapshot)) {
      const payload = writePayload(pack.file, snapshot);
      // Keep the original template bytes and opaque authoring metadata intact.
      bytes = encodePack(pack, { ...payload, templateJSON: pack.file.templateJSON, templateAuthoringSourceJSON: pack.file.templateAuthoringSourceJSON });
    }
    return { state: { epoch: state.epoch, seq: state.seq + 1, revision: hash(bytes), update }, bytes };
  } finally { doc.destroy(); }
}
