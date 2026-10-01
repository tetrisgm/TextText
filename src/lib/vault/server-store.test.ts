import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { unzipSync, zipSync } from "fflate";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { readVaultTextpack, writeVaultTextpack, listVaultTextpacks, waitVaultTextpacks, moveVaultTextpack, deleteVaultTextpack } from "./server-store";
import { listVaultFolderViews, listVaultRecovery, readVaultRecovery } from "./server-store";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function pack(body: string, itemId = "item-1") {
  const document = emptyDocumentSnapshot();
  document.content.body = body;
  const files = unzipSync(buildTextpack("Note", { document, markdown: `---\ntextTextId: ${JSON.stringify(itemId)}\n---\n\n${body}` }));
  files["Note.textbundle/assets/picture.bin"] = new Uint8Array([0, 255, 10, 20]);
  return zipSync(files, { mtime: new Date(1980, 0, 1) });
}

describe("directory TextPack store", () => {
  let root: string;
  const workspaceId = "workspace-1";
  const itemId = "item-1";
  const relativePath = "Notes/My note.textpack";
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-vault-")); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const input = (root: string, operationId: string, bytes: Uint8Array, baseRevision: string | null = null) => ({
    root, workspaceId, itemId, relativePath, operationId, bytes, baseRevision,
  });

  it.each(["write", "move", "delete"])("checks final permission before committing a %s", async (kind) => {
    const bytes = pack("original");
    await writeVaultTextpack(input(root, "initial", bytes));
    const fence = { beforeCommit: async () => { throw new Error("Permission revoked"); } };
    const base = { root, workspaceId, itemId, operationId: "denied", basePath: relativePath, baseRevision: hash(bytes), ...fence };
    const mutation = kind === "write" ? writeVaultTextpack({ ...input(root, "denied", pack("forbidden"), hash(bytes)), ...fence })
      : kind === "move" ? moveVaultTextpack({ ...base, relativePath: "Forbidden.textpack" }) : deleteVaultTextpack(base);
    await expect(mutation).rejects.toThrow("Permission revoked");
    expect((await readVaultTextpack({ root, workspaceId, itemId }))?.bytes).toEqual(Buffer.from(bytes));
    expect(await fs.readdir(path.join(root, workspaceId, ".texttext/pending"))).toEqual([]);
  });

  it("exposes external-deletion tombstones as deleted recovery with the last retained actual bytes", async () => {
    await writeVaultTextpack(input(root, "initial", pack("initial")));
    const actual = pack("Edited directly on disk");
    await fs.writeFile(path.join(root, workspaceId, relativePath), actual);
    await listVaultTextpacks({ root, workspaceId });
    await fs.unlink(path.join(root, workspaceId, relativePath));
    const manifest = await listVaultTextpacks({ root, workspaceId });
    expect(manifest.tombstones).toHaveLength(1);
    const recovery = await listVaultRecovery({ root, workspaceId });
    expect(recovery.truncated).toBe(false);
    expect(recovery.entries).toHaveLength(1);
    expect(recovery.entries[0]).toMatchObject({ kind: "deleted", path: relativePath, hash: hash(actual) });
    const retained = await readVaultRecovery({ root, workspaceId, id: recovery.entries[0].id });
    expect(retained.bytes).toEqual(Buffer.from(actual));
    expect(await readVaultTextpack({ root, workspaceId, itemId })).toBeNull();
  });

  it("lists retained revisions, deleted copies and conflicts and reads originals without modifying them", async () => {
    const original = pack("first");
    await writeVaultTextpack(input(root, "first", original));
    const later = pack("second");
    await writeVaultTextpack(input(root, "second", later, hash(original)));
    await writeVaultTextpack(input(root, "conflicted", pack("offline"), hash(original)));
    const revisions = await listVaultRecovery({ root, workspaceId, path: relativePath });
    expect(revisions.truncated).toBe(false);
    expect(revisions.entries.map((entry) => entry.hash).sort()).toEqual([hash(original), hash(later)].sort());
    await deleteVaultTextpack({ root, workspaceId, itemId, basePath: relativePath, baseRevision: hash(later), operationId: "deleted" });
    const recovery = await listVaultRecovery({ root, workspaceId });
    expect(recovery.truncated).toBe(false);
    expect(recovery.entries.map((entry) => entry.kind).sort()).toEqual(["conflict", "deleted"]);
    const deleted = recovery.entries.find((entry) => entry.kind === "deleted")!;
    expect((await readVaultRecovery({ root, workspaceId, id: deleted.id })).bytes).toEqual(Buffer.from(later));
    expect(await readVaultTextpack({ root, workspaceId, itemId })).toBeNull();
    expect(await listVaultRecovery({ root, workspaceId })).toEqual(recovery);
    await expect(readVaultRecovery({ root, workspaceId, id: "../private" })).rejects.toThrow();
    const removed = path.join(root, workspaceId, ".texttext", "removed", "deleted.textpack");
    await fs.writeFile(removed, original);
    await expect(readVaultRecovery({ root, workspaceId, id: deleted.id })).rejects.toThrow("changed or is corrupt");
    await fs.unlink(removed);
    const outside = path.join(root, "outside.textpack");
    await fs.writeFile(outside, later);
    await fs.symlink(outside, removed);
    await expect(readVaultRecovery({ root, workspaceId, id: deleted.id })).rejects.toThrow();
    expect((await listVaultRecovery({ root, workspaceId })).truncated).toBe(true);
    await fs.writeFile(path.join(root, workspaceId, ".texttext", "receipts", "bad.json"), "{broken");
    const partial = await listVaultRecovery({ root, workspaceId });
    expect(partial.truncated).toBe(true);
    expect(partial.entries.some((entry) => entry.kind === "conflict")).toBe(true);
    const history = path.join(root, workspaceId, ".texttext", "history", itemId);
    const movedHistory = path.join(root, "history-outside");
    await fs.rename(history, movedHistory);
    await fs.symlink(movedHistory, history);
    await expect(readVaultRecovery({ root, workspaceId, id: revisions.entries[0].id })).rejects.toThrow("Invalid recovery directory");
    expect((await listVaultRecovery({ root, workspaceId, path: relativePath })).entries).toEqual([]);
  });

  it("discovers renamed marked folder definitions without asset transfer or nested matches", async () => {
    const document = emptyDocumentSnapshot();
    document.content.fields.texttextFolderView = "v1";
    for (const [id, location] of [["design", "Reading/Renamed.textpack"], ["nested", "Reading/Nested/Folder view.textpack"]]) {
      const bytes = buildTextpack("View", { document, markdown: `---\ntextTextId: ${id}\n---\nDefinition` });
      await writeVaultTextpack({ root, workspaceId, itemId: id, relativePath: location, operationId: id, bytes, baseRevision: null });
    }
    const result = await listVaultFolderViews({ root, workspaceId, folder: "Reading" });
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("Reading/Renamed.textpack");
    expect(Object.keys(result.files[0]).sort()).toEqual(["documentJSON", "hash", "path"]);
    expect((await listVaultFolderViews({ root, workspaceId, folder: "" })).files).toEqual([]);
    await expect(listVaultFolderViews({ root, workspaceId, folder: "../outside" })).rejects.toThrow("Invalid folder");
  });

  it("stores the complete original pack in a normal folder and reads file edits directly", async () => {
    const bytes = pack("first");
    const result = await writeVaultTextpack(input(root, "op-1", bytes));
    expect(result).toMatchObject({ status: "written", revision: hash(bytes) });
    expect(new Uint8Array(await fs.readFile(path.join(root, workspaceId, relativePath)))).toEqual(bytes);
    const external = pack("external agent edit");
    await fs.writeFile(path.join(root, workspaceId, relativePath), external);
    expect(await readVaultTextpack({ root, workspaceId, itemId })).toEqual({
      itemId, relativePath, revision: hash(external), bytes: Buffer.from(external),
    });
  });

  it("preserves both complete packs on a stale revision", async () => {
    const first = pack("first");
    await writeVaultTextpack(input(root, "op-1", first));
    const second = pack("second");
    await writeVaultTextpack(input(root, "op-2", second, hash(first)));
    const divergent = pack("offline edit");
    const result = await writeVaultTextpack(input(root, "op-3", divergent, hash(first)));
    expect(result).toMatchObject({ status: "conflict", revision: hash(second) });
    if (result.status !== "conflict") throw new Error("Expected conflict");
    expect(await fs.readFile(path.join(root, workspaceId, result.conflictPath))).toEqual(Buffer.from(divergent));
    expect((await readVaultTextpack({ root, workspaceId, itemId }))?.bytes).toEqual(Buffer.from(second));
  });

  it("retries an operation exactly once even after a later write", async () => {
    const first = pack("first");
    const request = input(root, "op-1", first);
    const result = await writeVaultTextpack(request);
    const second = pack("second");
    await writeVaultTextpack(input(root, "op-2", second, hash(first)));
    expect(await writeVaultTextpack(request)).toEqual(result);
    expect((await readVaultTextpack({ root, workspaceId, itemId }))?.revision).toBe(hash(second));
    await expect(writeVaultTextpack(input(root, "op-1", pack("different")))).rejects.toThrow("reused");
  });

  async function pending(operationId: string, bytes: Uint8Array, baseRevision: string | null) {
    const dir = path.join(root, workspaceId, ".texttext/pending", operationId);
    await fs.mkdir(dir, { recursive: true });
    const revision = hash(bytes);
    await fs.writeFile(path.join(dir, "payload.textpack"), bytes);
    await fs.writeFile(path.join(dir, "intent.json"), JSON.stringify({
      itemId, relativePath, operationId, revision, baseRevision,
      requestHash: hash(JSON.stringify([itemId, relativePath, baseRevision, revision])),
    }));
  }

  it("recovers a durable intent interrupted before visible file replacement", async () => {
    const bytes = pack("pending");
    await pending("op-1", bytes, null);
    expect(await readVaultTextpack({ root, workspaceId, itemId })).toMatchObject({ revision: hash(bytes) });
    expect(await writeVaultTextpack(input(root, "op-1", bytes))).toMatchObject({ status: "written" });
    expect(await fs.readdir(path.join(root, workspaceId, ".texttext/pending"))).toEqual([]);
  });

  it("recovers after replacement but before receipt without overwriting a newer external edit", async () => {
    const first = pack("first");
    await writeVaultTextpack(input(root, "op-1", first));
    const interrupted = pack("interrupted");
    await pending("op-2", interrupted, hash(first));
    await fs.writeFile(path.join(root, workspaceId, relativePath), pack("new external edit"));
    const current = await readVaultTextpack({ root, workspaceId, itemId });
    expect(current?.revision).toBe(hash(pack("new external edit")));
    expect(await fs.readFile(path.join(root, workspaceId, ".texttext/conflicts/op-2.textpack"))).toEqual(Buffer.from(interrupted));
  });

  it("rejects traversal, symlinks, duplicate paths, and identity changes", async () => {
    const bytes = pack("first");
    await expect(writeVaultTextpack({ ...input(root, "op-0", bytes), relativePath: "../escape.textpack" })).rejects.toThrow("relative path");
    await expect(writeVaultTextpack({ ...input(root, "op-0", bytes), workspaceId: "../escape" })).rejects.toThrow("identifier");
    await writeVaultTextpack(input(root, "op-1", bytes));
    await expect(writeVaultTextpack({ ...input(root, "op-2", pack("first", "other")), itemId: "other" })).rejects.toThrow("another item");
    await expect(writeVaultTextpack({ ...input(root, "op-2", bytes), relativePath: "Other.textpack" })).rejects.toThrow("move operation");
    await fs.symlink(os.tmpdir(), path.join(root, workspaceId, "Escape"));
    await expect(writeVaultTextpack({ ...input(root, "op-3", pack("first", "other")), itemId: "other", relativePath: "Escape/Bad.textpack" })).rejects.toThrow("symlink");
  });

  it("recovers a dead process lock automatically", async () => {
    const dead = spawnSync(process.execPath, ["-e", ""]);
    expect(dead.status).toBe(0);
    const dir = path.join(root, workspaceId, ".texttext/locks");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "dead.json"), JSON.stringify({
      pid: dead.pid, host: os.hostname(), choosing: true, ticket: "0",
    }));
    await expect(writeVaultTextpack(input(root, "op-1", pack("first")))).resolves.toMatchObject({ status: "written" });
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("serializes concurrent writers so only one wins a shared base revision", async () => {
    const first = pack("first");
    await writeVaultTextpack(input(root, "op-1", first));
    const results = await Promise.all([
      writeVaultTextpack(input(root, "op-2", pack("left"), hash(first))),
      writeVaultTextpack(input(root, "op-3", pack("right"), hash(first))),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["conflict", "written"]);
  });

  it("rejects invalid document packs before writing workspace data", async () => {
    await expect(writeVaultTextpack(input(root, "op-1", new Uint8Array([1, 2, 3])))).rejects.toThrow();
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("replays a durable audit outbox after the audit service fails", async () => {
    const bytes = pack("audited");
    await expect(writeVaultTextpack({ ...input(root, "op-1", bytes),
      audit: { actorUserId: "user-1", actorType: "human" },
      onReceipt: async () => { throw new Error("audit temporarily unavailable"); },
    })).rejects.toThrow("audit temporarily unavailable");
    const receipts: unknown[] = [];
    const current = await readVaultTextpack({ root, workspaceId, itemId,
      onReceipt: async (receipt) => { receipts.push(receipt); },
    });
    expect(current?.revision).toBe(hash(bytes));
    expect(receipts).toMatchObject([{ workspaceId, operationId: "op-1", actorUserId: "user-1" }]);
    expect(await fs.readdir(path.join(root, workspaceId, ".texttext/pending"))).toEqual([]);
  });

  it("merges compatible stale writes from full pack history and exposes the final revision", async () => {
    const base = pack("one\ntwo\nthree");
    await writeVaultTextpack(input(root, "op-1", base));
    await writeVaultTextpack(input(root, "op-2", pack("ONE\ntwo\nthree"), hash(base)));
    const uploaded = pack("one\ntwo\nTHREE");
    const request = input(root, "op-3", uploaded, hash(base));
    const result = await writeVaultTextpack(request);
    expect(result.status).toBe("written");
    expect(result.revision).not.toBe(hash(uploaded));
    const current = await readVaultTextpack({ root, workspaceId, itemId });
    const entries = unzipSync(current!.bytes);
    expect(JSON.parse(Buffer.from(entries["Note.textbundle/document.json"]).toString()).content.body).toBe("ONE\ntwo\nTHREE");
    expect(await writeVaultTextpack(request)).toEqual(result);
    expect((await listVaultTextpacks({ root, workspaceId })).items).toEqual([{ itemId, relativePath, revision: result.revision }]);
  });

  it("waits for file notifications and releases the request watcher on abort", async () => {
    const base = pack("base");
    await writeVaultTextpack(input(root, "op-1", base));
    const manifest = await listVaultTextpacks({ root, workspaceId });
    const controller = new AbortController();
    const waiting = waitVaultTextpacks({ root, workspaceId, revision: manifest.revision, waitMs: 25_000, signal: controller.signal });
    controller.abort();
    expect((await waiting).revision).toBe(manifest.revision);
    const next = waitVaultTextpacks({ root, workspaceId, revision: manifest.revision, waitMs: 1000 });
    await writeVaultTextpack(input(root, "op-2", pack("changed"), hash(base)));
    expect((await next).revision).not.toBe(manifest.revision);
  });

  it("moves exact pack bytes and rejects stale paths even when content hashes match", async () => {
    const bytes = pack("move me");
    await writeVaultTextpack(input(root, "op-1", bytes));
    const mutation = { root, workspaceId, itemId, operationId: "op-2", basePath: relativePath, baseRevision: hash(bytes), relativePath: "Archive/Moved.textpack" };
    const result = await moveVaultTextpack(mutation);
    expect(result).toMatchObject({ status: "moved", relativePath: "Archive/Moved.textpack", revision: hash(bytes) });
    expect(await moveVaultTextpack(mutation)).toEqual(result);
    await expect(fs.readFile(path.join(root, workspaceId, relativePath))).rejects.toThrow();
    expect((await readVaultTextpack({ root, workspaceId, itemId }))?.bytes).toEqual(Buffer.from(bytes));
    expect(await deleteVaultTextpack({ ...mutation, operationId: "stale-delete" })).toMatchObject({
      status: "conflict", relativePath: "Archive/Moved.textpack", revision: hash(bytes),
    });
  });

  it("retains deleted packs and publishes tombstones without allowing stale resurrection", async () => {
    const bytes = pack("delete me");
    await writeVaultTextpack(input(root, "op-1", bytes));
    const mutation = { root, workspaceId, itemId, operationId: "op-2", basePath: relativePath, baseRevision: hash(bytes) };
    const result = await deleteVaultTextpack(mutation);
    expect(result).toMatchObject({ status: "deleted", revision: hash(bytes) });
    expect(await deleteVaultTextpack(mutation)).toEqual(result);
    expect(await readVaultTextpack({ root, workspaceId, itemId })).toBeNull();
    const manifest = await listVaultTextpacks({ root, workspaceId });
    expect(manifest.items).toEqual([]);
    expect(manifest.tombstones).toEqual([{ itemId, relativePath, revision: hash(bytes), deleted: true }]);
    expect(await fs.readFile(path.join(root, workspaceId, ".texttext/removed/op-2.textpack"))).toEqual(Buffer.from(bytes));
    expect(await writeVaultTextpack(input(root, "op-3", pack("offline changes"), hash(bytes)))).toMatchObject({ status: "conflict", deleted: true });
    expect(await readVaultTextpack({ root, workspaceId, itemId })).toBeNull();
  });

  it("refuses stale deletion and occupied move destinations", async () => {
    const bytes = pack("base");
    await writeVaultTextpack(input(root, "op-1", bytes));
    await writeVaultTextpack(input(root, "op-2", pack("new edit"), hash(bytes)));
    expect(await deleteVaultTextpack({ root, workspaceId, itemId, operationId: "op-3", basePath: relativePath, baseRevision: hash(bytes) })).toMatchObject({ status: "conflict" });
    const destination = "Occupied.textpack";
    await fs.writeFile(path.join(root, workspaceId, destination), pack("someone else"));
    expect(await moveVaultTextpack({ root, workspaceId, itemId, operationId: "op-4", basePath: relativePath, baseRevision: hash(pack("new edit")), relativePath: destination })).toMatchObject({ status: "conflict" });
    expect((await readVaultTextpack({ root, workspaceId, itemId }))?.relativePath).toBe(relativePath);
    expect(await fs.readFile(path.join(root, workspaceId, destination))).toEqual(Buffer.from(pack("someone else")));
  });

  it("recovers deletion interrupted after source was retained but before tombstone commit", async () => {
    const bytes = pack("retained");
    await writeVaultTextpack(input(root, "op-1", bytes));
    const operationId = "delete-interrupted";
    const dir = path.join(root, workspaceId, ".texttext/pending", operationId);
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "intent.json"), JSON.stringify({
      kind: "delete", workspaceId, itemId, operationId, basePath: relativePath, relativePath,
      baseRevision: hash(bytes), requestHash: hash(JSON.stringify(["delete", itemId, relativePath, relativePath, hash(bytes), null])),
    }));
    await fs.rename(path.join(root, workspaceId, relativePath), path.join(root, workspaceId, `.texttext/removed/${operationId}.textpack`));
    expect(await readVaultTextpack({ root, workspaceId, itemId })).toBeNull();
    expect((await listVaultTextpacks({ root, workspaceId })).tombstones).toHaveLength(1);
    expect(await fs.readFile(path.join(root, workspaceId, `.texttext/removed/${operationId}.textpack`))).toEqual(Buffer.from(bytes));
  });

  it("discovers direct new files and renames, then records a direct deletion tombstone", async () => {
    const dir = path.join(root, workspaceId, "Agent");
    await fs.mkdir(dir, { recursive: true });
    const bytes = pack("direct file");
    await fs.writeFile(path.join(dir, "Direct.textpack"), bytes);
    expect((await listVaultTextpacks({ root, workspaceId })).items).toEqual([{ itemId, relativePath: "Agent/Direct.textpack", revision: hash(bytes) }]);
    await fs.rename(path.join(dir, "Direct.textpack"), path.join(dir, "Renamed.textpack"));
    const moved = await listVaultTextpacks({ root, workspaceId });
    expect(moved.items[0].relativePath).toBe("Agent/Renamed.textpack");
    expect(moved.tombstones).toEqual([]);
    await fs.unlink(path.join(dir, "Renamed.textpack"));
    const deleted = await listVaultTextpacks({ root, workspaceId });
    expect(deleted.items).toEqual([]);
    expect(deleted.tombstones[0]).toMatchObject({ itemId, relativePath: "Agent/Renamed.textpack", deleted: true });
  });

  it("reports duplicate external identities without overwriting either file", async () => {
    const bytes = pack("first");
    await writeVaultTextpack(input(root, "op-1", bytes));
    const duplicate = pack("duplicate external edit");
    await fs.writeFile(path.join(root, workspaceId, "Duplicate.textpack"), duplicate);
    const manifest = await listVaultTextpacks({ root, workspaceId });
    expect(manifest.items).toHaveLength(1);
    expect(manifest.problems).toEqual([{ relativePath: "Duplicate.textpack", reason: "Another file has the same item identity" }]);
    expect(await fs.readFile(path.join(root, workspaceId, "Duplicate.textpack"))).toEqual(Buffer.from(duplicate));
    expect((await readVaultTextpack({ root, workspaceId, itemId }))?.bytes).toEqual(Buffer.from(bytes));
  });
});
