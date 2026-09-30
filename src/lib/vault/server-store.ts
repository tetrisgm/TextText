import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { hostname } from "node:os";
import { unzipSync, strFromU8 } from "fflate";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { reconcileTextpacks } from "./pack-reconcile";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { validatedLookSource } from "@/lib/presentation/template-library";

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
  itemId: string;
  operationId: string;
  relativePath: string;
  baseRevision: string | null;
  bytes: Uint8Array;
  audit?: { actorUserId: string; actorType: "human" | "external_agent" };
}
export type VaultWriteResult =
  | { status: "written"; itemId: string; relativePath: string; revision: string }
  | { status: "conflict"; itemId: string; relativePath: string; revision: string | null; conflictPath: string; deleted?: true };
export type VaultEntryResult =
  | { status: "moved" | "deleted"; itemId: string; relativePath: string; revision: string }
  | { status: "conflict"; itemId: string; relativePath: string; revision: string | null; deleted?: true };
export interface VaultEntryMutation extends VaultLocation {
  itemId: string; operationId: string; basePath: string; baseRevision: string;
  audit?: VaultWrite["audit"];
}
interface EntryIntent {
  kind: "move" | "delete"; workspaceId: string; itemId: string; operationId: string;
  basePath: string; baseRevision: string; relativePath: string; requestHash: string;
  audit?: VaultWrite["audit"];
}

interface Intent {
  itemId: string; operationId: string; relativePath: string;
  baseRevision: string | null; revision: string; requestHash: string;
  workspaceId: string;
  audit?: VaultWrite["audit"];
  deletedRevision?: string;
}
export interface VaultMutationReceipt {
  workspaceId: string; operationId: string;
  actorUserId: string; actorType: "human" | "external_agent";
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
  return { workspace, control, pending, receipts, items, conflicts, locks, history, removed, onReceipt: location.onReceipt };
}
type Layout = Awaited<ReturnType<typeof setup>>;

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
  if (intent.deletedRevision || (revision !== intent.baseRevision && revision !== intent.revision)) {
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
    result = { status: "written", itemId: intent.itemId, relativePath: intent.relativePath, revision: intent.revision };
  }
  const receipt: Receipt = { requestHash: intent.requestHash, result, ...(intent.audit ? {
    mutation: { workspaceId: intent.workspaceId, operationId: intent.operationId, ...intent.audit, result },
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
    const saved = await maybeRead(path.join(layout.receipts, `${input.operationId}.json`));
    if (saved) {
      const receipt = JSON.parse(saved.toString()) as Receipt<VaultEntryResult>;
      if (receipt.requestHash !== requestHash) throw new Error("Operation id was reused");
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

async function recover(layout: Layout): Promise<void> {
  for (const name of await fs.readdir(layout.pending)) {
    segment(name);
    const pendingDir = path.join(layout.pending, name);
    const info = await fs.lstat(pendingDir);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid pending operation");
    const saved = await maybeRead(path.join(pendingDir, "intent.json"));
    // A payload without a committed intent never changed a visible document.
    if (!saved) { await fs.rm(pendingDir, { recursive: true }); continue; }
    const intent = JSON.parse(saved.toString()) as Intent | EntryIntent;
    if ("kind" in intent) await applyEntry(layout, intent, pendingDir);
    else await apply(layout, intent, pendingDir);
  }
}

export async function writeVaultTextpack(input: VaultWrite): Promise<VaultWriteResult> {
  if (input.audit && !input.onReceipt) throw new Error("Vault mutation requires its audit sink");
  segment(input.itemId); segment(input.operationId); packPath(input.relativePath);
  if (input.baseRevision !== null && !/^[a-f0-9]{64}$/.test(input.baseRevision)) throw new Error("Invalid base revision");
  validatePack(input.bytes, input.itemId);
  const revision = hash(input.bytes);
  const requestHash = hash(json([input.itemId, input.relativePath, input.baseRevision, revision, ...(input.audit ? [input.audit] : [])]));
  const layout = await setup(input);
  return locked(layout, async () => {
    await recover(layout);
    const receipt = await maybeRead(path.join(layout.receipts, `${input.operationId}.json`));
    if (receipt) {
      const saved = JSON.parse(receipt.toString()) as Receipt<VaultWriteResult>;
      if (saved.requestHash !== requestHash) throw new Error("Operation id was reused with different content");
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
    // Compare against the exact last shared archive, including assets. Resolve
    // the merge before committing the intent so restart replay is deterministic.
    let committedBytes = input.bytes;
    let committedBase = input.baseRevision;
    if (input.baseRevision !== null && !deletedRevision) {
      const target = await targetPath(layout, input.relativePath);
      const current = await maybeRead(target);
      if (current && hash(current) !== input.baseRevision && hash(current) !== revision) {
        const history = await directory(layout.history, input.itemId);
        const base = await maybeRead(path.join(history, `${input.baseRevision}.textpack`));
        if (base && hash(base) === input.baseRevision) {
          const merged = reconcileTextpacks(base, input.bytes, current);
          if (merged.status === "merged") {
            committedBytes = merged.bytes;
            committedBase = hash(current);
          }
        }
      }
    }
    const pendingDir = await directory(layout.pending, input.operationId);
    await atomicWrite(path.join(pendingDir, "payload.textpack"), committedBytes);
    const intent: Intent = { itemId: input.itemId, operationId: input.operationId,
      relativePath: input.relativePath, baseRevision: committedBase, revision: hash(committedBytes), requestHash,
      workspaceId: input.workspaceId, ...(input.audit ? { audit: input.audit } : {}) };
    if (deletedRevision) intent.deletedRevision = deletedRevision;
    await atomicWrite(path.join(pendingDir, "intent.json"), json(intent));
    await syncDirectory(layout.pending);
    return apply(layout, intent, pendingDir);
  });
}

export async function readVaultTextpack(input: VaultLocation & { itemId: string }): Promise<{
  itemId: string; relativePath: string; revision: string; bytes: Uint8Array;
} | null> {
  segment(input.itemId);
  const layout = await setup(input);
  return locked(layout, async () => {
    await recover(layout);
    const raw = await maybeRead(path.join(layout.items, `${input.itemId}.json`));
    if (!raw) return null;
    const item = JSON.parse(raw.toString()) as { relativePath: string; deleted?: boolean };
    if (item.deleted) return null;
    const bytes = await maybeRead(await targetPath(layout, item.relativePath));
    return bytes ? { itemId: input.itemId, relativePath: item.relativePath, revision: hash(bytes), bytes } : null;
  });
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

export async function listVaultTextpacks(input: VaultLocation): Promise<{
  items: { itemId: string; relativePath: string; revision: string }[];
  tombstones: { itemId: string; relativePath: string; revision: string; deleted: true }[];
  revision: string;
  problems: { relativePath: string; reason: string }[];
}> {
  const layout = await setup(input);
  return locked(layout, async () => {
    await recover(layout);
    const problems = await discoverFiles(layout);
    const items: { itemId: string; relativePath: string; revision: string }[] = [];
    const tombstones: { itemId: string; relativePath: string; revision: string; deleted: true }[] = [];
    for (const name of (await fs.readdir(layout.items)).sort()) {
      const raw = await maybeRead(path.join(layout.items, name));
      if (!raw) continue;
      const item = JSON.parse(raw.toString()) as { itemId: string; relativePath: string; revision?: string; fingerprint?: string; deleted?: boolean };
      segment(item.itemId);
      if (item.deleted && item.revision) {
        tombstones.push({ itemId: item.itemId, relativePath: item.relativePath, revision: item.revision, deleted: true });
        continue;
      }
      const target = await targetPath(layout, item.relativePath);
      const signature = await fingerprint(target);
      if (!signature) {
        if (item.revision) {
          const tombstone = { itemId: item.itemId, relativePath: item.relativePath, revision: item.revision, deleted: true as const };
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
        const history = await directory(layout.history, item.itemId);
        await atomicWrite(path.join(history, `${revision}.textpack`), bytes);
        // Derived index only. Idle change waits need stat calls, never repeated
        // reads and hashes of every asset in the workspace.
        await atomicWrite(path.join(layout.items, name), json({ ...item, revision, fingerprint: signature }));
      }
      items.push({ itemId: item.itemId, relativePath: item.relativePath, revision });
    }
    return { items, tombstones, problems, revision: hash(json([items, tombstones, problems])) };
  });
}

async function discoverFiles(layout: Layout): Promise<{ relativePath: string; reason: string }[]> {
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
      if (entry.isDirectory()) { await walk(relativePath); continue; }
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
