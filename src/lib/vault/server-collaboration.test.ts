import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import { fork } from "node:child_process";
import { once } from "node:events";
import { unzipSync, strFromU8 } from "fflate";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { documentText } from "@/lib/collab/document";
import { applyVaultCollaboration, type VaultCollaborationState } from "./collaboration";
import { readVaultCollaboration, waitVaultCollaboration, listVaultTextpacks, pushVaultCollaboration, readVaultTextpack, writeVaultTextpack, moveVaultTextpack, deleteVaultTextpack, mutateVaultDocument, VaultCollaborationEpochError } from "./server-store";
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
function pack(body: string, files?: Record<string, Uint8Array>) {
  const document = emptyDocumentSnapshot(); document.content.body = body;
  return buildTextpack("Note", { document, markdown: `---\ntextTextId: item-1\n---\n\n${body}`, files });
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

  it("retains local retry receipts through shared editing and agent mutations", async () => {
    const receiptPath = "net.texttext.mutations/" + "a".repeat(64) + ".json";
    const receipt = new TextEncoder().encode(JSON.stringify({ fingerprint: "b".repeat(64) }));
    const original = (await readVaultTextpack(location()))!;
    await writeVaultTextpack({ ...location(), relativePath, operationId: "add-local-receipt",
      baseRevision: original.revision, bytes: pack("Hello", { [receiptPath]: receipt }) });
    const state = (await readVaultCollaboration(location()))!;
    await push("shared-after-receipt", state, edit(state, " shared edit"));
    const shared = (await readVaultTextpack(location()))!;
    expect(unzipSync(shared.bytes)["Note.textbundle/" + receiptPath]).toEqual(receipt);
    await mutateVaultDocument({ ...location(), operationId: "agent-after-receipt",
      expectedRevision: shared.revision, mutation: { appendBody: "Agent edit" },
      audit: { actorUserId: "agent-1", actorType: "external_agent" } });
    const saved = (await readVaultTextpack(location()))!;
    expect(unzipSync(saved.bytes)["Note.textbundle/" + receiptPath]).toEqual(receipt);
    expect(strFromU8(unzipSync(saved.bytes)["Note.textbundle/text.md"])).toContain("Agent edit");
  });

  it("preserves the actual Markdown path across edits and renames", async () => {
    const initial = (await readVaultCollaboration(location()))!;
    await push("path-edit", initial, edit(initial, " edited"));
    const saved = (await readVaultTextpack(location()))!;
    expect(strFromU8(unzipSync(saved.bytes)["Note.textbundle/text.md"])).toContain(`slug: "${relativePath}"`);
    await moveVaultTextpack({ ...location(), operationId: "path-move", basePath: relativePath,
      baseRevision: saved.revision, relativePath: "Notes/Renamed.textpack" });
    const moved = (await readVaultCollaboration(location()))!;
    await push("renamed-edit", moved, edit(moved, " again"));
    const renamed = (await readVaultTextpack(location()))!;
    expect(strFromU8(unzipSync(renamed.bytes)["Note.textbundle/text.md"])).toContain('slug: "Notes/Renamed.textpack"');
  });

  it("waits quietly, wakes for a committed edit, and closes an aborted wait", async () => {
    const initial = (await readVaultCollaboration(location()))!;
    const checkpoint = path.join(root, workspaceId, ".texttext/collaboration", `${itemId}.json`);
    const before = await fs.stat(checkpoint);
    const idle = await waitVaultCollaboration({ ...location(), epoch: initial.epoch, seq: initial.seq, waitMs: 40 });
    expect(idle).toEqual(initial);
    expect((await fs.stat(checkpoint)).mtimeMs).toBe(before.mtimeMs);
    const waiting = waitVaultCollaboration({ ...location(), epoch: initial.epoch, seq: initial.seq, waitMs: 25000 });
    await push("wake", initial, edit(initial, " changed"));
    expect((await waiting)?.seq).toBe(initial.seq + 1);
    const abort = new AbortController();
    const current = (await readVaultCollaboration(location()))!;
    const canceled = waitVaultCollaboration({ ...location(), epoch: current.epoch, seq: current.seq, waitMs: 25000, signal: abort.signal });
    abort.abort();
    expect(await canceled).toEqual(current);
  });

  it("ignores unrelated workspace notifications until the collaboration cursor changes", async () => {
    const initial = (await readVaultCollaboration(location()))!;
    const abort = new AbortController();
    const waiting = waitVaultCollaboration({ ...location(), epoch: initial.epoch, seq: initial.seq, waitMs: 2_000, signal: abort.signal });
    try {
      await new Promise(resolve => setTimeout(resolve, 25));
      await fs.writeFile(path.join(root, workspaceId, "unrelated.txt"), "not a checkpoint");
      const early = await Promise.race([
        waiting.then(() => "woke" as const),
        new Promise<"still-waiting">(resolve => setTimeout(() => resolve("still-waiting"), 50)),
      ]);
      expect(early).toBe("still-waiting");

      await push("wake-after-commit", initial, edit(initial, " committed"));
      expect((await waiting)?.seq).toBe(initial.seq + 1);
    } finally {
      abort.abort();
    }
  });

  it.each(["revoke", "abort"])("rejects a queued writer after %s while waiting on the workspace lock", async (reason) => {
    const initial = (await readVaultCollaboration(location()))!;
    let entered!: () => void, release!: () => void;
    const holding = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = pushVaultCollaboration({ ...location(), operationId: "held", epoch: initial.epoch,
      updates: [edit(initial, " committed")], audit, onReceipt: async () => { entered(); await gate; } });
    await holding;
    let allowed = true;
    const abort = new AbortController();
    const second = pushVaultCollaboration({ ...location(), operationId: "queued", epoch: initial.epoch,
      updates: [edit(initial, " forbidden")], audit, signal: abort.signal,
      beforeCommit: async () => { if (!allowed) throw new Error("Permission revoked"); } });
    const outcome = second.then(() => null, error => error as Error);
    try {
      const deadline = Date.now() + 2000;
      while ((await fs.readdir(path.join(root, workspaceId, ".texttext/locks"))).length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
      expect((await fs.readdir(path.join(root, workspaceId, ".texttext/locks"))).length).toBe(2);
      allowed = false;
      if (reason === "abort") abort.abort();
    } finally { release(); }
    await first;
    expect((await outcome)?.message).toMatch(reason === "abort" ? /abort/i : /revoked/);
    expect(body((await readVaultCollaboration(location()))!)).toBe("Hello committed");
  });

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

  it("projects a verified local file edit into live Yjs without dropping a concurrent editor", async () => {
    const initial = (await readVaultCollaboration(location()))!;
    const pendingHuman = edit(initial, " human");
    // A filesystem agent may rewrite text.md without touching document.json.
    const structured = emptyDocumentSnapshot(); structured.content.body = "Hello";
    const fileEdit = buildTextpack("Note", { document: structured,
      markdown: "---\ntextTextId: item-1\n---\n\nHello agent" });
    const written = await writeVaultTextpack({ ...location(), relativePath, operationId: "local-file-edit",
      baseRevision: initial.revision, bytes: fileEdit, liveReconcile: true });
    expect(written.status).toBe("written");
    const projected = (await readVaultCollaboration(location()))!;
    expect(projected.epoch).toBe(initial.epoch);
    expect(projected.seq).toBe(initial.seq + 1);
    expect(body(projected)).toBe("Hello agent");
    await push("human-after-file", initial, pendingHuman);
    const merged = (await readVaultCollaboration(location()))!;
    expect(body(merged)).toContain("agent");
    expect(body(merged)).toContain("human");
    expect((await readVaultTextpack(location()))?.revision).toBe(merged.revision);
  });

  it("keeps live text identities when a verified file edit adds, replaces or removes attachments", async () => {
    let initial = (await readVaultCollaboration(location()))!;
    const cases: Record<string, Uint8Array>[] = [
      { "assets/opaque.bin": new Uint8Array([1, 2, 3]) },
      { "assets/opaque.bin": new Uint8Array([4, 5, 6]), "assets/second.bin": new Uint8Array([7]) },
      {},
    ];
    for (const [index, files] of cases.entries()) {
      const pending = edit(initial, ` human-${index}`);
      const changed = pack(body(initial), files);
      const written = await writeVaultTextpack({ ...location(), relativePath, operationId: `attachment-${index}`,
        baseRevision: initial.revision, bytes: changed, liveReconcile: true });
      expect(written.status).toBe("written");
      const observed = (await readVaultCollaboration(location()))!;
      expect(observed.epoch).toBe(initial.epoch);
      await push(`human-after-attachment-${index}`, initial, pending);
      initial = (await readVaultCollaboration(location()))!;
      expect(body(initial)).toContain(`human-${index}`);
      const stored = (await readVaultTextpack(location()))!;
      const entries = unzipSync(stored.bytes);
      const assets = Object.fromEntries(Object.entries(entries).filter(([name]) => name.includes("/assets/"))
        .map(([name, bytes]) => [name.slice(name.indexOf("assets/")), bytes]));
      expect(assets).toEqual(files);
    }
  });

  it("still fences unrelated opaque pack metadata changes", async () => {
    const initial = (await readVaultCollaboration(location()))!;
    const changed = pack("Hello", { "opaque.bin": new Uint8Array([1, 2, 3]) });
    await writeVaultTextpack({ ...location(), relativePath, operationId: "opaque-metadata-edit",
      baseRevision: initial.revision, bytes: changed, liveReconcile: true });
    const reopened = (await readVaultCollaboration(location()))!;
    expect(reopened.epoch).toBe(initial.epoch + 1);
    await expect(push("stale-after-metadata", initial, edit(initial, " stale")))
      .rejects.toBeInstanceOf(VaultCollaborationEpochError);
  });

  it("projects a raw Markdown-only file edit observed through the cached listing", async () => {
    const initial = (await readVaultCollaboration(location()))!;
    const pendingHuman = edit(initial, " human");
    const structured = emptyDocumentSnapshot(); structured.content.body = "Hello";
    await fs.writeFile(path.join(root, workspaceId, relativePath), buildTextpack("Note", {
      document: structured, markdown: "---\ntextTextId: item-1\n---\n\nHello agent",
    }));
    await listVaultTextpacks(location());
    const projected = (await readVaultCollaboration(location()))!;
    expect(projected.epoch).toBe(initial.epoch);
    expect(projected.seq).toBe(initial.seq + 1);
    expect(body(projected)).toBe("Hello agent");
    await push("human-after-raw-file", initial, pendingHuman);
    const merged = (await readVaultCollaboration(location()))!;
    expect(body(merged)).toContain("agent");
    expect(body(merged)).toContain("human");
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
    expect(recovered).toEqual({ ...next.state, relativePath, presentation: { templateJSON: null, templateAuthoringSourceJSON: null } });
    expect((await readVaultTextpack(location()))!.bytes).toEqual(Buffer.from(next.bytes));
    await push(operationId, state, update);
    expect(await readVaultCollaboration(location())).toEqual(recovered);
    expect(await fs.readdir(path.dirname(pending))).toEqual([]);
  });

  it("survives a killed writer and replays its unacknowledged operation exactly once", async () => {
    const state = (await readVaultCollaboration(location()))!, update = edit(state, " survived");
    const payloadFile = path.join(root, "request.json");
    await fs.writeFile(payloadFile, JSON.stringify({ workspaceId, itemId, operationId: "killed-writer", epoch: state.epoch, updates: [update], audit }));
    const child = fork(path.resolve("scripts/fixtures/sync-crash-worker.ts"), [root, payloadFile], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let errors = "";
    child.stderr?.on("data", chunk => { errors = (errors + chunk).slice(-2000); });
    try {
      const committed = await Promise.race([
        once(child, "message").then(([value]) => value),
        once(child, "exit").then(() => { throw new Error(`Writer exited before commit: ${errors}`); }),
      ]);
      expect(committed).toBe("committed-before-acknowledgement");
      const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
      const recovered = (await readVaultCollaboration(location()))!;
      expect(body(recovered)).toBe("Hello survived");
      await push("killed-writer", state, update);
      expect(await readVaultCollaboration(location())).toEqual(recovered);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 15_000);

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
