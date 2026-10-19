import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as Y from "yjs";
import { z } from "zod";
import { MAX_UPDATE_CHARS } from "@/lib/collab/limits";
import { documentSnapshotSchema } from "@/lib/documents/model";

const bounded = z.string().min(1).max(2048);
const generation = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const nativeHandoffScopeSchema = z.object({
  origin: z.string().url().max(2048).refine(value => { try { return new URL(value).origin === value; } catch { return false; } }), accountId: bounded, workspaceId: bounded, itemId: bounded,
  epoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
const intentSchema = z.object({
  id: z.string().uuid(), sourceGeneration: generation, sourceDocument: documentSnapshotSchema,
  update: z.string().min(1).max(MAX_UPDATE_CHARS), updateSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const schema = z.object({
  version: z.literal(2), generation, base: documentSnapshotSchema, document: documentSnapshotSchema,
  // A look change must finish through the existing file owner before handoff.
  look: z.null(),
  handoff: z.object({ version: z.literal(1), scope: nativeHandoffScopeSchema, legacyDraftSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), intents: z.array(intentSchema).max(2) }).strict(),
}).strict();
export type NativeHandoffDraft = z.infer<typeof schema>;
export type NativeHandoffScope = z.infer<typeof nativeHandoffScopeSchema>;
const LIMIT = 4 * 1024 * 1024;

export const handoffUpdateSha256 = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const textSha256 = (raw: string) => handoffUpdateSha256(new TextEncoder().encode(raw));

export function encodeHandoffUpdate(bytes: Uint8Array): string {
  let raw = ""; for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}
export function decodeHandoffUpdate(value: string): Uint8Array {
  if (value.length > MAX_UPDATE_CHARS || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw Error("Invalid retained handoff update.");
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  if (encodeHandoffUpdate(bytes) !== value) throw Error("Invalid retained handoff update.");
  Y.decodeUpdate(bytes);
  return bytes;
}
export function parseNativeHandoffDraft(raw: string, expected: NativeHandoffScope): NativeHandoffDraft {
  if (raw.length > LIMIT || new TextEncoder().encode(raw).byteLength > LIMIT) throw Error("The retained handoff draft is too large.");
  const draft = schema.parse(JSON.parse(raw));
  const scope = nativeHandoffScopeSchema.parse(expected);
  if (JSON.stringify(draft.handoff.scope) !== JSON.stringify(scope)) throw Error("The retained handoff belongs to another account or epoch.");
  let previous = -1; const ids = new Set<string>();
  for (const intent of draft.handoff.intents) {
    if (ids.has(intent.id) || intent.sourceGeneration < previous || intent.sourceGeneration > draft.generation) throw Error("Invalid retained handoff ordering.");
    ids.add(intent.id); previous = intent.sourceGeneration;
    if (handoffUpdateSha256(decodeHandoffUpdate(intent.update)) !== intent.updateSha256) throw Error("The retained handoff update changed.");
  }
  return draft;
}
/** Storage is the existing synchronous draft owner. Return only after the exact
 * record round-trips, before the caller may apply any newly recorded update. */
export function persistNativeHandoffDraft(storage: Pick<Storage, "getItem" | "setItem">, key: string, draft: NativeHandoffDraft): void {
  const raw = JSON.stringify(draft);
  parseNativeHandoffDraft(raw, draft.handoff.scope);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw Error("The handoff recovery copy could not be verified.");
}

/** Keep the original legacy draft at a content-addressed companion key before the first
 * format transition. An occupied different backup is a refusal, never replaced. */
export function preserveLegacyHandoffDraft(storage: Pick<Storage, "getItem" | "setItem">, key: string, expected: string | null): void {
  if (storage.getItem(key) !== expected) throw Error("The local recovery draft changed.");
  if (expected === null) return;
  const backup = key + ":before-handoff-v2:" + textSha256(expected);
  const retained = storage.getItem(backup);
  if (retained !== null && retained !== expected) throw Error("Another retained handoff draft needs recovery.");
  if (retained === null) storage.setItem(backup, expected);
  if (storage.getItem(backup) !== expected || storage.getItem(key) !== expected) throw Error("The original recovery draft could not be verified.");
}

/** One synchronous draft owner; native session/account guards are caller-owned.
 * This is not a cross-window lock. The native lease must already be verified. */
export class NativeHandoffDraftOwner {
  private raw: string | null;
  private draft: NativeHandoffDraft;
  private durable = true;
  constructor(private storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, private key: string,
    initial: Omit<NativeHandoffDraft, "version" | "look" | "handoff">, scope: NativeHandoffScope,
    proof: { version: 1; profileVersion: 4 }) {
    if (proof.version !== 1 || proof.profileVersion !== 4 || Object.keys(proof).length !== 2) throw Error("The native recovery format is not verified.");
    this.raw = storage.getItem(key);
    const saved = this.raw === null ? null : JSON.parse(this.raw);
    if (saved?.version === 2) {
      this.draft = parseNativeHandoffDraft(this.raw!, scope);
      const hash = this.draft.handoff.legacyDraftSha256;
      const legacy = hash === null ? null : storage.getItem(key + ":before-handoff-v2:" + hash);
      if (hash !== null && (legacy === null || textSha256(legacy) !== hash)) throw Error("The original handoff draft is missing or changed.");
    }
    else {
      if (saved && Object.prototype.hasOwnProperty.call(saved, "version")) throw Error("This recovery draft uses an unsupported format.");
      const draft: NativeHandoffDraft = { ...structuredClone(initial), version: 2, look: null, handoff: { version: 1, scope: nativeHandoffScopeSchema.parse(scope), legacyDraftSha256: this.raw === null ? null : textSha256(this.raw), intents: [] } };
      this.draft = parseNativeHandoffDraft(JSON.stringify(draft), scope);
      preserveLegacyHandoffDraft(storage, key, this.raw);
    }
  }
  capture() { return { generation: this.draft.generation, document: structuredClone(this.draft.document) }; }
  retained() { return structuredClone(this.draft); }
  assertCurrent() {
    if (!this.durable || this.storage.getItem(this.key) !== this.raw) throw Error("The handoff recovery draft changed or could not be saved.");
  }
  private persist(next: NativeHandoffDraft) {
    this.assertCurrent();
    try { persistNativeHandoffDraft(this.storage, this.key, next); }
    catch (error) { this.durable = false; throw error; }
    this.raw = JSON.stringify(next); this.draft = next;
  }
  remember(document: NativeHandoffDraft["document"], generation: number) {
    if (!Number.isSafeInteger(generation) || generation <= this.draft.generation) throw Error("The local draft generation changed.");
    this.persist({ ...this.draft, generation, document: structuredClone(document) });
  }
  record(update: Uint8Array, sourceGeneration: number, id: string) {
    this.assertCurrent();
    if (sourceGeneration !== this.draft.generation || this.draft.handoff.intents.length >= 2) throw Error("The retained handoff needs recovery before another transfer.");
    const intent = { id, sourceGeneration, sourceDocument: structuredClone(this.draft.document), update: encodeHandoffUpdate(update), updateSha256: handoffUpdateSha256(update) };
    this.persist({ ...this.draft, handoff: { ...this.draft.handoff, intents: [...this.draft.handoff.intents, intent] } });
  }
  acknowledge(generation: number) {
    this.assertCurrent();
    if (this.draft.generation !== generation) throw Error("Newer local input is still retained.");
    this.storage.removeItem(this.key);
    if (this.storage.getItem(this.key) !== null) throw Error("The acknowledged draft could not be cleared.");
    this.raw = null;
  }
}
