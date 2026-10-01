import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./bridge", () => ({ vaultRequest: mocks.request, VaultError: class extends Error {} }));
import { readAllComments } from "./VaultComments";

const rootId = "36f4bd35-6e4c-48dc-a482-0fb885258b6d";
const replyId = "f5b9f142-42cf-427f-9d51-39e1ab7e7b4e";
const root = { id: rootId, parentId: null, body: "Check this", authorUserId: "author",
  authorName: "Amira", authorActorType: "human", createdAt: "2026-09-30T19:00:00.000Z",
  updatedAt: "2026-09-30T19:00:00.000Z", resolvedAt: null,
  resolvedByUserId: null, resolvedByActorType: null };

describe("file-vault comment pagination", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reads every page with an item-bound cursor and no caller-supplied workspace", async () => {
    mocks.request.mockResolvedValueOnce({ comments: [root], nextCursor: rootId, revision: "revision-1" })
      .mockResolvedValueOnce({ comments: [{ ...root, id: replyId, parentId: rootId, body: "Done" }],
        nextCursor: null, revision: "revision-1" });
    expect(await readAllComments("vault-item")).toHaveLength(2);
    expect(mocks.request.mock.calls).toEqual([
      ["commentsRead", { itemId: "vault-item", limit: 100 }, undefined],
      ["commentsRead", { itemId: "vault-item", limit: 100, after: rootId }, undefined],
    ]);
  });

  it("stops a repeated cursor instead of looping forever", async () => {
    mocks.request.mockResolvedValue({ comments: [root], nextCursor: rootId, revision: "revision" });
    await expect(readAllComments("vault-item")).rejects.toThrow("pages could not be completed");
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it("rejects a mixed revision when comments change between pages", async () => {
    mocks.request.mockResolvedValueOnce({ comments: [root], nextCursor: rootId, revision: "before" })
      .mockResolvedValueOnce({ comments: [{ ...root, id: replyId, parentId: rootId }], nextCursor: null, revision: "after" });
    await expect(readAllComments("vault-item")).rejects.toThrow("Comments changed while loading");
  });
});
