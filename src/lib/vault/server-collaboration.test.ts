import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { documentText } from "@/lib/collab/document";
import { applyVaultCollaboration, type VaultCollaborationState } from "./collaboration";
import { readVaultCollaboration, listVaultTextpacks, pushVaultCollaboration, readVaultTextpack, writeVaultTextpack, moveVaultTextpack, deleteVaultTextpack, VaultCollaborationEpochError } from "./server-store";
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
function pack(body: string) {
  const document = emptyDocumentSnapshot(); document.content.body = body;
  return buildTextpack("Note", { document, markdown: `---\ntextTextId: item-1\n---\n\n${body}` });
}
function edit(state: VaultCollaborationState, text: string) {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, Buffer.from(state.update, "base64"));
    const vector = Y.encodeStateVector(doc);
    const body = documentText(doc, "body"); body.insert(body.length, text);
    return Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString("base64");
  } finally { doc.destroy(); }
}
function body(state: VaultCollaborationState) {
  const doc = new Y.Doc();
  try { Y.applyUpdate(doc, Buffer.from(state.update, "base64")); return documentText(doc, "body").toString(); }
  finally { doc.destroy(); }
}
describe("durable file collaboration", () => {
  let root: string;
  const workspaceId = "workspace-1", itemId = "item-1", relativePath = "Notes/Shared.textpack";
  const audit = { actorUserId: "user-1", actorType: "human" as const };
  const onReceipt = async () => {};
  const location = () => ({ root, workspaceId, itemId, onReceipt });
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-file-collab-"));
    await writeVaultTextpack({ ...location(), relativePath, operationId: "initial", baseRevision: null, bytes: pack("Hello") });
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const push = (operationId: string, state: VaultCollaborationState, update: string) => pushVaultCollaboration({ ...location(), operationId, epoch: state.epoch, updates: [update], audit });

  it("serializes concurrent clients, replays each operation once, and follows a rename", async () => {
    const initial = (await readVaultCollaboration(location()))!;
    const a = edit(initial, " Alice"), b = edit(initial, " Bob");
    const results = await Promise.all([push("alice", initial, a), push("bob", initial, b)]);
    const merged = (await readVaultCollaboration(location()))!;
    expect(body(merged)).toContain("Alice"); expect(body(merged)).toContain("Bob"); expect(merged.seq).toBe(2);
    expect(await push("alice", initial, a)).toEqual(results[0]);
    expect(await readVaultCollaboration(location())).toEqual(merged);
    await expect(push("alice", initial, b)).rejects.toThrow("reused");
    await moveVaultTextpack({ ...location(), operationId: "move", basePath: relativePath, baseRevision: merged.revision, relativePath: "Moved.textpack" });
    const moved = (await readVaultCollaboration(location()))!;
    expect(moved).toEqual({ ...merged, relativePath: "Moved.textpack" });
    await push("after-move", moved, edit(moved, " moved"));
    expect((await readVaultTextpack(location()))?.relativePath).toBe("Moved.textpack");
  });

  it("fences raw file changes and ordinary writes even after original bytes are restored", async () => {
    const initial = (await readVaultCollaboration(location()))!, pending = edit(initial, " pending");
    const original = (await readVaultTextpack(location()))!.bytes;
    const external = pack("External edit");
    await fs.writeFile(path.join(root, workspaceId, relativePath), external);
    await expect(push("stale", initial, pending)).rejects.toBeInstanceOf(VaultCollaborationEpochError);
    const refreshed = (await readVaultCollaboration(location()))!;
    expect(refreshed.epoch).toBe(initial.epoch + 1); expect(body(refreshed)).toBe("External edit");
    await writeVaultTextpack({ ...location(), relativePath, operationId: "restore", baseRevision: hash(external), bytes: original });
    await expect(push("stale-again", initial, pending)).rejects.toBeInstanceOf(VaultCollaborationEpochError);
    const reset = (await readVaultCollaboration(location()))!;
    const changed = pack("Intermediate");
    await writeVaultTextpack({ ...location(), relativePath, operationId: "change", baseRevision: hash(original), bytes: changed });
    await writeVaultTextpack({ ...location(), relativePath, operationId: "undo-change", baseRevision: hash(changed), bytes: original });
    await expect(push("aba", reset, edit(reset, " obsolete"))).rejects.toBeInstanceOf(VaultCollaborationEpochError);
    expect((await readVaultTextpack(location()))!.bytes).toEqual(Buffer.from(original));
  });

  it.each(["list", "read"])("fences observed raw edit-and-revert through %s", async (observer) => {
    const initial = (await readVaultCollaboration(location()))!;
    const original = (await readVaultTextpack(location()))!.bytes;
    await fs.writeFile(path.join(root, workspaceId, relativePath), pack("Observed change"));
    if (observer === "list") await listVaultTextpacks(location());
    else await readVaultTextpack(location());
    await fs.writeFile(path.join(root, workspaceId, relativePath), original);
    await expect(push("observed-aba", initial, edit(initial, " stale"))).rejects.toBeInstanceOf(VaultCollaborationEpochError);
  });

  it("fails closed on a corrupt persisted collaboration checkpoint", async () => {
    const initial = (await readVaultCollaboration(location()))!;
    const file = path.join(root, workspaceId, ".texttext/collaboration", `${itemId}.json`);
    for (const corrupted of [{ ...initial, seq: -1 }, { ...initial, update: "bad" }]) {
      await fs.writeFile(file, JSON.stringify(corrupted));
      await expect(readVaultCollaboration(location())).rejects.toThrow();
    }
  });

  it("never resurrects a deleted file and rejects unaudited changes", async () => {
    const state = (await readVaultCollaboration(location()))!, update = edit(state, " pending");
    await expect(pushVaultCollaboration({ ...location(), onReceipt: undefined, operationId: "no-audit", epoch: state.epoch, updates: [update], audit })).rejects.toThrow("audit sink");
    await deleteVaultTextpack({ ...location(), operationId: "delete", basePath: relativePath, baseRevision: state.revision });
    expect(await readVaultCollaboration(location())).toBeNull();
    await expect(push("late", state, update)).rejects.toThrow("missing or deleted");
    expect(await readVaultTextpack(location())).toBeNull();
  });

  it.each([false, true])("recovers checkpoint and pack from a durable intent (pack already written: %s)", async (written) => {
    const state = (await readVaultCollaboration(location()))!, update = edit(state, " recovered");
    const bytes = (await readVaultTextpack(location()))!.bytes;
    const next = applyVaultCollaboration(state, bytes, [update]);
    const operationId = "interrupted", updates = [update];
    const pending = path.join(root, workspaceId, ".texttext/pending", operationId);
    await fs.mkdir(pending);
    await fs.writeFile(path.join(pending, "payload.textpack"), next.bytes);
    await fs.writeFile(path.join(pending, "intent.json"), JSON.stringify({ itemId, operationId, relativePath,
      baseRevision: state.revision, revision: next.state.revision, workspaceId, audit, collaboration: next.state,
      requestHash: hash(JSON.stringify(["collaboration", itemId, state.epoch, updates, audit])) }));
    if (written) await fs.writeFile(path.join(root, workspaceId, relativePath), next.bytes);
    const recovered = (await readVaultCollaboration(location()))!;
    expect(recovered).toEqual({ ...next.state, relativePath });
    expect((await readVaultTextpack(location()))!.bytes).toEqual(Buffer.from(next.bytes));
    await push(operationId, state, update);
    expect(await readVaultCollaboration(location())).toEqual(recovered);
    expect(await fs.readdir(path.dirname(pending))).toEqual([]);
  });

  it("keeps the committed checkpoint through audit outage without applying updates twice", async () => {
    const state = (await readVaultCollaboration(location()))!, update = edit(state, " audit");
    await expect(pushVaultCollaboration({ ...location(), operationId: "audited", epoch: state.epoch, updates: [update], audit,
      onReceipt: async () => { throw new Error("audit unavailable"); } })).rejects.toThrow("audit unavailable");
    const recovered = (await readVaultCollaboration(location()))!;
    expect(recovered.seq).toBe(1); expect(body(recovered)).toBe("Hello audit");
    await push("audited", state, update);
    expect(await readVaultCollaboration(location())).toEqual(recovered);
  });
});
