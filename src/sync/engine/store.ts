import * as Y from "yjs";
import { applyDocumentMutation, type DocumentMutation } from "@/lib/collab/document";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { watch, constants } from "node:fs";
import path from "node:path";
import { hostname } from "node:os";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import { openPack } from "@/local-vault/pack";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { reconcileTextpacks } from "./pack-reconcile";
import { seedVaultCollaboration, applyVaultCollaboration, projectVaultFileEdit, type VaultCollaborationState } from "./collaboration";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { validatedLookSource } from "@/lib/presentation/template-library";
import { mutateVaultItemCommentsInPack, type VaultCommentActor, type VaultCommentMutation } from "@/lib/vault/item-comments";
import { changeVaultPublicationInPack, samePublicationEntries } from "@/lib/vault/publication";

/** The caller supplies a trusted, dedicated server directory and authorizes the
 * workspace before calling this store. Pack bytes, including assets, are saved
 * unchanged. No database content is read or written here. */
export interface VaultLocation {
  root: string;
  workspaceId: string;
  /** Required when replaying a mutation containing an audit actor. The durable
   * receipt stays pending until this idempotent metadata sink succeeds. */
  onReceipt?: (receipt: VaultMutationReceipt) => Promise<void>;
}
export interface VaultWrite extends VaultLocation {
  beforeCommit?: (relativePath: string) => Promise<void>;
  signal?: AbortSignal;
  itemId: string;
  operationId: string;
  relativePath: string;
  baseRevision: string | null;
  bytes: Uint8Array;
  audit?: { actorUserId: string; actorType: "human" | "external_agent" };
  /** A verified local folder sync with an exact base revision. */
  liveReconcile?: boolean;
}
export type VaultWriteResult =
  | { status: "written"; itemId: string; relativePath: string; revision: string }
  | { status: "conflict"; itemId: string; relativePath: string; revision: string | null; conflictPath: string; deleted?: true };
export type VaultEntryResult =
  | { status: "moved" | "deleted" | "restored"; itemId: string; relativePath: string; revision: string }
  | { status: "conflict"; itemId: string; relativePath: string; revision: string | null; deleted?: true };
export interface VaultEntryMutation extends VaultLocation {
  beforeCommit?: (relativePath: string) => Promise<void>;
  signal?: AbortSignal;
  itemId: string; operationId: string; basePath: string; baseRevision: string;
  audit?: VaultWrite["audit"];
}
interface EntryIntent {
  kind: "move" | "delete"; workspaceId: string; itemId: string; operationId: string;
  basePath: string; baseRevision: string; relativePath: string; requestHash: string;
  audit?: VaultWrite["audit"];
}

interface RestoreIntent {
  kind: "restore"; workspaceId: string; itemId: string; operationId: string; basePath: string; baseRevision: string; relativePath: string; revision: string; requestHash: string; epoch: number; audit?: VaultWrite["audit"];
}

interface Intent {
  itemId: string; operationId: string; relativePath: string;
  baseRevision: string | null; revision: string; requestHash: string;
  workspaceId: string;
  audit?: VaultWrite["audit"];
  deletedRevision?: string;
  lifecycleMismatch?: boolean;
  collaboration?: VaultCollaborationState;
  commentAction?: "vault.comment.create" | "vault.comment.reply" | "vault.comment.resolve" | "vault.comment.reopen";
  publicationAction?: "vault.publish" | "vault.unpublish";
}
export interface VaultMutationReceipt {
  workspaceId: string; operationId: string;
  actorUserId: string; actorType: "human" | "external_agent";
  actionName?: Intent["commentAction"] | Intent["publicationAction"];
  result: VaultWriteResult | VaultEntryResult;
}
interface Receipt<T = VaultWriteResult | VaultEntryResult> { requestHash: string; result: T; mutation?: VaultMutationReceipt }

export class VaultBusyError extends Error {
  constructor() { super("Workspace vault is locked. Retry after its writer finishes."); }
}

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value);
function segment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw new Error("Invalid vault identifier");
  return value;
}
function packPath(value: string): string {
  const components = value.split("/");
  if (value.length > 1000 || !value.endsWith(".textpack") || components.some(
    (part) => !part || part === "." || part === ".." || part.startsWith(".") || /[\\\x00-\x1f:]/.test(part),
  )) throw new Error("Invalid TextPack relative path");
  return value;
}

function validatePack(bytes: Uint8Array, itemId?: string): string {
  if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw new Error("TextPack size exceeds 64 MiB");
  let totalSize = 0;
  let count = 0;
  const entries: string[] = [];
  const files = unzipSync(bytes, { filter(entry) {
    if (++count > 10000 || (totalSize += entry.originalSize) > 256 * 1024 * 1024) {
      throw new Error("Expanded TextPack exceeds limits");
    }
    if (entry.name.startsWith("/") || entry.name.includes("\\") ||
        entry.name.split("/").some((part) => part === "..")) throw new Error("Invalid TextPack entry path");
    if (entry.name === "document.json" || entry.name.endsWith("/document.json")) entries.push(entry.name);
    return entry.name === "document.json" || entry.name.endsWith("/document.json") ||
      entry.name === "text.md" || entry.name.endsWith("/text.md");
  } });
  if (entries.length !== 1) throw new Error("TextPack must contain one document.json");
  const documentPath = entries[0];
  const markdownPath = documentPath.replace(/document\.json$/, "text.md");
  if (!files[markdownPath]) throw new Error("TextPack is missing text.md");
  const markdown = strFromU8(files[markdownPath]).replace(/^\uFEFF/, "");
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1] ?? "";
  const identities = [...header.matchAll(/^textTextId:\s*(.*?)\s*$/gm)];
  if (identities.length !== 1) throw new Error("TextPack must contain exactly one textTextId");
  let identity: unknown = identities[0][1];
  try { identity = JSON.parse(identity as string); } catch { /* Bare IDs are also supported. */ }
  if (typeof identity !== "string") throw new Error("Invalid TextPack identity");
  segment(identity);
  if (itemId !== undefined && identity !== itemId) throw new Error("TextPack identity does not match its item identifier");
  validateDocumentSnapshot(JSON.parse(strFromU8(files[documentPath])));
  return identity;
}

async function maybeRead(file: string): Promise<Buffer | null> {
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Vault path is not a regular file");
    if (info.size > 64 * 1024 * 1024) throw new Error("Vault file exceeds 64 MiB");
    return await fs.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Server root is trusted; reject symlinks in every managed descendant. */
async function directory(parent: string, name: string): Promise<string> {
  const result = path.join(parent, name);
  await fs.mkdir(result).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const info = await fs.lstat(result);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Vault directory cannot be a symlink");
  return result;
}

async function syncDirectory(dir: string): Promise<void> {
  const handle = await fs.open(dir, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function atomicWrite(target: string, bytes: Uint8Array | string): Promise<void> {
  const temp = path.join(path.dirname(target), `.write-${randomUUID()}`);
  const handle = await fs.open(temp, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try { await fs.rename(temp, target); await syncDirectory(path.dirname(target)); }
  finally { await fs.rm(temp, { force: true }); }
}

async function fingerprint(file: string): Promise<string | null> {
  try {
    const info = await fs.lstat(file, { bigint: true });
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Vault path is not a regular file");
    return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function setup(location: VaultLocation) {
  if (!path.isAbsolute(location.root)) throw new Error("Vault root must be absolute");
  await fs.mkdir(location.root, { recursive: true });
  const root = await fs.realpath(location.root);
  const workspace = await directory(root, segment(location.workspaceId));
  const control = await directory(workspace, ".texttext");
  const pending = await directory(control, "pending");
  const receipts = await directory(control, "receipts");
  const items = await directory(control, "items");
  const conflicts = await directory(control, "conflicts");
  const locks = await directory(control, "locks");
  const history = await directory(control, "history");
  const removed = await directory(control, "removed");
  const collaboration = await directory(control, "collaboration");
  const presence = await directory(control, "presence");
  return { workspace, control, pending, receipts, items, conflicts, locks, history, removed, collaboration, presence, onReceipt: location.onReceipt };
}
type Layout = Awaited<ReturnType<typeof setup>>;

type IndexedItem = {
  itemId?: string;
  relativePath: string;
  revision?: string;
  fingerprint?: string;
  deleted?: boolean;
};

async function hasPendingWork(layout: Layout): Promise<boolean> {
  return (await fs.readdir(layout.pending)).length > 0;
}

type StableIndexedItem =
  | { status: "retry" }
  | { status: "missing" }
  | {
      status: "present";
      item: IndexedItem;
      metadataPath: string;
      metadataFingerprint: string;
      target: string;
      targetFingerprint: string;
      bytes?: Buffer;
    };

/** Read immutable-index and file snapshots without publishing any state. A
 * writer may begin immediately after this returns; that simply linearizes the
 * read before the writer. Changed fingerprints and durable pending intents
 * fall back to the writer lock, where recovery and checkpoint fencing run. */
async function stableIndexedItem(
  layout: Layout,
  itemId: string,
  includeBytes = false,
): Promise<StableIndexedItem> {
  if (await hasPendingWork(layout)) return { status: "retry" };
  const metadataPath = path.join(layout.items, `${itemId}.json`);
  const metadataBefore = await fingerprint(metadataPath);
  const raw = await maybeRead(metadataPath);
  if (!metadataBefore || !raw) {
    const metadataAfter = await fingerprint(metadataPath);
    return metadataBefore === metadataAfter && !(await hasPendingWork(layout))
      ? { status: "missing" }
      : { status: "retry" };
  }
  const item = JSON.parse(raw.toString()) as IndexedItem;
  if (item.itemId !== undefined && item.itemId !== itemId) throw new Error("Invalid vault item metadata");
  if (item.deleted) {
    const metadataAfter = await fingerprint(metadataPath);
    return metadataBefore === metadataAfter && !(await hasPendingWork(layout))
      ? { status: "missing" }
      : { status: "retry" };
  }
  const target = await targetPath(layout, item.relativePath);
  const targetBefore = await fingerprint(target);
  const bytes = includeBytes && targetBefore ? await maybeRead(target) : undefined;
  const [metadataAfter, targetAfter, pending] = await Promise.all([
    fingerprint(metadataPath),
    fingerprint(target),
    hasPendingWork(layout),
  ]);
  if (pending || metadataBefore !== metadataAfter || targetBefore !== targetAfter) return { status: "retry" };
  if (!targetBefore || (includeBytes && !bytes)) return { status: "retry" };
  return {
    status: "present",
    item,
    metadataPath,
    metadataFingerprint: metadataBefore,
    target,
    targetFingerprint: targetBefore,
    ...(bytes ? { bytes } : {}),
  };
}

async function targetPath(layout: Layout, relativePath: string): Promise<string> {
  const parts = packPath(relativePath).split("/");
  let parent = layout.workspace;
  for (const part of parts.slice(0, -1)) parent = await directory(parent, part);
  const target = path.join(parent, parts.at(-1)!);
  try {
    const info = await fs.lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Vault path is not a regular file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}

interface Contender { pid: number; host: string; choosing: boolean; ticket: string }

/** Lamport bakery mutex over atomic per-contender files on one server host.
 * Unique contender names make dead PID cleanup safe: deleting a dead writer's
 * record cannot delete a new writer's record. No clock expiry or lease stealing.
 * A shared network volume spanning multiple server hosts is unsupported.
 */
async function locked<T>(layout: Layout, action: () => Promise<T>): Promise<T> {
  const id = randomUUID();
  const lock = path.join(layout.locks, `${id}.json`);
  const own: Contender = { pid: process.pid, host: hostname(), choosing: true, ticket: "0" };
  const deadline = Date.now() + 10_000;
  async function contenders(): Promise<[string, Contender][]> {
    const result: [string, Contender][] = [];
    for (const name of await fs.readdir(layout.locks)) {
      if (!name.endsWith(".json")) continue; // Atomic write temporary files.
      const file = path.join(layout.locks, name);
      const bytes = await maybeRead(file);
      if (!bytes) continue;
      const peer = JSON.parse(bytes.toString()) as Contender;
      if (!Number.isInteger(peer.pid) || peer.pid <= 0 || !/^\d+$/.test(peer.ticket)) throw new Error("Invalid vault lock");
      if (peer.host !== hostname()) throw new Error("Vault locking requires one server host");
      try { process.kill(peer.pid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          await fs.rm(file, { force: true });
          continue;
        }
        if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      }
      result.push([name.slice(0, -5), peer]);
    }
    return result;
  }
  try {
    await atomicWrite(lock, json(own));
    const peers = await contenders();
    own.ticket = (peers.reduce((max, [, peer]) => BigInt(peer.ticket) > max ? BigInt(peer.ticket) : max, 0n) + 1n).toString();
    own.choosing = false;
    await atomicWrite(lock, json(own));
    for (;;) {
      const waiting = (await contenders()).some(([peerId, peer]) => peerId !== id && (
        peer.choosing || BigInt(peer.ticket) < BigInt(own.ticket) ||
        (peer.ticket === own.ticket && peerId < id)
      ));
      if (!waiting) break;
      if (Date.now() >= deadline) throw new VaultBusyError();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return await action();
  } finally { await fs.rm(lock, { force: true }); }
}

async function apply(layout: Layout, intent: Intent, pendingDir: string): Promise<VaultWriteResult> {
  const receiptPath = path.join(layout.receipts, `${segment(intent.operationId)}.json`);
  const existingReceipt = await maybeRead(receiptPath);
  if (existingReceipt) {
    const receipt = JSON.parse(existingReceipt.toString()) as Receipt<VaultWriteResult>;
    if (receipt.requestHash !== intent.requestHash) throw new Error("Operation id was reused");
    await deliverReceipt(layout, receipt);
    await fs.rm(pendingDir, { recursive: true });
    return receipt.result;
  }
  const bytes = await maybeRead(path.join(pendingDir, "payload.textpack"));
  if (!bytes || hash(bytes) !== intent.revision) throw new Error("Pending TextPack is missing or corrupt");
  const target = await targetPath(layout, intent.relativePath);
  const current = await maybeRead(target);
  const revision = current ? hash(current) : null;
  let result: VaultWriteResult;
  if (intent.deletedRevision || intent.lifecycleMismatch || (revision !== intent.baseRevision && revision !== intent.revision)) {
    const conflictPath = `.texttext/conflicts/${intent.operationId}.textpack`;
    await atomicWrite(path.join(layout.workspace, conflictPath), bytes);
    result = { status: "conflict", itemId: intent.itemId, relativePath: intent.relativePath,
      revision: intent.deletedRevision ?? revision, conflictPath, ...(intent.deletedRevision ? { deleted: true as const } : {}) };
  } else {
    const history = await directory(layout.history, segment(intent.itemId));
    if (current && revision) await atomicWrite(path.join(history, `${revision}.textpack`), current);
    await atomicWrite(path.join(history, `${intent.revision}.textpack`), bytes);
    if (revision !== intent.revision) await atomicWrite(target, bytes);
    await atomicWrite(path.join(layout.items, `${segment(intent.itemId)}.json`), json({
      itemId: intent.itemId, relativePath: intent.relativePath,
      revision: intent.revision,
    }));
    // The checkpoint and materialized pack are one replayable intent. A receipt
    // is never published before both are durable.
    const checkpointPath = path.join(layout.collaboration, `${segment(intent.itemId)}.json`);
    if (intent.collaboration) {
      if (intent.collaboration.revision !== intent.revision) throw new Error("Collaboration checkpoint revision mismatch");
      await atomicWrite(checkpointPath, json(intent.collaboration));
    } else {
      await observeCollaborationRevision(layout, intent.itemId, intent.revision);
    }
    result = { status: "written", itemId: intent.itemId, relativePath: intent.relativePath, revision: intent.revision };
  }
  const receipt: Receipt = { requestHash: intent.requestHash, result, ...(intent.audit ? {
    mutation: { workspaceId: intent.workspaceId, operationId: intent.operationId, ...intent.audit,
      ...(result.status === "written" && (intent.commentAction || intent.publicationAction)
        ? { actionName: intent.commentAction ?? intent.publicationAction } : {}), result },
  } : {}) };
  await atomicWrite(receiptPath, json(receipt));
  await deliverReceipt(layout, receipt);
  await fs.rm(pendingDir, { recursive: true });
  await syncDirectory(layout.pending);
  return result;
}

async function deliverReceipt(layout: Layout, receipt: Receipt): Promise<void> {
  if (!receipt.mutation) return;
  if (!layout.onReceipt) throw new Error("Vault mutation requires its audit sink");
  await layout.onReceipt(receipt.mutation);
}

async function createExclusive(target: string, bytes: Uint8Array): Promise<boolean> {
  const temp = path.join(path.dirname(target), `.write-${randomUUID()}`);
  await atomicWrite(temp, bytes);
  try {
    // An atomic no-replace publication. The temporary inode is independent of
    // retained history, so later in-place edits cannot change the archived pack.
    await fs.link(temp, target);
    await syncDirectory(path.dirname(target));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally { await fs.rm(temp, { force: true }); }
}

async function applyEntry(layout: Layout, intent: EntryIntent, pendingDir: string): Promise<VaultEntryResult> {
  const receiptPath = path.join(layout.receipts, `${segment(intent.operationId)}.json`);
  const oldReceipt = await maybeRead(receiptPath);
  if (oldReceipt) {
    const receipt = JSON.parse(oldReceipt.toString()) as Receipt<VaultEntryResult>;
    if (receipt.requestHash !== intent.requestHash) throw new Error("Operation id was reused");
    await deliverReceipt(layout, receipt);
    await fs.rm(pendingDir, { recursive: true });
    return receipt.result;
  }
  const metadataPath = path.join(layout.items, `${segment(intent.itemId)}.json`);
  const metadata = await maybeRead(metadataPath);
  const item = metadata ? JSON.parse(metadata.toString()) as {
    itemId: string; relativePath: string; revision?: string; deleted?: boolean;
  } : null;
  let result: VaultEntryResult;
  const source = await targetPath(layout, intent.basePath);
  const removedPath = path.join(layout.removed, `${intent.operationId}.textpack`);
  let removed = await maybeRead(removedPath);
  let current = await maybeRead(source);
  const movedCurrent = item && !item.deleted && item.relativePath !== intent.basePath
    ? await maybeRead(await targetPath(layout, item.relativePath)) : null;
  const conflict = (): VaultEntryResult => ({
    status: "conflict", itemId: intent.itemId, relativePath: item?.relativePath ?? intent.basePath,
    revision: item?.deleted ? item.revision ?? null : movedCurrent ? hash(movedCurrent) : current ? hash(current) : null,
    ...(item?.deleted ? { deleted: true as const } : {}),
  });
  if (item?.deleted && intent.kind === "delete" && item.relativePath === intent.basePath && item.revision === intent.baseRevision) {
    result = { status: "deleted", itemId: intent.itemId, relativePath: intent.basePath, revision: intent.baseRevision };
  } else if (!removed && (!item || item.deleted || item.relativePath !== intent.basePath || !current || hash(current) !== intent.baseRevision)) {
    result = conflict();
  } else if (intent.kind === "move" && intent.relativePath === intent.basePath) {
    result = { status: "moved", itemId: intent.itemId, relativePath: intent.relativePath, revision: intent.baseRevision };
  } else {
    const destination = intent.kind === "move" ? await targetPath(layout, intent.relativePath) : null;
    const destinationBytes = destination ? await maybeRead(destination) : null;
    if (!removed && destinationBytes && intent.relativePath.normalize("NFC").toLowerCase() !== intent.basePath.normalize("NFC").toLowerCase()) {
      result = conflict();
    } else {
      if (!removed) {
        // Move to retained storage first. A concurrent external replacement is
        // captured here and checked before any deletion is committed.
        await fs.rename(source, removedPath);
        await syncDirectory(path.dirname(source));
        await syncDirectory(layout.removed);
        removed = await maybeRead(removedPath);
      }
      current = await maybeRead(source);
      if (!removed || hash(removed) !== intent.baseRevision || current) {
        if (removed && !current) {
          await createExclusive(source, removed);
          current = await maybeRead(source);
        }
        result = conflict();
      } else if (destination && !(await createExclusive(destination, removed)) &&
          hash((await maybeRead(destination)) ?? new Uint8Array()) !== intent.baseRevision) {
        await createExclusive(source, removed);
        current = await maybeRead(source);
        result = conflict();
      } else {
        const history = await directory(layout.history, intent.itemId);
        await atomicWrite(path.join(history, `${intent.baseRevision}.textpack`), removed);
        await atomicWrite(metadataPath, json({ itemId: intent.itemId, relativePath: intent.relativePath,
          revision: intent.baseRevision, ...(intent.kind === "delete" ? { deleted: true } : {}),
        }));
        result = { status: intent.kind === "delete" ? "deleted" : "moved",
          itemId: intent.itemId, relativePath: intent.relativePath, revision: intent.baseRevision,
        };
      }
    }
  }
  const receipt: Receipt<VaultEntryResult> = { requestHash: intent.requestHash, result, ...(intent.audit ? {
    mutation: { workspaceId: intent.workspaceId, operationId: intent.operationId, ...intent.audit, result },
  } : {}) };
  await atomicWrite(receiptPath, json(receipt));
  await deliverReceipt(layout, receipt);
  await fs.rm(pendingDir, { recursive: true });
  await syncDirectory(layout.pending);
  return result;
}

async function mutateVaultEntry(input: VaultEntryMutation, kind: "move" | "delete", relativePath: string): Promise<VaultEntryResult> {
  segment(input.itemId); segment(input.operationId); packPath(input.basePath); packPath(relativePath);
  if (!/^[a-f0-9]{64}$/.test(input.baseRevision)) throw new Error("Invalid base revision");
  if (input.audit && !input.onReceipt) throw new Error("Vault mutation requires its audit sink");
  const requestHash = hash(json([kind, input.itemId, input.basePath, relativePath, input.baseRevision, input.audit ?? null]));
  const layout = await setup(input);
  return locked(layout, async () => {
    await recover(layout);
    input.signal?.throwIfAborted();
    const saved = await maybeRead(path.join(layout.receipts, `${input.operationId}.json`));
    if (saved) {
      const receipt = JSON.parse(saved.toString()) as Receipt<VaultEntryResult>;
      if (receipt.requestHash !== requestHash) throw new Error("Operation id was reused");
      await input.beforeCommit?.(receipt.result.relativePath);
      input.signal?.throwIfAborted();
      await deliverReceipt(layout, receipt);
      return receipt.result;
    }
    if (kind === "move") {
      for (const name of await fs.readdir(layout.items)) {
        const raw = await maybeRead(path.join(layout.items, name));
        if (!raw) continue;
        const item = JSON.parse(raw.toString()) as { itemId: string; relativePath: string; deleted?: boolean };
        if (!item.deleted && item.itemId !== input.itemId && item.relativePath.normalize("NFC").toLowerCase() === relativePath.normalize("NFC").toLowerCase()) {
          throw new Error("TextPack path belongs to another item");
        }
      }
    }
    await input.beforeCommit?.(input.basePath);
    input.signal?.throwIfAborted();
    const pendingDir = await directory(layout.pending, input.operationId);
    const intent: EntryIntent = { kind, workspaceId: input.workspaceId, itemId: input.itemId,
      operationId: input.operationId, basePath: input.basePath, baseRevision: input.baseRevision,
      relativePath, requestHash, ...(input.audit ? { audit: input.audit } : {}),
    };
    await atomicWrite(path.join(pendingDir, "intent.json"), json(intent));
    await syncDirectory(layout.pending);
    return applyEntry(layout, intent, pendingDir);
  });
}

export function moveVaultTextpack(input: VaultEntryMutation & { relativePath: string }) {
  return mutateVaultEntry(input, "move", input.relativePath);
}

export function deleteVaultTextpack(input: VaultEntryMutation) {
  return mutateVaultEntry(input, "delete", input.basePath);
}

/** Current tombstones only, unlike recovery history which also includes prior revisions. */
export async function listVaultTrash(input: VaultLocation) {
  const layout = await setup(input);
  return locked(layout, async () => {
    await recover(layout);
    const names = await recoveryNames(layout.items, 5000);
    const items: { itemId: string; relativePath: string; revision: string }[] = [];
    for (const name of names.names) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json$/.test(name)) continue;
      const raw = await maybeRead(path.join(layout.items, name));
      if (!raw || raw.length > 1024 * 1024) throw new Error("Invalid item metadata");
      const item = JSON.parse(raw.toString());
      if (!item.deleted) continue;
      segment(item.itemId); packPath(item.relativePath);
      if (!/^[a-f0-9]{64}$/.test(item.revision)) throw new Error("Invalid deleted revision");
      items.push({ itemId: item.itemId, relativePath: item.relativePath, revision: item.revision });
    }
    return { items, truncated: names.truncated };
  });
}

async function applyRestore(layout: Layout, intent: RestoreIntent, pendingDir: string): Promise<VaultEntryResult> {
  const saved = await maybeRead(path.join(layout.receipts, `${intent.operationId}.json`));
  if (saved) {
    const receipt = JSON.parse(saved.toString()) as Receipt<VaultEntryResult>;
    if (receipt.requestHash !== intent.requestHash) throw new Error("Operation id was reused");
    await deliverReceipt(layout, receipt);
    await fs.rm(pendingDir, { recursive: true });
    await syncDirectory(layout.pending);
    return receipt.result;
  }
  const payload = await maybeRead(path.join(pendingDir, "payload.textpack"));
  if (!payload || hash(payload) !== intent.revision) throw new Error("Invalid restore payload");
  validatePack(payload, intent.itemId);
  const target = await targetPath(layout, intent.relativePath);
  const current = await maybeRead(target);
  const metadataPath = path.join(layout.items, `${intent.itemId}.json`);
  const raw = await maybeRead(metadataPath);
  const item = raw ? JSON.parse(raw.toString()) : null;
  const alreadyRestored = item && !item.deleted && item.relativePath === intent.relativePath && item.revision === intent.revision;
  const tombstone = item?.deleted && item.relativePath === intent.basePath && item.revision === intent.baseRevision;
  let result: VaultEntryResult;
  if ((!tombstone && !alreadyRestored) || (current && hash(current) !== intent.revision)) {
    result = { status: "conflict", itemId: intent.itemId, relativePath: item?.relativePath ?? intent.basePath, revision: item?.revision ?? null };
  } else {
    const marker = unzipSync(payload, { filter: entry => entry.name === "texttext-lifecycle.json" })["texttext-lifecycle.json"];
    if (!marker) throw new Error("Missing restore lifecycle");
    // Fence old archive uploads before exposing the restored file. The intent
    // persists until every step and its audit receipt are durable.
    await atomicWrite(path.join(await directory(layout.control, "lifecycles"), `${intent.itemId}.json`), json({ marker: strFromU8(marker), lifecycle: intent.operationId, restoreFromRevision: intent.baseRevision }));
    const state = seedVaultCollaboration(payload, intent.itemId, intent.epoch);
    await atomicWrite(path.join(layout.collaboration, `${intent.itemId}.json`), json(state));
    await atomicWrite(path.join(await directory(layout.history, intent.itemId), `${intent.revision}.textpack`), payload);
    if (!current && !await createExclusive(target, payload)) throw new VaultBusyError();
    await atomicWrite(metadataPath, json({ itemId: intent.itemId, relativePath: intent.relativePath, revision: intent.revision }));
    result = { status: "restored", itemId: intent.itemId, relativePath: intent.relativePath, revision: intent.revision };
  }
  const receipt: Receipt<VaultEntryResult> = { requestHash: intent.requestHash, result, ...(intent.audit ? { mutation: { workspaceId: intent.workspaceId, operationId: intent.operationId, ...intent.audit, result } } : {}) };
  await atomicWrite(path.join(layout.receipts, `${intent.operationId}.json`), json(receipt));
  await deliverReceipt(layout, receipt);
  await fs.rm(pendingDir, { recursive: true });
  await syncDirectory(layout.pending);
  return result;
}

/** Same identity restore with a new archive lifecycle and collaboration epoch. */
export async function restoreVaultTextpack(input: VaultEntryMutation & { relativePath: string }): Promise<VaultEntryResult> {
  segment(input.itemId); segment(input.operationId); packPath(input.basePath); packPath(input.relativePath);
  if (!/^[a-f0-9]{64}$/.test(input.baseRevision)) throw new Error("Invalid deleted revision");
  if (input.audit && !input.onReceipt) throw new Error("Vault mutation requires its audit sink");
  const layout = await setup(input);
  const requestHash = hash(json(["restore", input.itemId, input.basePath, input.relativePath, input.baseRevision, input.audit ?? null]));
  return locked(layout, async () => {
    await recover(layout);
    const saved = await maybeRead(path.join(layout.receipts, `${input.operationId}.json`));
    if (saved) {
      const receipt = JSON.parse(saved.toString()) as Receipt<VaultEntryResult>;
      if (receipt.requestHash !== requestHash) throw new Error("Operation id was reused");
      await input.beforeCommit?.(receipt.result.relativePath);
      await deliverReceipt(layout, receipt);
      return receipt.result;
    }
    await input.beforeCommit?.(input.basePath);
    input.signal?.throwIfAborted();
    const raw = await maybeRead(path.join(layout.items, `${input.itemId}.json`));
    const item = raw ? JSON.parse(raw.toString()) : null;
    if (!item?.deleted || item.relativePath !== input.basePath || item.revision !== input.baseRevision) throw new Error("The deleted file changed. Refresh Trash before restoring it.");
    for (const name of await fs.readdir(layout.items)) {
      const indexed = JSON.parse((await fs.readFile(path.join(layout.items, name))).toString());
      if (!indexed.deleted && indexed.relativePath.normalize("NFC").toLowerCase() === input.relativePath.normalize("NFC").toLowerCase()) throw new Error("Restore destination is occupied");
    }
    if (await maybeRead(await targetPath(layout, input.relativePath))) throw new Error("Restore destination is occupied");
    const retained = await maybeRead(path.join(layout.history, input.itemId, `${input.baseRevision}.textpack`));
    if (!retained || hash(retained) !== input.baseRevision) throw new Error("Deleted file recovery is unavailable");
    validatePack(retained, input.itemId);
    const files = unzipSync(retained);
    files["texttext-lifecycle.json"] = strToU8(json({ version: 1, generation: input.operationId }));
    // Restoring content must never silently restore public audience access.
    for (const name of Object.keys(files)) if (name === "publication.json" || name.endsWith("/publication.json")) delete files[name];
    const payload = zipSync(files);
    const checkpoint = await maybeRead(path.join(layout.collaboration, `${input.itemId}.json`));
    const previousEpoch = checkpoint ? (JSON.parse(checkpoint.toString()) as VaultCollaborationState).epoch : 0;
    if (!Number.isSafeInteger(previousEpoch) || previousEpoch < 0 || previousEpoch >= Number.MAX_SAFE_INTEGER - 1) throw new Error("Invalid collaboration epoch");
    const pendingDir = await directory(layout.pending, input.operationId);
    await atomicWrite(path.join(pendingDir, "payload.textpack"), payload);
    const intent: RestoreIntent = { kind: "restore", workspaceId: input.workspaceId, itemId: input.itemId, operationId: input.operationId, basePath: input.basePath, baseRevision: input.baseRevision, relativePath: input.relativePath, revision: hash(payload), requestHash, epoch: previousEpoch + 1, ...(input.audit ? { audit: input.audit } : {}) };
    await atomicWrite(path.join(pendingDir, "intent.json"), json(intent));
    await syncDirectory(layout.pending);
    return applyRestore(layout, intent, pendingDir);
  });
}

async function recover(layout: Layout): Promise<void> {
  for (const name of await fs.readdir(layout.pending)) {
    segment(name);
    const pendingDir = path.join(layout.pending, name);
    const info = await fs.lstat(pendingDir);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid pending operation");
    const saved = await maybeRead(path.join(pendingDir, "intent.json"));
    // A payload without a committed intent never changed a visible document.
    if (!saved) { await fs.rm(pendingDir, { recursive: true }); continue; }
    const intent = JSON.parse(saved.toString()) as Intent | EntryIntent | RestoreIntent;
    if ("kind" in intent && intent.kind === "restore") await applyRestore(layout, intent, pendingDir);
    else if ("kind" in intent) await applyEntry(layout, intent, pendingDir);
    else await apply(layout, intent, pendingDir);
  }
}

export async function writeVaultTextpack(input: VaultWrite): Promise<VaultWriteResult> {
  if (input.audit && !input.onReceipt) throw new Error("Vault mutation requires its audit sink");
  segment(input.itemId); segment(input.operationId); packPath(input.relativePath);
  if (input.baseRevision !== null && !/^[a-f0-9]{64}$/.test(input.baseRevision)) throw new Error("Invalid base revision");
  validatePack(input.bytes, input.itemId);
  const revision = hash(input.bytes);
  const requestHash = hash(json([input.itemId, input.relativePath, input.baseRevision, revision,
    ...(input.liveReconcile ? ["local-file"] : []), ...(input.audit ? [input.audit] : [])]));
  const layout = await setup(input);
  return locked(layout, async () => {
    await recover(layout);
    input.signal?.throwIfAborted();
    const receipt = await maybeRead(path.join(layout.receipts, `${input.operationId}.json`));
    if (receipt) {
      const saved = JSON.parse(receipt.toString()) as Receipt<VaultWriteResult>;
      if (saved.requestHash !== requestHash) throw new Error("Operation id was reused with different content");
      await input.beforeCommit?.(saved.result.relativePath);
      input.signal?.throwIfAborted();
      await deliverReceipt(layout, saved);
      return saved.result;
    }
    // Identity is stable independently of title. Moves require a separate operation.
    let deletedRevision: string | undefined;
    for (const item of await fs.readdir(layout.items)) {
      const raw = await maybeRead(path.join(layout.items, item));
      if (!raw) continue;
      const saved = JSON.parse(raw.toString()) as { itemId: string; relativePath: string; deleted?: boolean; revision?: string };
      if (saved.deleted) {
        if (saved.itemId === input.itemId) deletedRevision = saved.revision;
        continue;
      }
      if (saved.itemId === input.itemId && saved.relativePath !== input.relativePath) throw new Error("Use a move operation to change a TextPack path");
      if (saved.itemId !== input.itemId && saved.relativePath.normalize("NFC").toLowerCase() === input.relativePath.normalize("NFC").toLowerCase()) throw new Error("TextPack path belongs to another item");
    }
    // A restored file is a new lifecycle. Never merge a pre-delete archive into it.
    const lifecycleFile = path.join(layout.control, "lifecycles", `${input.itemId}.json`);
    const lifecycle = await maybeRead(lifecycleFile);
    let lifecycleMismatch = false;
    let lifecycleMarker: string | undefined;
    if (lifecycle) {
      const expected = JSON.parse(lifecycle.toString()) as { marker: string };
      const marker = unzipSync(input.bytes, { filter: entry => entry.name === "texttext-lifecycle.json" })["texttext-lifecycle.json"];
      if (typeof expected.marker !== "string") throw new Error("Invalid file lifecycle");
      lifecycleMarker = expected.marker;
      lifecycleMismatch = !marker || strFromU8(marker) !== expected.marker;
    }
    // Compare against the exact last shared archive, including assets. Resolve
    // the merge before committing the intent so restart replay is deterministic.
    let committedBytes = input.bytes;
    let committedBase = input.baseRevision;
    if (input.baseRevision !== null && !deletedRevision && !lifecycleMismatch) {
      const target = await targetPath(layout, input.relativePath);
      const current = await maybeRead(target);
      if (current && hash(current) !== input.baseRevision && hash(current) !== revision) {
        const history = await directory(layout.history, input.itemId);
        const base = await maybeRead(path.join(history, `${input.baseRevision}.textpack`));
        if (base && hash(base) === input.baseRevision) {
          // A current marker on incoming bytes does not make an older baseline
          // part of this lifecycle. Never reconcile across the restore boundary.
          if (lifecycleMarker !== undefined) {
            const baseMarker = unzipSync(base, { filter: entry => entry.name === "texttext-lifecycle.json" })["texttext-lifecycle.json"];
            lifecycleMismatch = !baseMarker || strFromU8(baseMarker) !== lifecycleMarker;
          }
          if (!lifecycleMismatch) {
            const merged = reconcileTextpacks(base, input.bytes, current);
            if (merged.status === "merged") {
              committedBytes = merged.bytes;
              committedBase = hash(current);
            }
          }
        }
      }
    }
    // Public visibility is changed only by the explicit publication writer.
    // Compare the resolved merge, so an offline edit may safely preserve a
    // marker published since its baseline without being allowed to forge one.
    const current = await maybeRead(await targetPath(layout, input.relativePath));
    if (!lifecycleMismatch && !samePublicationEntries(current, committedBytes)) throw new Error("Use Publish or Unpublish to change public visibility");
    await input.beforeCommit?.(input.relativePath);
    input.signal?.throwIfAborted();
    const pendingDir = await directory(layout.pending, input.operationId);
    await atomicWrite(path.join(pendingDir, "payload.textpack"), committedBytes);
    const intent: Intent = { itemId: input.itemId, operationId: input.operationId,
      relativePath: input.relativePath, baseRevision: committedBase, revision: hash(committedBytes), requestHash,
      workspaceId: input.workspaceId, ...(input.audit ? { audit: input.audit } : {}) };
    if (lifecycleMismatch) intent.lifecycleMismatch = true;
    if (!lifecycleMismatch && input.liveReconcile && input.baseRevision !== null && current && committedBase === hash(current) &&
        intent.revision !== committedBase) {
      const checkpoint = await maybeRead(path.join(layout.collaboration, `${input.itemId}.json`));
      if (checkpoint) {
        try {
          intent.collaboration = projectVaultFileEdit(JSON.parse(checkpoint.toString()) as VaultCollaborationState,
            current, committedBytes, input.itemId) ?? undefined;
        } catch { /* Unsupported or ambiguous file edits keep the epoch fence. */ }
      }
    }
    if (deletedRevision) intent.deletedRevision = deletedRevision;
    await atomicWrite(path.join(pendingDir, "intent.json"), json(intent));
    await syncDirectory(layout.pending);
    return apply(layout, intent, pendingDir);
  });
}

/** File collaboration remains behind the store boundary. HTTP callers must
 * authorize each request; this layer never infers access from a file identity. */
export class VaultCollaborationEpochError extends Error {
  constructor(readonly epoch: number) { super("The file changed outside this collaboration session. Reopen and recover pending edits."); }
}
async function projectObservedMarkdown(layout: Layout, itemId: string, state: VaultCollaborationState,
  currentBytes: Uint8Array): Promise<VaultCollaborationState | null> {
  if (!/^[a-f0-9]{64}$/.test(state.revision)) return null;
  const previous = await maybeRead(path.join(layout.history, segment(itemId), `${state.revision}.textpack`));
  if (!previous || hash(previous) !== state.revision) return null;
  try {
    const before = openPack(previous, "Document.textpack", state.revision, itemId);
    const after = openPack(currentBytes, "Document.textpack", hash(currentBytes), itemId);
    // document.json is the file edit's base witness. If it changed, a raw
    // replacement might have come from an older copy and must start a new epoch.
    if (before.file.documentJSON !== after.file.documentJSON) return null;
    return projectVaultFileEdit(state, previous, currentBytes, itemId);
  } catch { return null; }
}

async function observeCollaborationRevision(layout: Layout, itemId: string, revision: string | null,
  rawFileObservation = false) {
  const file = path.join(layout.collaboration, `${segment(itemId)}.json`);
  const raw = await maybeRead(file);
  if (!raw) return;
  const state = JSON.parse(raw.toString()) as VaultCollaborationState;
  if (!state.revision || state.revision === revision) return;
  if (rawFileObservation && revision) {
    const item = await collaborationItem(layout, itemId);
    if (item && item.revision === revision) {
      const projected = await projectObservedMarkdown(layout, itemId, state, item.bytes);
      if (projected) {
        await atomicWrite(path.join(await directory(layout.history, itemId), `${revision}.textpack`), item.bytes);
        await atomicWrite(file, json(projected));
        return;
      }
    }
  }
  await atomicWrite(file, json({ ...state, revision: "" }));
}
async function collaborationItem(layout: Layout, itemId: string) {
  const metadataPath = path.join(layout.items, `${segment(itemId)}.json`);
  const raw = await maybeRead(metadataPath);
  if (!raw) return null;
  const item = JSON.parse(raw.toString()) as { relativePath: string; deleted?: boolean };
  if (item.deleted) return null;
  const target = await targetPath(layout, item.relativePath);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await fingerprint(target);
    const bytes = before ? await maybeRead(target) : null;
    const after = await fingerprint(target);
    if (before !== after) continue;
    if (!bytes || !after) return null;
    validatePack(bytes, itemId);
    return { relativePath: item.relativePath, bytes, revision: hash(bytes),
      metadataPath, target, targetFingerprint: after };
  }
  throw new VaultBusyError();
}
async function collaborationCheckpoint(layout: Layout, itemId: string, item: NonNullable<Awaited<ReturnType<typeof collaborationItem>>>) {
  const file = path.join(layout.collaboration, `${itemId}.json`);
  const raw = await maybeRead(file);
  const saved = raw ? JSON.parse(raw.toString()) as VaultCollaborationState : null;
  if (saved && (!Number.isSafeInteger(saved.epoch) || saved.epoch < 1 || saved.epoch >= Number.MAX_SAFE_INTEGER)) throw new Error("Invalid collaboration epoch");
  if (saved?.revision === item.revision) {
    // A valid JSON file is not necessarily a valid Yjs baseline. Validate the
    // complete persisted state with a canonical empty update before serving it.
    applyVaultCollaboration(saved, item.bytes, ["AAA="], item.relativePath);
    return saved;
  }
  if (saved) {
    const projected = await projectObservedMarkdown(layout, itemId, saved, item.bytes);
    if (projected) {
      await atomicWrite(path.join(await directory(layout.history, itemId), `${item.revision}.textpack`), item.bytes);
      await atomicWrite(file, json(projected));
      return projected;
    }
  }
  const state = seedVaultCollaboration(item.bytes, itemId, saved ? saved.epoch + 1 : 1);
  const historyPath = path.join(await directory(layout.history, itemId), `${item.revision}.textpack`);
  const history = await maybeRead(historyPath);
  if (history && hash(history) !== item.revision) throw new Error("Collaboration history is corrupt");
  if (!history) await atomicWrite(historyPath, item.bytes);
  await atomicWrite(file, json(state));
  return state;
}

type CachedCollaboration = {
  metadataPath: string;
  metadataFingerprint: string;
  target: string;
  targetFingerprint: string;
  checkpointPath: string;
  checkpointFingerprint: string;
  state: VaultCollaborationState & { relativePath: string };
  weight: number;
};
const collaborationReadCache = new Map<string, CachedCollaboration>();
const MAX_COLLABORATION_CACHE_ENTRIES = 32;
const MAX_COLLABORATION_CACHE_WEIGHT = 16 * 1024 * 1024;
let collaborationReadCacheWeight = 0;

function collaborationCacheKey(layout: Layout, itemId: string) {
  return `${layout.workspace}\0${itemId}`;
}

function dropCachedCollaboration(key: string) {
  const previous = collaborationReadCache.get(key);
  if (!previous) return;
  collaborationReadCache.delete(key);
  collaborationReadCacheWeight -= previous.weight;
}

function cacheCollaboration(key: string, value: CachedCollaboration) {
  dropCachedCollaboration(key);
  if (value.weight > MAX_COLLABORATION_CACHE_WEIGHT) return;
  collaborationReadCache.set(key, value);
  collaborationReadCacheWeight += value.weight;
  while (collaborationReadCache.size > MAX_COLLABORATION_CACHE_ENTRIES ||
      collaborationReadCacheWeight > MAX_COLLABORATION_CACHE_WEIGHT) {
    const oldest = collaborationReadCache.keys().next().value as string | undefined;
    if (!oldest) break;
    dropCachedCollaboration(oldest);
  }
}

async function readCachedCollaboration(layout: Layout, itemId: string) {
  const key = collaborationCacheKey(layout, itemId);
  const cached = collaborationReadCache.get(key);
  if (!cached || await hasPendingWork(layout)) return null;
  const [metadataFingerprint, targetFingerprint, checkpointFingerprint] = await Promise.all([
    fingerprint(cached.metadataPath),
    fingerprint(cached.target),
    fingerprint(cached.checkpointPath),
  ]);
  if (await hasPendingWork(layout) || metadataFingerprint !== cached.metadataFingerprint ||
      targetFingerprint !== cached.targetFingerprint || checkpointFingerprint !== cached.checkpointFingerprint) {
    dropCachedCollaboration(key);
    return null;
  }
  collaborationReadCache.delete(key);
  collaborationReadCache.set(key, cached);
  return { ...cached.state };
}

export async function readVaultCollaboration(input: VaultLocation & { itemId: string }) {
  segment(input.itemId);
  const layout = await setup(input);
  const cached = await readCachedCollaboration(layout, input.itemId);
  if (cached) return cached;
  const key = collaborationCacheKey(layout, input.itemId);
  const result = await locked(layout, async () => {
    await recover(layout);
    const item = await collaborationItem(layout, input.itemId);
    if (!item) return null;
    const state = { ...await collaborationCheckpoint(layout, input.itemId, item), relativePath: item.relativePath };
    const checkpointPath = path.join(layout.collaboration, `${input.itemId}.json`);
    const [metadataFingerprint, targetFingerprint, checkpointFingerprint] = await Promise.all([
      fingerprint(item.metadataPath),
      fingerprint(item.target),
      fingerprint(checkpointPath),
    ]);
    const cache = metadataFingerprint && targetFingerprint === item.targetFingerprint && checkpointFingerprint
      ? { metadataPath: item.metadataPath, metadataFingerprint, target: item.target, targetFingerprint,
          checkpointPath, checkpointFingerprint, state, weight: state.update.length * 2 + 512 }
      : null;
    return { state, cache };
  });
  if (!result) {
    dropCachedCollaboration(key);
    return null;
  }
  if (result.cache) cacheCollaboration(key, result.cache);
  return result.state;
}

/** Ephemeral human presence for file-backed items. Sessions live in separate
 * bounded files and share the vault writer lock with collaboration checkpoints,
 * so a changed or deleted TextPack fences every old heartbeat and reader. */
export const VAULT_PRESENCE_STALE_MS = 30_000;
const MAX_VAULT_PRESENCE_PEERS = 32;
const presenceClientId = /^p-[0-9a-f-]{36}$/;
export type VaultPresencePeer = {
  clientId: string; userName: string; color: string;
  role: "editor" | "viewer"; awareness: string | null;
};
type VaultPresenceRow = VaultPresencePeer & {
  principal: string; epoch: number; awarenessClientId: number;
  expiresAt: number; sessionExpiresAt: number;
};
type VaultPresenceLocation = VaultLocation & { itemId: string };
type VaultPresenceIdentity = {
  clientId: string; principal: string; epoch: number; awarenessClientId: number;
  sessionExpiresAt: number; userName: string; color: string;
  role: "editor" | "viewer";
};
export class VaultPresenceSessionError extends Error {
  constructor() { super("Join item presence again."); }
}
function validPresencePrincipal(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1024) return false;
  if (value.startsWith("account:")) return value.length > "account:".length;
  if (!value.startsWith("native-agent:")) return false;
  try {
    const identity = JSON.parse(value.slice("native-agent:".length));
    return Array.isArray(identity) && identity.length === 3 &&
      typeof identity[0] === "string" && identity[0].length > 0 && identity[0].length <= 256 && !/[\u0000-\u001f\u007f]/.test(identity[0]) &&
      typeof identity[1] === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/.test(identity[1]) &&
      typeof identity[2] === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(identity[2]) &&
      value === `native-agent:${JSON.stringify(identity)}`;
  } catch { return false; }
}
function validPresenceIdentity(value: VaultPresenceIdentity) {
  if (!presenceClientId.test(value.clientId) || !validPresencePrincipal(value.principal) ||
      !Number.isSafeInteger(value.epoch) || value.epoch < 1 ||
      !Number.isSafeInteger(value.awarenessClientId) || value.awarenessClientId < 0 || value.awarenessClientId > 0xffffffff ||
      !Number.isSafeInteger(value.sessionExpiresAt) || value.sessionExpiresAt <= Date.now() ||
      !value.userName.trim() || value.userName.length > 200 ||
      !/^#[0-9a-f]{6}$/i.test(value.color) || !["editor", "viewer"].includes(value.role)) {
    throw new Error("Invalid vault presence identity");
  }
}
async function presenceRows(layout: Layout, itemId: string, epoch: number) {
  const dir = await directory(layout.presence, segment(itemId));
  const rows: VaultPresenceRow[] = [];
  let scanned = 0;
  for await (const entry of await fs.opendir(dir)) {
    if (++scanned > MAX_VAULT_PRESENCE_PEERS * 4) throw new Error("Vault presence capacity exceeded");
    if (!presenceClientId.test(entry.name.replace(/\.json$/, "")) || !entry.name.endsWith(".json")) continue;
    const file = path.join(dir, entry.name);
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 24 * 1024) throw new Error("Invalid vault presence row");
    const row = JSON.parse(await fs.readFile(file, "utf8")) as VaultPresenceRow;
    if (row.clientId !== entry.name.slice(0, -5) || !Number.isSafeInteger(row.epoch) ||
        !Number.isSafeInteger(row.expiresAt) || !Number.isSafeInteger(row.sessionExpiresAt) ||
        !Number.isSafeInteger(row.awarenessClientId) || !validPresencePrincipal(row.principal) ||
        typeof row.userName !== "string" || typeof row.color !== "string" ||
        (row.role !== "editor" && row.role !== "viewer") ||
        (row.awareness !== null && (typeof row.awareness !== "string" || row.awareness.length > 20 * 1024))) {
      throw new Error("Invalid vault presence row");
    }
    if (row.epoch !== epoch || row.expiresAt <= Date.now() || row.sessionExpiresAt <= Date.now()) {
      await fs.rm(file);
      continue;
    }
    rows.push(row);
  }
  if (rows.length > MAX_VAULT_PRESENCE_PEERS) throw new Error("Vault presence capacity exceeded");
  return { dir, rows };
}
function disclosedPresence(rows: VaultPresenceRow[]): VaultPresencePeer[] {
  return rows.map(({ clientId, userName, color, role, awareness }) => ({ clientId, userName, color, role, awareness }));
}
async function currentPresence(layout: Layout, itemId: string) {
  await recover(layout);
  const item = await collaborationItem(layout, itemId);
  if (!item) {
    const dir = path.join(layout.presence, segment(itemId));
    try {
      const info = await fs.lstat(dir);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid vault presence directory");
      await fs.rm(dir, { recursive: true }); // Ephemeral sessions cannot survive item deletion.
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return null;
  }
  const state = await collaborationCheckpoint(layout, itemId, item);
  return { state, relativePath: item.relativePath, ...await presenceRows(layout, itemId, state.epoch) };
}
export async function readVaultPresence(input: VaultPresenceLocation) {
  segment(input.itemId);
  const layout = await setup(input);
  return locked(layout, async () => {
    const current = await currentPresence(layout, input.itemId);
    return current ? { epoch: current.state.epoch, presence: disclosedPresence(current.rows) } : null;
  });
}
export async function joinVaultPresence(input: VaultPresenceLocation & VaultPresenceIdentity & { beforeCommit?: (relativePath: string) => Promise<void> }) {
  segment(input.itemId); validPresenceIdentity(input);
  const layout = await setup(input);
  return locked(layout, async () => {
    const current = await currentPresence(layout, input.itemId);
    if (!current) return null;
    if (input.epoch !== current.state.epoch) throw new VaultCollaborationEpochError(current.state.epoch);
    if (current.rows.length >= MAX_VAULT_PRESENCE_PEERS) throw new Error("Vault presence capacity exceeded");
    if (current.rows.some(row => row.clientId === input.clientId)) throw new VaultPresenceSessionError();
    await input.beforeCommit?.(current.relativePath);
    if (input.sessionExpiresAt <= Date.now()) throw new VaultPresenceSessionError();
    const row: VaultPresenceRow = {
      clientId: input.clientId, principal: input.principal, epoch: input.epoch,
      awarenessClientId: input.awarenessClientId, sessionExpiresAt: input.sessionExpiresAt,
      userName: input.userName, color: input.color, role: input.role, awareness: null,
      expiresAt: Date.now() + VAULT_PRESENCE_STALE_MS,
    };
    await atomicWrite(path.join(current.dir, `${input.clientId}.json`), json(row));
    return { epoch: current.state.epoch, presence: disclosedPresence([...current.rows, row]) };
  });
}
export async function updateVaultPresence(input: VaultPresenceLocation & VaultPresenceIdentity & {
  awareness: string | null; beforeCommit?: (relativePath: string) => Promise<void>;
}) {
  segment(input.itemId); validPresenceIdentity(input);
  if (input.awareness !== null && (typeof input.awareness !== "string" || input.awareness.length > 20 * 1024)) throw new Error("Invalid vault presence awareness");
  const layout = await setup(input);
  return locked(layout, async () => {
    const current = await currentPresence(layout, input.itemId);
    if (!current) return null;
    if (input.epoch !== current.state.epoch) throw new VaultCollaborationEpochError(current.state.epoch);
    const existing = current.rows.find(row => row.clientId === input.clientId);
    if (!existing || existing.principal !== input.principal ||
        existing.awarenessClientId !== input.awarenessClientId || existing.sessionExpiresAt !== input.sessionExpiresAt) {
      throw new VaultPresenceSessionError();
    }
    await input.beforeCommit?.(current.relativePath);
    if (input.sessionExpiresAt <= Date.now()) throw new VaultPresenceSessionError();
    const row: VaultPresenceRow = { ...existing, userName: input.userName, color: input.color,
      role: input.role, awareness: input.awareness, expiresAt: Date.now() + VAULT_PRESENCE_STALE_MS };
    await atomicWrite(path.join(current.dir, `${input.clientId}.json`), json(row));
    return { epoch: current.state.epoch, presence: disclosedPresence(current.rows.map(peer => peer.clientId === input.clientId ? row : peer)) };
  });
}
export async function leaveVaultPresence(input: VaultPresenceLocation & Pick<VaultPresenceIdentity, "clientId" | "principal" | "epoch"> & {
  beforeCommit?: (relativePath: string) => Promise<void>;
}) {
  segment(input.itemId);
  if (!presenceClientId.test(input.clientId) || !validPresencePrincipal(input.principal)) throw new VaultPresenceSessionError();
  const layout = await setup(input);
  return locked(layout, async () => {
    const current = await currentPresence(layout, input.itemId);
    if (!current) return null;
    if (input.epoch !== current.state.epoch) throw new VaultCollaborationEpochError(current.state.epoch);
    const existing = current.rows.find(row => row.clientId === input.clientId);
    if (!existing || existing.principal !== input.principal) throw new VaultPresenceSessionError();
    await input.beforeCommit?.(current.relativePath);
    await fs.rm(path.join(current.dir, `${input.clientId}.json`));
    return { epoch: current.state.epoch, presence: disclosedPresence(current.rows.filter(row => row.clientId !== input.clientId)) };
  });
}
export async function pushVaultCollaboration(input: VaultLocation & {
  itemId: string; operationId: string; epoch: number; updates: string[];
  audit: NonNullable<VaultWrite["audit"]>;
  beforeCommit?: (relativePath: string) => Promise<void>;
  signal?: AbortSignal;
}): Promise<VaultWriteResult> {
  segment(input.itemId); segment(input.operationId);
  if (!input.audit || !input.onReceipt) throw new Error("Vault collaboration requires its audit sink");
  if (!Number.isSafeInteger(input.epoch) || input.epoch < 1) throw new Error("Invalid collaboration epoch");
  if (!Array.isArray(input.updates) || !input.updates.length || input.updates.length > 64 ||
      input.updates.some(update => typeof update !== "string" || update.length > 512 * 1024) ||
      input.updates.reduce((sum, update) => sum + update.length, 0) > 6 * 1024 * 1024) throw new Error("Collaboration update exceeds limits");
  const requestHash = hash(json(["collaboration", input.itemId, input.epoch, input.updates, input.audit]));
  const layout = await setup(input);
  return locked(layout, async () => {
    await recover(layout);
    input.signal?.throwIfAborted();
    const saved = await maybeRead(path.join(layout.receipts, `${input.operationId}.json`));
    if (saved) {
      const receipt = JSON.parse(saved.toString()) as Receipt<VaultWriteResult>;
      if (receipt.requestHash !== requestHash) throw new Error("Operation id was reused");
      await input.beforeCommit?.(receipt.result.relativePath);
      input.signal?.throwIfAborted();
      await deliverReceipt(layout, receipt);
      return receipt.result;
    }
    const item = await collaborationItem(layout, input.itemId);
    if (!item) throw new Error("Collaboration file is missing or deleted");
    const baseline = await collaborationCheckpoint(layout, input.itemId, item);
    if (baseline.epoch !== input.epoch) throw new VaultCollaborationEpochError(baseline.epoch);
    const next = applyVaultCollaboration(baseline, item.bytes, input.updates, item.relativePath);
    validatePack(next.bytes, input.itemId);
    await input.beforeCommit?.(item.relativePath);
    input.signal?.throwIfAborted();
    const pendingDir = await directory(layout.pending, input.operationId);
    await atomicWrite(path.join(pendingDir, "payload.textpack"), next.bytes);
    const intent: Intent = { itemId: input.itemId, operationId: input.operationId,
      relativePath: item.relativePath, baseRevision: item.revision, revision: next.state.revision,
      requestHash, workspaceId: input.workspaceId, audit: input.audit, collaboration: next.state };
    await atomicWrite(path.join(pendingDir, "intent.json"), json(intent));
    await syncDirectory(layout.pending);
    return apply(layout, intent, pendingDir);
  });
}

/** Atomic agent command: replay receipt before stale-revision checks. */
export async function mutateVaultDocument(input: VaultLocation & {
  itemId: string; operationId: string; expectedRevision: string; mutation: DocumentMutation;
  audit: NonNullable<VaultWrite["audit"]>;
  beforeCommit?: (relativePath: string) => Promise<void>;
  signal?: AbortSignal;
}): Promise<VaultWriteResult> {
  segment(input.itemId); segment(input.operationId);
  if (!input.audit || !input.onReceipt) throw new Error("Vault collaboration requires its audit sink");
  const requestHash = hash(json(["document-command", input.itemId, input.expectedRevision, input.mutation, input.audit]));
  if (json(input.mutation).length > 2 * 1024 * 1024) throw new Error("Document command exceeds limits");
  const layout = await setup(input);
  return locked(layout, async () => {
    await recover(layout);
    input.signal?.throwIfAborted();
    const saved = await maybeRead(path.join(layout.receipts, `${input.operationId}.json`));
    if (saved) {
      const receipt = JSON.parse(saved.toString()) as Receipt<VaultWriteResult>;
      if (receipt.requestHash !== requestHash) throw new Error("Operation id was reused");
      await input.beforeCommit?.(receipt.result.relativePath);
      input.signal?.throwIfAborted();
      await deliverReceipt(layout, receipt);
      return receipt.result;
    }
    const item = await collaborationItem(layout, input.itemId);
    if (!item) throw new Error("Collaboration file is missing or deleted");
    const baseline = await collaborationCheckpoint(layout, input.itemId, item);
    if (baseline.revision !== input.expectedRevision) throw new Error("The item changed. Read it again before editing.");
    const doc = new Y.Doc();
    let next: ReturnType<typeof applyVaultCollaboration>;
    try {
      Y.applyUpdate(doc, Buffer.from(baseline.update, "base64"));
      const vector = Y.encodeStateVector(doc);
      applyDocumentMutation(doc, input.mutation);
      // File commands keep exactly-once state in durable receipts. The legacy
      // SQL mutator adds a document-root operation map outside the file schema.
      doc.getMap("document").delete("agentOperations");
      const update = Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString("base64");
      next = applyVaultCollaboration(baseline, item.bytes, [update], item.relativePath);
    } finally { doc.destroy(); }
    validatePack(next.bytes, input.itemId);
    await input.beforeCommit?.(item.relativePath);
    input.signal?.throwIfAborted();
    const pendingDir = await directory(layout.pending, input.operationId);
    await atomicWrite(path.join(pendingDir, "payload.textpack"), next.bytes);
    const intent: Intent = { itemId: input.itemId, operationId: input.operationId,
      relativePath: item.relativePath, baseRevision: item.revision, revision: next.state.revision,
      requestHash, workspaceId: input.workspaceId, audit: input.audit, collaboration: next.state };
    await atomicWrite(path.join(pendingDir, "intent.json"), json(intent));
    await syncDirectory(layout.pending);
    return apply(layout, intent, pendingDir);
  });
}

/** Comments are a validated TextPack entry. The durable intent also adopts the
 * new archive hash in the Yjs checkpoint, so a metadata-only comment does not
 * eject live editors from an unchanged document. */
export async function mutateVaultItemComments(input: VaultLocation & {
  itemId: string; operationId: string; mutation: VaultCommentMutation; actor: VaultCommentActor;
  beforeCommit?: (relativePath: string) => Promise<void>; signal?: AbortSignal;
}): Promise<(VaultWriteResult | { status: "unchanged"; itemId: string; relativePath: string; revision: string }) & { commentId: string }> {
  segment(input.itemId); segment(input.operationId);
  if (!input.onReceipt) throw new Error("Vault comments require an audit sink");
  const audit = { actorUserId: input.actor.userId, actorType: input.actor.type };
  const requestHash = hash(json(["vault-comment", input.itemId, input.mutation, input.actor.userId,
    input.actor.type, input.actor.authorType ?? input.actor.type]));
  const layout = await setup(input);
  return locked(layout, async () => {
    await recover(layout);
    input.signal?.throwIfAborted();
    const saved = await maybeRead(path.join(layout.receipts, `${input.operationId}.json`));
    if (saved) {
      const receipt = JSON.parse(saved.toString()) as Receipt<VaultWriteResult>;
      if (receipt.requestHash !== requestHash) throw new Error("Operation id was reused");
      const current = await collaborationItem(layout, input.itemId);
      if (!current) throw new Error("Comment file is missing or deleted");
      await input.beforeCommit?.(current.relativePath);
      input.signal?.throwIfAborted();
      await deliverReceipt(layout, receipt);
      return { ...receipt.result, commentId: input.mutation.kind === "create" ? input.operationId : input.mutation.commentId };
    }
    const item = await collaborationItem(layout, input.itemId);
    if (!item) throw new Error("Comment file is missing or deleted");
    const baseline = await collaborationCheckpoint(layout, input.itemId, item);
    const next = mutateVaultItemCommentsInPack(item.bytes, input.itemId, input.operationId, input.mutation, input.actor);
    await input.beforeCommit?.(item.relativePath);
    input.signal?.throwIfAborted();
    if (!next.changed) return { status: "unchanged", itemId: input.itemId, relativePath: item.relativePath,
      revision: item.revision, commentId: next.commentId };
    validatePack(next.bytes, input.itemId);
    const revision = hash(next.bytes);
    const pendingDir = await directory(layout.pending, input.operationId);
    await atomicWrite(path.join(pendingDir, "payload.textpack"), next.bytes);
    const commentAction = input.mutation.kind === "create"
      ? input.mutation.parentId ? "vault.comment.reply" : "vault.comment.create"
      : input.mutation.resolved ? "vault.comment.resolve" : "vault.comment.reopen";
    const intent: Intent = { itemId: input.itemId, operationId: input.operationId,
      relativePath: item.relativePath, baseRevision: item.revision, revision, requestHash,
      workspaceId: input.workspaceId, audit, commentAction,
      collaboration: { ...baseline, revision } };
    await atomicWrite(path.join(pendingDir, "intent.json"), json(intent));
    await syncDirectory(layout.pending);
    return { ...await apply(layout, intent, pendingDir), commentId: next.commentId };
  });
}

/** The only app write that may add or remove a TextPack's publication marker.
 * Revision matching makes the owner explicitly publish the saved content they
 * saw. The checkpoint remains at the same Yjs epoch for this metadata edit. */
export async function mutateVaultPublication(input: VaultLocation & {
  itemId: string; operationId: string; baseRevision: string; published: boolean;
  audit: NonNullable<VaultWrite["audit"]>;
  beforeCommit?: (relativePath: string) => Promise<void>; signal?: AbortSignal;
}): Promise<VaultWriteResult | { status: "unchanged" | "stale"; itemId: string; relativePath: string; revision: string }> {
  segment(input.itemId); segment(input.operationId);
  if (!/^[a-f0-9]{64}$/.test(input.baseRevision) || typeof input.published !== "boolean") throw new Error("Invalid publication request");
  if (!input.onReceipt) throw new Error("Vault publication requires an audit sink");
  const requestHash = hash(json(["vault-publication", input.itemId, input.baseRevision, input.published, input.audit]));
  const layout = await setup(input);
  return locked(layout, async () => {
    await recover(layout);
    input.signal?.throwIfAborted();
    const saved = await maybeRead(path.join(layout.receipts, `${input.operationId}.json`));
    if (saved) {
      const receipt = JSON.parse(saved.toString()) as Receipt<VaultWriteResult>;
      if (receipt.requestHash !== requestHash) throw new Error("Operation id was reused");
      const current = await collaborationItem(layout, input.itemId);
      if (!current) throw new Error("Publication item is missing or deleted");
      await input.beforeCommit?.(current.relativePath);
      input.signal?.throwIfAborted();
      await deliverReceipt(layout, receipt);
      return receipt.result;
    }
    const item = await collaborationItem(layout, input.itemId);
    if (!item) throw new Error("Publication item is missing or deleted");
    if (item.revision !== input.baseRevision) return { status: "stale", itemId: input.itemId,
      relativePath: item.relativePath, revision: item.revision };
    const next = changeVaultPublicationInPack(item.bytes, input.published, input.operationId);
    await input.beforeCommit?.(item.relativePath);
    input.signal?.throwIfAborted();
    if (!next.changed) return { status: "unchanged", itemId: input.itemId, relativePath: item.relativePath, revision: item.revision };
    validatePack(next.bytes, input.itemId);
    const baseline = await collaborationCheckpoint(layout, input.itemId, item);
    const revision = hash(next.bytes);
    const pendingDir = await directory(layout.pending, input.operationId);
    await atomicWrite(path.join(pendingDir, "payload.textpack"), next.bytes);
    const intent: Intent = { itemId: input.itemId, operationId: input.operationId,
      relativePath: item.relativePath, baseRevision: item.revision, revision, requestHash,
      workspaceId: input.workspaceId, audit: input.audit,
      publicationAction: input.published ? "vault.publish" : "vault.unpublish",
      collaboration: { ...baseline, revision } };
    await atomicWrite(path.join(pendingDir, "intent.json"), json(intent));
    await syncDirectory(layout.pending);
    return apply(layout, intent, pendingDir);
  });
}

export type VaultRecoveryEntry = { id: string; path: string; kind: "deleted" | "revision" | "conflict"; savedAt: string; hash: string };
type RecoveryToken = { kind: VaultRecoveryEntry["kind"]; key: string; hash: string; source?: "history" };
const recoveryId = (token: RecoveryToken) => Buffer.from(JSON.stringify(token)).toString("base64url");
function recoveryToken(id: string): RecoveryToken {
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(id)) throw new Error("Invalid recovery identifier");
  const token = JSON.parse(Buffer.from(id, "base64url").toString()) as RecoveryToken;
  if (!["deleted", "revision", "conflict"].includes(token.kind) || !/^[a-f0-9]{64}$/.test(token.hash) || recoveryId(token) !== id) throw new Error("Invalid recovery identifier");
  if (token.source !== undefined && (token.source !== "history" || token.kind !== "deleted")) throw new Error("Invalid recovery source");
  if (Object.keys(token).some((key) => !["kind", "key", "hash", "source"].includes(key))) throw new Error("Invalid recovery identifier");
  segment(token.key);
  return token;
}
async function recoveryNames(directoryPath: string, limit: number) {
  const names: string[] = [];
  const directoryHandle = await fs.opendir(directoryPath);
  let truncated = false, scanned = 0;
  for await (const entry of directoryHandle) {
    if (scanned++ >= limit) { truncated = true; break; }
    if (entry.isFile() && !entry.isSymbolicLink()) names.push(entry.name);
  }
  return { names: names.sort(), truncated };
}
async function recoveryFile(file: string, maximum: number) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximum) throw new Error("Recovery file exceeds limits or is not a regular file");
    const bytes = await handle.readFile();
    if (bytes.length > maximum) throw new Error("Recovery file exceeds limits");
    return { bytes, savedAt: info.mtime.toISOString() };
  } finally { await handle.close(); }
}
async function recoveryJSON(file: string) {
  return JSON.parse((await recoveryFile(file, 1024 * 1024)).bytes.toString());
}
async function retainedLocation(layout: Layout, token: RecoveryToken, readMetadata = recoveryJSON): Promise<{ file: string; relativePath: string }> {
  if (token.kind === "revision" || token.source === "history") {
    const item = await readMetadata(path.join(layout.items, `${token.key}.json`));
    if (item.itemId !== token.key) throw new Error("Invalid recovery item");
    if (token.source === "history" && (!item.deleted || item.revision !== token.hash)) throw new Error("Deleted recovery metadata changed");
    const parent = path.join(layout.history, token.key), info = await fs.lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid recovery directory");
    return { file: path.join(parent, `${token.hash}.textpack`), relativePath: packPath(item.relativePath) };
  }
  const receipt = await readMetadata(path.join(layout.receipts, `${token.key}.json`));
  const result = receipt.result;
  if (token.kind === "deleted") {
    if (result?.status !== "deleted" || result.revision !== token.hash) throw new Error("Invalid deleted recovery entry");
    return { file: path.join(layout.removed, `${token.key}.textpack`), relativePath: packPath(result.relativePath) };
  }
  if (result?.status !== "conflict" || result.conflictPath !== `.texttext/conflicts/${token.key}.textpack`) throw new Error("Invalid conflict recovery entry");
  return { file: path.join(layout.conflicts, `${token.key}.textpack`), relativePath: packPath(result.relativePath) };
}
async function retainedBytes(file: string, maximum = 32 * 1024 * 1024) {
  return recoveryFile(file, maximum);
}

/** Read retained originals only. Recovery itself imports a new identity through the normal write API. */
export async function listVaultRecovery(input: VaultLocation & { path?: string }) {
  if (input.path !== undefined) packPath(input.path);
  const layout = await setup(input);
  const entries: VaultRecoveryEntry[] = [];
  let truncated = false, inspectedBytes = 0, metadataBudget = 8 * 1024 * 1024;
  const readMetadata = async (file: string) => {
    if (metadataBudget <= 0) throw new Error("Recovery metadata budget exhausted");
    const { bytes } = await recoveryFile(file, Math.min(1024 * 1024, metadataBudget));
    metadataBudget -= bytes.length;
    return JSON.parse(bytes.toString());
  };
  const candidates: RecoveryToken[] = [];
  if (input.path !== undefined) {
    const inventory = await recoveryNames(layout.items, 5000); truncated ||= inventory.truncated;
    for (const name of inventory.names) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json$/.test(name)) continue;
      try {
        const item = await readMetadata(path.join(layout.items, name));
        if (item.relativePath !== input.path) continue;
        segment(item.itemId);
        const parent = path.join(layout.history, item.itemId), info = await fs.lstat(parent);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid recovery directory");
        const history = await recoveryNames(parent, 1000); truncated ||= history.truncated;
        for (const revision of history.names) if (/^[a-f0-9]{64}\.textpack$/.test(revision)) candidates.push({ kind: "revision", key: item.itemId, hash: revision.slice(0, -9) });
        if (candidates.length >= 1000) { truncated = true; break; }
      } catch { truncated = true; }
      if (metadataBudget <= 0) { truncated = true; break; }
    }
  } else {
    const inventory = await recoveryNames(layout.receipts, 5000); truncated ||= inventory.truncated;
    for (const name of inventory.names) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json$/.test(name)) continue;
      try {
        const receipt = await readMetadata(path.join(layout.receipts, name)), result = receipt.result;
        const key = name.slice(0, -5);
        if (result?.status === "deleted" && /^[a-f0-9]{64}$/.test(result.revision)) candidates.push({ kind: "deleted", key, hash: result.revision });
        if (result?.status === "conflict" && result.conflictPath === `.texttext/conflicts/${key}.textpack`) candidates.push({ kind: "conflict", key, hash: "0".repeat(64) });
      } catch { truncated = true; }
      if (metadataBudget <= 0) { truncated = true; break; }
    }
    // Files removed outside TextText have tombstones and retained history, but no delete receipt.
    const tombstones = await recoveryNames(layout.items, 5000); truncated ||= tombstones.truncated;
    for (const name of tombstones.names) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json$/.test(name)) continue;
      try {
        const item = await readMetadata(path.join(layout.items, name));
        if (item.deleted === true && /^[a-f0-9]{64}$/.test(item.revision)) {
          segment(item.itemId); packPath(item.relativePath);
          candidates.push({ kind: "deleted", key: item.itemId, hash: item.revision, source: "history" });
        }
      } catch { truncated = true; }
      if (metadataBudget <= 0) { truncated = true; break; }
    }
  }
  const seenDeleted = new Set<string>();
  for (const candidate of candidates) {
    if (entries.length >= 200 || inspectedBytes >= 128 * 1024 * 1024) { truncated = true; break; }
    try {
      const retained = await retainedLocation(layout, candidate, readMetadata), { bytes, savedAt } = await retainedBytes(retained.file, Math.min(32 * 1024 * 1024, 128 * 1024 * 1024 - inspectedBytes));
      inspectedBytes += bytes.length;
      const revision = hash(bytes);
      if (candidate.kind !== "conflict" && revision !== candidate.hash) { truncated = true; continue; }
      validatePack(bytes);
      const token = { ...candidate, hash: revision };
      if (token.kind === "deleted") {
        const identity = `${retained.relativePath}:${revision}`;
        if (seenDeleted.has(identity)) continue;
        seenDeleted.add(identity);
      }
      entries.push({ id: recoveryId(token), path: retained.relativePath, kind: token.kind, savedAt, hash: revision });
    } catch { truncated = true; /* A corrupt or unavailable retained copy is not a valid recovery choice. */ }
  }
  entries.sort((left, right) => right.savedAt.localeCompare(left.savedAt) || left.id.localeCompare(right.id));
  return { entries, truncated };
}
export async function readVaultRecovery(input: VaultLocation & { id: string }) {
  const token = recoveryToken(input.id), layout = await setup(input);
  const retained = await retainedLocation(layout, token), { bytes } = await retainedBytes(retained.file);
  if (hash(bytes) !== token.hash) throw new Error("Recovery TextPack changed or is corrupt");
  validatePack(bytes);
  return { bytes, relativePath: retained.relativePath, revision: token.hash };
}

export async function readVaultTextpack(input: VaultLocation & { itemId: string }): Promise<{
  itemId: string; relativePath: string; revision: string; bytes: Uint8Array;
} | null> {
  segment(input.itemId);
  const layout = await setup(input);
  const stable = await stableIndexedItem(layout, input.itemId, true);
  if (stable.status === "missing") return null;
  if (stable.status === "present" && stable.bytes &&
      stable.item.fingerprint === stable.targetFingerprint &&
      stable.item.revision && /^[a-f0-9]{64}$/.test(stable.item.revision) &&
      hash(stable.bytes) === stable.item.revision) {
    return { itemId: input.itemId, relativePath: stable.item.relativePath,
      revision: stable.item.revision, bytes: stable.bytes };
  }
  return locked(layout, async () => {
    await recover(layout);
    const raw = await maybeRead(path.join(layout.items, `${input.itemId}.json`));
    if (!raw) return null;
    const item = JSON.parse(raw.toString()) as { relativePath: string; deleted?: boolean };
    if (item.deleted) return null;
    const bytes = await maybeRead(await targetPath(layout, item.relativePath));
    await observeCollaborationRevision(layout, input.itemId, bytes ? hash(bytes) : null, true);
    return bytes ? { itemId: input.itemId, relativePath: item.relativePath, revision: hash(bytes), bytes } : null;
  });
}

/** Resolve an existing item's current path without loading its TextPack. Read
 * routes must still load the live pack and reauthorize this path afterward. */
export async function readVaultTextpackPath(input: VaultLocation & { itemId: string }): Promise<string | null> {
  segment(input.itemId);
  const layout = await setup(input);
  const stable = await stableIndexedItem(layout, input.itemId);
  if (stable.status === "missing") return null;
  if (stable.status === "present") return stable.item.relativePath;
  return locked(layout, async () => {
    await recover(layout);
    const raw = await maybeRead(path.join(layout.items, `${input.itemId}.json`));
    if (!raw) return null;
    const item = JSON.parse(raw.toString()) as { relativePath: string; deleted?: boolean };
    if (item.deleted) return null;
    if (await fingerprint(await targetPath(layout, item.relativePath))) return item.relativePath;
    await observeCollaborationRevision(layout, input.itemId, null);
    return null;
  });
}

/** Resolve an item's live path and content revision without reopening a known
 * unchanged TextPack. The stat fingerprint is an index hint only: whenever it
 * differs, the complete pack is read, validated, hashed, and indexed again. */
export async function readVaultTextpackIdentity(input: VaultLocation & { itemId: string }): Promise<{
  itemId: string; relativePath: string; revision: string;
} | null> {
  segment(input.itemId);
  const layout = await setup(input);
  const stable = await stableIndexedItem(layout, input.itemId);
  if (stable.status === "missing") return null;
  if (stable.status === "present" && stable.item.fingerprint === stable.targetFingerprint &&
      stable.item.revision && /^[a-f0-9]{64}$/.test(stable.item.revision)) {
    return { itemId: input.itemId, relativePath: stable.item.relativePath, revision: stable.item.revision };
  }
  return locked(layout, async () => {
    await recover(layout);
    const metadataPath = path.join(layout.items, `${input.itemId}.json`);
    const raw = await maybeRead(metadataPath);
    if (!raw) return null;
    const item = JSON.parse(raw.toString()) as {
      itemId?: string; relativePath: string; revision?: string; fingerprint?: string; deleted?: boolean;
    };
    if (item.deleted) return null;
    const target = await targetPath(layout, item.relativePath);
    const signature = await fingerprint(target);
    if (!signature) {
      await observeCollaborationRevision(layout, input.itemId, null);
      return null;
    }
    if (item.fingerprint === signature && item.revision && /^[a-f0-9]{64}$/.test(item.revision)) {
      return { itemId: input.itemId, relativePath: item.relativePath, revision: item.revision };
    }
    const bytes = await maybeRead(target);
    if (!bytes) return null;
    validatePack(bytes, input.itemId);
    const revision = hash(bytes);
    await observeCollaborationRevision(layout, input.itemId, revision, true);
    const history = await directory(layout.history, input.itemId);
    await atomicWrite(path.join(history, `${revision}.textpack`), bytes);
    await atomicWrite(metadataPath, json({ ...item, itemId: input.itemId, revision, fingerprint: signature }));
    return { itemId: input.itemId, relativePath: item.relativePath, revision };
  });
}

/** Metadata-only discovery; bound work and fail explicitly rather than hide a late definition. */
export async function listVaultFolderViews(input: VaultLocation & { folder: string }) {
  if (input.folder && (input.folder.startsWith("/") || input.folder.includes("\\") || input.folder.split("/").some((part) => !part || part.startsWith(".")))) throw new Error("Invalid folder path");
  const manifest = await listVaultTextpacks(input);
  const members = manifest.items.filter((item) => path.posix.dirname(item.relativePath).replace(/^\.$/, "") === input.folder);
  if (members.length > 2048) throw new Error("Folder view discovery exceeds limits");
  const files: { path: string; hash: string; documentJSON: string; templateJSON?: string }[] = [];
  let scanned = 0, returnedBytes = 0;
  for (const member of members) {
    const item = await readVaultTextpack({ ...input, itemId: member.itemId });
    if (!item || path.posix.dirname(item.relativePath).replace(/^\.$/, "") !== input.folder) continue;
    if ((scanned += item.bytes.length) > 256 * 1024 * 1024) throw new Error("Folder view discovery exceeds limits");
    let expanded = 0;
    const entries = unzipSync(item.bytes, { filter(entry) {
      if (!/(?:^|\/)(document|template)\.json$/.test(entry.name)) return false;
      if ((expanded += entry.originalSize) > 4 * 1024 * 1024) throw new Error("Folder view metadata exceeds limits");
      return true;
    } });
    const documents = Object.keys(entries).filter((key) => /(?:^|\/)document\.json$/.test(key));
    if (documents.length !== 1) continue;
    const key = documents[0], documentJSON = strFromU8(entries[key]);
    let document;
    try { document = JSON.parse(documentJSON); } catch { continue; }
    if (document?.content?.fields?.texttextFolderView === undefined) continue;
    const template = entries[key.replace(/document\.json$/, "template.json")];
    returnedBytes += Buffer.byteLength(documentJSON) + (template?.length ?? 0);
    if (returnedBytes > 4 * 1024 * 1024) throw new Error("Folder view response exceeds limits");
    files.push({ path: item.relativePath, hash: item.revision, documentJSON, ...(template ? { templateJSON: strFromU8(template) } : {}) });
    if (files.length > 16) throw new Error("Too many folder view definitions");
  }
  return { files };
}

/** Scan only explicit feed snapshots. Ordinary Bookmarks and subscription
 * TextPacks never become reading records merely because they were loaded. */
async function listVaultFeedEntries(input: VaultLocation & { items: readonly { itemId: string; relativePath: string }[] }, kind: "kept" | "read") {
  const prefix = kind === "kept" ? "Bookmarks/" : "Feeds/History/";
  const marker = kind === "kept" ? "texttextFeedEntry" : "texttextFeedHistoryEntry";
  const dateField = kind === "kept" ? "keptAt" : "readAt";
  const candidates = input.items.filter(item => item.relativePath.startsWith(prefix) && item.relativePath.endsWith(".textpack"));
  if (candidates.length > 2048) throw new Error("Feed record discovery exceeds limits");
  const entries: { itemId: string; hash: string; path: string; revision: string; title: string; source: string; topic?: string; recordedAt: string; readAt?: string; bookmarkReadAt?: string; progress?: number }[] = [];
  let scanned = 0, expanded = 0;
  for (const candidate of candidates) {
    const pack = await readVaultTextpack({ ...input, itemId: candidate.itemId });
    if (!pack || pack.relativePath !== candidate.relativePath) continue;
    if ((scanned += pack.bytes.length) > 256 * 1024 * 1024) throw new Error("Feed record discovery exceeds limits");
    const files = unzipSync(pack.bytes, { filter(entry) {
      if (!/(?:^|\/)document\.json$/.test(entry.name)) return false;
      if (entry.originalSize > 4 * 1024 * 1024 || (expanded += entry.originalSize) > 64 * 1024 * 1024) throw new Error("Feed record metadata exceeds limits");
      return true;
    } });
    const documents = Object.keys(files).filter(name => /(?:^|\/)document\.json$/.test(name));
    if (documents.length !== 1) continue;
    let document: { content?: { title?: unknown; fields?: Record<string, unknown> } };
    try { document = JSON.parse(strFromU8(files[documents[0]])); } catch { continue; }
    const fields = document.content?.fields;
    if (fields?.[marker] !== "v1" || typeof fields.feedEntryHash !== "string" || !/^[0-9a-f]{64}$/.test(fields.feedEntryHash)) continue;
    const recordedAt = kind === "read" && typeof fields.viewedAt === "string" ? fields.viewedAt : fields[dateField];
    if (typeof recordedAt !== "string" || !Number.isFinite(Date.parse(recordedAt))) continue;
    const entry = {
      itemId: candidate.itemId, hash: fields.feedEntryHash, path: candidate.relativePath, revision: pack.revision,
      title: String(document.content?.title ?? "Saved story").slice(0, 300),
      source: String(fields.feedTitle ?? "").slice(0, 160),
      ...(typeof fields.feedTopic === "string" && fields.feedTopic.trim() ? { topic: fields.feedTopic.trim().slice(0, 100) } : {}),
      recordedAt: recordedAt.slice(0, 32),
      ...(kind === "read" && typeof fields.readAt === "string" && Number.isFinite(Date.parse(fields.readAt)) ? { readAt: fields.readAt.slice(0, 32) } : {}),
      ...(kind === "kept" && typeof fields.texttextBookmarkReadAt === "string" && fields.texttextBookmarkReadAt ? { bookmarkReadAt: fields.texttextBookmarkReadAt.slice(0, 32) } : {}),
      ...(typeof fields.texttextFeedReadingProgress === "number" && Number.isInteger(fields.texttextFeedReadingProgress) && fields.texttextFeedReadingProgress >= 0 && fields.texttextFeedReadingProgress <= 100 ? { progress: fields.texttextFeedReadingProgress } : {}),
    };
    entries.push(entry);
  }
  const byHash = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) {
    const previous = byHash.get(entry.hash);
    if (!previous || entry.recordedAt > previous.recordedAt) byHash.set(entry.hash, entry);
  }
  return [...byHash.values()].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.path.localeCompare(b.path));
}

/** One bounded metadata request serves the web's Read Later list. */
export async function listVaultKeptFeedEntries(input: VaultLocation & { items: readonly { itemId: string; relativePath: string }[] }) {
  return (await listVaultFeedEntries(input, "kept")).map(({ itemId, hash, path, title, source, topic, recordedAt, bookmarkReadAt, progress }) => ({
    itemId, hash, path, title, source, ...(topic ? { topic } : {}), keptAt: recordedAt, ...(bookmarkReadAt ? { readAt: bookmarkReadAt } : {}), ...(progress !== undefined ? { progress } : {}),
  }));
}

/** Unsaved stories live in Feeds/History and remain regular article TextPacks. */
export async function listVaultReadFeedEntries(input: VaultLocation & { items: readonly { itemId: string; relativePath: string }[] }) {
  return (await listVaultFeedEntries(input, "read")).map(({ itemId, hash, path, revision, title, source, topic, recordedAt, readAt, progress }) => ({
    itemId, hash, path, revision, title, source, ...(topic ? { topic } : {}), viewedAt: recordedAt, ...(readAt ? { readAt } : {}), ...(progress !== undefined ? { progress } : {}),
  }));
}

export async function readVaultTemplate(input: VaultLocation & { itemId: string }): Promise<{
  path: string; hash: string; templateJSON?: string; templateAuthoringSourceJSON?: string;
} | null> {
  const item = await readVaultTextpack(input);
  if (!item) return null;
  const entries: string[] = [];
  let size = 0;
  const files = unzipSync(item.bytes, { filter(entry) {
    const selected = /(?:^|\/)template(?:-source)?\.json$/.test(entry.name);
    if (selected) {
      if ((size += entry.originalSize) > 8 * 1024 * 1024) throw new Error("TextPack template metadata exceeds limits");
      entries.push(entry.name);
    }
    return selected;
  } });
  const templates = entries.filter((name) => /(?:^|\/)template\.json$/.test(name));
  if (templates.length > 1) throw new Error("TextPack contains ambiguous templates");
  const result: { path: string; hash: string; templateJSON?: string; templateAuthoringSourceJSON?: string } = { path: item.relativePath, hash: item.revision };
  if (!templates.length) return result;
  const template = validateTemplateDefinition(JSON.parse(strFromU8(files[templates[0]])));
  result.templateJSON = JSON.stringify(template);
  const sourcePath = templates[0].replace(/template\.json$/, "template-source.json");
  if (files[sourcePath]) {
    const source = validatedLookSource(template, JSON.parse(strFromU8(files[sourcePath])));
    if (source) result.templateAuthoringSourceJSON = JSON.stringify(source);
  }
  return result;
}

/** Provision ordinary empty directories without replacing existing content. */
export async function ensureVaultFolders(input: VaultLocation, folders: readonly string[]): Promise<void> {
  if (folders.length > 1000) throw new Error("Too many workspace folders");
  for (const folder of folders) packPath(`${folder}/placeholder.textpack`);
  const layout = await setup(input);
  await locked(layout, async () => {
    await recover(layout);
    for (const folder of folders) {
      let parent = layout.workspace;
      for (const part of folder.split("/")) {
        const child = await directory(parent, part);
        await syncDirectory(parent);
        parent = child;
      }
    }
  });
}

export async function listVaultTextpacks(input: VaultLocation): Promise<{
  folders: string[];
  items: { itemId: string; relativePath: string; revision: string; lifecycle?: string; restoreFromRevision?: string }[];
  tombstones: { itemId: string; relativePath: string; revision: string; deleted: true; lifecycle?: string; restoreFromRevision?: string }[];
  revision: string;
  problems: { relativePath: string; reason: string }[];
}> {
  const layout = await setup(input);
  return locked(layout, async () => {
    await recover(layout);
    const folders: string[] = [];
    const problems = await discoverFiles(layout, folders);
    folders.sort();
    const items: { itemId: string; relativePath: string; revision: string; lifecycle?: string; restoreFromRevision?: string }[] = [];
    const tombstones: { itemId: string; relativePath: string; revision: string; deleted: true; lifecycle?: string; restoreFromRevision?: string }[] = [];
    for (const name of (await fs.readdir(layout.items)).sort()) {
      const raw = await maybeRead(path.join(layout.items, name));
      if (!raw) continue;
      const item = JSON.parse(raw.toString()) as { itemId: string; relativePath: string; revision?: string; fingerprint?: string; deleted?: boolean };
      segment(item.itemId);
      const lifecycleRaw = await maybeRead(path.join(layout.control, "lifecycles", `${item.itemId}.json`));
      let generation: { lifecycle?: string; restoreFromRevision?: string } = {};
      if (lifecycleRaw) {
        const saved = JSON.parse(lifecycleRaw.toString());
        segment(saved.lifecycle);
        if (!/^[a-f0-9]{64}$/.test(saved.restoreFromRevision)) throw new Error("Invalid restore lifecycle");
        generation = { lifecycle: saved.lifecycle, restoreFromRevision: saved.restoreFromRevision };
      }
      if (item.deleted && item.revision) {
        tombstones.push({ itemId: item.itemId, relativePath: item.relativePath, revision: item.revision, deleted: true, ...generation });
        continue;
      }
      const target = await targetPath(layout, item.relativePath);
      const signature = await fingerprint(target);
      if (!signature) {
        await observeCollaborationRevision(layout, item.itemId, null);
        if (item.revision) {
          const tombstone = { itemId: item.itemId, relativePath: item.relativePath, revision: item.revision, deleted: true as const, ...generation };
          await atomicWrite(path.join(layout.items, name), json(tombstone));
          tombstones.push(tombstone);
        }
        continue;
      }
      let revision = item.revision;
      if (!revision || signature !== item.fingerprint) {
        const bytes = await maybeRead(target);
        if (!bytes) continue;
        validatePack(bytes, item.itemId);
        revision = hash(bytes);
        await observeCollaborationRevision(layout, item.itemId, revision, true);
        const history = await directory(layout.history, item.itemId);
        await atomicWrite(path.join(history, `${revision}.textpack`), bytes);
        // Derived index only. Idle change waits need stat calls, never repeated
        // reads and hashes of every asset in the workspace.
        await atomicWrite(path.join(layout.items, name), json({ ...item, revision, fingerprint: signature }));
      }
      items.push({ itemId: item.itemId, relativePath: item.relativePath, revision, ...generation });
    }
    return { items, tombstones, folders, problems, revision: hash(json([items, tombstones, folders, problems])) };
  });
}

async function discoverFiles(layout: Layout, folders: string[]): Promise<{ relativePath: string; reason: string }[]> {
  type Item = { itemId: string; relativePath: string; revision?: string; deleted?: boolean };
  const byId = new Map<string, Item>();
  const paths = new Set<string>();
  for (const name of await fs.readdir(layout.items)) {
    const bytes = await maybeRead(path.join(layout.items, name));
    if (!bytes) continue;
    const item = JSON.parse(bytes.toString()) as Item;
    byId.set(item.itemId, item);
    if (!item.deleted) paths.add(item.relativePath);
  }
  const problems: { relativePath: string; reason: string }[] = [];
  let visited = 0;
  async function walk(relativeDirectory: string): Promise<void> {
    for (const entry of await fs.readdir(path.join(layout.workspace, relativeDirectory), { withFileTypes: true })) {
      if (++visited > 100_000) throw new Error("Vault directory exceeds discovery limits");
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // Use the same path validation as file writes; never expose internal,
        // symlinked or unaddressable directories as sidebar destinations.
        try { packPath(`${relativePath}/placeholder.textpack`); } catch { continue; }
        folders.push(relativePath);
        await walk(relativePath); continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".textpack") || paths.has(relativePath)) continue;
      let bytes: Buffer | null;
      let itemId: string;
      try {
        packPath(relativePath);
        bytes = await maybeRead(await targetPath(layout, relativePath));
        if (!bytes) continue;
        itemId = validatePack(bytes);
      } catch {
        problems.push({ relativePath, reason: "Invalid TextPack or missing identity" });
        continue;
      }
      const previous = byId.get(itemId);
      if (previous?.deleted) {
        problems.push({ relativePath, reason: "This file conflicts with a deleted item" });
        continue;
      }
      if (previous && await fingerprint(await targetPath(layout, previous.relativePath))) {
        problems.push({ relativePath, reason: "Another file has the same item identity" });
        continue;
      }
      // A new file, or an externally renamed file whose old path is absent.
      // This is a disposable index; the newly observed pack remains untouched.
      const revision = hash(bytes);
      await observeCollaborationRevision(layout, itemId, revision);
      const item = { itemId, relativePath, revision };
      const history = await directory(layout.history, itemId);
      await atomicWrite(path.join(history, `${revision}.textpack`), bytes);
      await atomicWrite(path.join(layout.items, `${itemId}.json`), json(item));
      byId.set(itemId, item);
      paths.add(relativePath);
    }
  }
  await walk("");
  return problems.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/** Request-scoped change wait. No permanent watcher and no file polling. */
export async function waitVaultTextpacks(input: VaultLocation & {
  revision: string; waitMs: number; signal?: AbortSignal;
}): Promise<Awaited<ReturnType<typeof listVaultTextpacks>>> {
  const layout = await setup(input);
  let wake!: () => void;
  const changed = new Promise<void>((resolve) => { wake = resolve; });
  const watcher = watch(layout.workspace, { recursive: true }, (_event, filename) => {
    const name = filename?.toString().replace(/\\/g, "/");
    if (!name || !name.startsWith(".texttext/") || name.startsWith(".texttext/receipts/")) wake();
  });
  watcher.once("error", wake);
  const timer = setTimeout(wake, Math.max(0, Math.min(input.waitMs, 25_000)));
  input.signal?.addEventListener("abort", wake, { once: true });
  try {
    // Register before reading so a commit between initial read and wait cannot
    // get lost. Ignore our own lock files in the notification filter above.
    const initial = await listVaultTextpacks(input);
    if (input.signal?.aborted || initial.revision !== input.revision) return initial;
    await changed;
    return input.signal?.aborted ? initial : await listVaultTextpacks(input);
  } finally {
    clearTimeout(timer);
    watcher.close();
    input.signal?.removeEventListener("abort", wake);
  }
}

/** A bounded request-scoped wait. Watch before reading so checkpoint publication
 * cannot fall between the initial read and subscription. No permanent poller. */
export async function waitVaultCollaboration(input: VaultLocation & {
  itemId: string; epoch: number; seq: number; waitMs: number; signal?: AbortSignal;
}) {
  segment(input.itemId);
  const layout = await setup(input);
  let wake!: () => void;
  const changed = new Promise<void>(resolve => { wake = resolve; });
  let checking = false;
  const checkForChange = async () => {
    if (checking) return;
    checking = true;
    try {
      const current = await readVaultCollaboration(input);
      if (!current || current.epoch !== input.epoch || current.seq !== input.seq) wake();
    } catch {
      wake();
    } finally {
      checking = false;
    }
  };
  // Watcher events can describe an early lock/temp-file change (and macOS may
  // report only a basename). Re-read the collaboration cursor before waking so
  // clients never receive the old checkpoint while a writer is still committing.
  const watcher = watch(layout.workspace, { recursive: true }, () => { void checkForChange(); });
  watcher.once("error", () => { void checkForChange(); });
  const timer = setTimeout(wake, Math.max(0, Math.min(input.waitMs, 25_000)));
  input.signal?.addEventListener("abort", wake, { once: true });
  let interval: ReturnType<typeof setInterval> | undefined;
  try {
    const initial = await readVaultCollaboration(input);
    if (!initial || initial.epoch !== input.epoch || initial.seq !== input.seq || input.signal?.aborted) return initial;
    // Some filesystem providers coalesce or omit a watch event. This scoped
    // fallback checks only while one bounded long-poll request is waiting.
    interval = setInterval(() => { void checkForChange(); }, 250);
    await changed;
    return input.signal?.aborted ? initial : await readVaultCollaboration(input);
  } finally {
    clearTimeout(timer);
    if (interval) clearInterval(interval);
    watcher.close();
    input.signal?.removeEventListener("abort", wake);
  }
}
