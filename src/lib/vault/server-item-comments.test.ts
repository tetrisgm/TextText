import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { readVaultItemCommentsFromPack } from "./item-comments";
import { openPack, encodePack } from "@/local-vault/pack";
import { readDocument, writePayload } from "@/local-vault/model";
import { mutateVaultItemComments, pushVaultCollaboration, readVaultCollaboration,
  readVaultTextpack, writeVaultTextpack, type VaultMutationReceipt } from "./server-store";

describe("file-backed vault comments", () => {
  let root: string;
  const workspaceId = "workspace-1", itemId = "item-1", relativePath = "Notes/Shared.textpack";
  const actor = { userId: randomUUID(), name: "Ava", type: "human" as const };
  const onReceipt = vi.fn(async (receipt: VaultMutationReceipt) => { expect("itemId" in receipt.result && receipt.result.itemId).toBe(itemId); });
  const location = () => ({ root, workspaceId, itemId, onReceipt });
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-vault-comments-"));
    const document = emptyDocumentSnapshot(); document.content.title = "Shared"; document.content.body = "Keep this text";
    const bytes = buildTextpack("Shared", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\nKeep this text` });
    await writeVaultTextpack({ ...location(), operationId: "seed", relativePath, baseRevision: null, bytes });
    onReceipt.mockClear();
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("stores comments and one-level replies in the TextPack with paged reads and one audit per write", async () => {
    const firstId = randomUUID(), replyId = randomUUID();
    const original = unzipSync((await readVaultTextpack(location()))!.bytes);
    const first = await mutateVaultItemComments({ ...location(), operationId: firstId,
      actor, mutation: { kind: "create", body: "  A thought  " } });
    expect(first).toMatchObject({ status: "written", commentId: firstId });
    const replay = await mutateVaultItemComments({ ...location(), operationId: firstId,
      actor, mutation: { kind: "create", body: "  A thought  " } });
    expect(replay).toEqual(first);
    expect(onReceipt).toHaveBeenCalledTimes(2); // Idempotent audit receipt delivery.
    expect(onReceipt.mock.calls[0][0]).toMatchObject({ actionName: "vault.comment.create", result: { itemId } });
    await mutateVaultItemComments({ ...location(), operationId: replyId, actor,
      mutation: { kind: "create", body: "Reply", parentId: firstId } });
    expect(onReceipt.mock.calls.at(-1)?.[0]).toMatchObject({ actionName: "vault.comment.reply" });
    const stored = (await readVaultTextpack(location()))!;
    const expanded = unzipSync(stored.bytes);
    for (const name of Object.keys(original)) expect(expanded[name]).toEqual(original[name]);
    const page = readVaultItemCommentsFromPack(stored.bytes, itemId, 1);
    expect(page.comments).toMatchObject([{ id: firstId, body: "A thought", parentId: null }]);
    expect(readVaultItemCommentsFromPack(stored.bytes, itemId, 1, page.nextCursor).comments)
      .toMatchObject([{ id: replyId, parentId: firstId, body: "Reply" }]);
    await expect(mutateVaultItemComments({ ...location(), operationId: randomUUID(), actor,
      mutation: { kind: "create", body: "Invalid", parentId: replyId } })).rejects.toThrow("Parent comment not found");
  });

  it("resolves only roots and keeps the Yjs epoch stable across metadata-only writes", async () => {
    const baseline = (await readVaultCollaboration(location()))!;
    const id = randomUUID();
    await mutateVaultItemComments({ ...location(), operationId: id, actor,
      mutation: { kind: "create", body: "Review this" } });
    const afterComment = (await readVaultCollaboration(location()))!;
    expect(afterComment).toMatchObject({ epoch: baseline.epoch, seq: baseline.seq, update: baseline.update });
    expect(afterComment.revision).not.toBe(baseline.revision);
    await mutateVaultItemComments({ ...location(), operationId: randomUUID(), actor,
      mutation: { kind: "resolve", commentId: id, resolved: true } });
    expect(onReceipt.mock.calls.at(-1)?.[0]).toMatchObject({ actionName: "vault.comment.resolve" });
    const noChange = await mutateVaultItemComments({ ...location(), operationId: randomUUID(), actor,
      mutation: { kind: "resolve", commentId: id, resolved: true } });
    expect(noChange.status).toBe("unchanged");
    expect(onReceipt).toHaveBeenCalledTimes(2);
    const beforePush = (await readVaultCollaboration(location()))!;
    const pushed = await pushVaultCollaboration({ ...location(), operationId: "push-after-comment", epoch: beforePush.epoch,
      updates: ["AAA="], audit: { actorUserId: actor.userId, actorType: actor.type } });
    expect(pushed.status).toBe("written");
    const pack = (await readVaultTextpack(location()))!;
    expect(readVaultItemCommentsFromPack(pack.bytes, itemId).comments[0].resolvedAt).not.toBeNull();
    expect((await readVaultCollaboration(location()))?.epoch).toBe(baseline.epoch);
  });

  it("checks the current path under the vault lock before changing comment bytes", async () => {
    const before = (await readVaultTextpack(location()))!;
    await expect(mutateVaultItemComments({ ...location(), operationId: randomUUID(), actor,
      mutation: { kind: "create", body: "Blocked" }, beforeCommit: async relative => {
        expect(relative).toBe(relativePath); throw new Response(null, { status: 403 });
      } })).rejects.toMatchObject({ status: 403 });
    expect((await readVaultTextpack(location()))?.revision).toBe(before.revision);
    expect(onReceipt).not.toHaveBeenCalled();
  });

  it("merges a stale document edit without dropping a newer comment entry", async () => {
    const original = (await readVaultTextpack(location()))!;
    const opened = openPack(original.bytes, relativePath, original.revision, itemId);
    const document = readDocument(opened.file); document.content.body = "Edited after the comment was added";
    const localBytes = encodePack(opened, writePayload(opened.file, document));
    const commentId = randomUUID();
    await mutateVaultItemComments({ ...location(), operationId: commentId, actor,
      mutation: { kind: "create", body: "Keep this discussion" } });
    const result = await writeVaultTextpack({ ...location(), operationId: "stale-doc-edit", relativePath,
      baseRevision: original.revision, bytes: localBytes });
    expect(result.status).toBe("written");
    const final = (await readVaultTextpack(location()))!;
    expect(readDocument(openPack(final.bytes, relativePath, final.revision, itemId).file).content.body).toBe(document.content.body);
    expect(readVaultItemCommentsFromPack(final.bytes, itemId).comments).toMatchObject([{ id: commentId, body: "Keep this discussion" }]);
  });
});
