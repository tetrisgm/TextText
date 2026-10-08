import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), authorizeAtPath: vi.fn(), list: vi.fn(), mutate: vi.fn() }));
vi.mock("@/app/api/vault/scoped-auth", () => ({ authorizeVaultItem: mocks.authorize, authorizeVaultItemAtPath: mocks.authorizeAtPath }));
vi.mock("@/lib/store", () => ({ listVaultItemComments: mocks.list, mutateVaultItemComments: mocks.mutate,
  VaultBusyError: class VaultBusyError extends Error {} }));

import { GET, PATCH, POST } from "./route";

const url = "https://texttext.test/api/vault/workspace-1/items/item-1/comments";
const context = { params: Promise.resolve({ workspaceId: "workspace-1", itemId: "item-1" }) };
const actorUserId = "b98364d8-e0c2-4f11-9f9a-2661976d03cd";
const commentId = "21624174-f5b1-4bce-b832-5da5d27cfd9e";
const operationId = "6d90f794-e8e2-452e-93e1-a9de4e44cfd3";
const authorized = { root: "/trusted", workspaceId: "workspace-1", itemId: "item-1",
  relativePath: "Notes/Shared.textpack", actorUserId, actorName: "Ava", actorType: "human",
  canEditContent: true, canComment: true, canUseHumanPresence: true };
const post = (body: unknown) => new Request(url, { method: "POST", headers: { origin: "https://texttext.test" }, body: JSON.stringify(body) });
const patch = (body: unknown) => new Request(url, { method: "PATCH", headers: { origin: "https://texttext.test" }, body: JSON.stringify(body) });

describe("file-vault item comments route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorize.mockResolvedValue(authorized);
    mocks.authorizeAtPath.mockResolvedValue(authorized);
    mocks.list.mockResolvedValue({ comments: [], nextCursor: null, revision: "a".repeat(64), relativePath: authorized.relativePath });
    mocks.mutate.mockImplementation(async input => {
      await input.beforeCommit(authorized.relativePath);
      return { status: "written", itemId: "item-1", relativePath: authorized.relativePath,
        revision: "b".repeat(64), commentId: input.mutation.kind === "create" ? input.operationId : input.mutation.commentId };
    });
  });

  it("passes bounded image anchors without accepting caller identity", async () => {
    expect((await POST(post({ operationId, body: "Photo", imageAssetId: "photo-1" }), context)).status).toBe(200);
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ mutation: expect.objectContaining({ imageAssetId: "photo-1" }), actor: expect.objectContaining({ userId: actorUserId }) }));
    expect((await POST(post({ operationId, body: "Photo", imageAssetId: 1 }), context)).status).toBe(400);
    expect((await POST(post({ operationId, body: "Photo", imageAssetId: "photo", authorUserId: "other" }), context)).status).toBe(400);
  });

  it("bounds reads, rechecks access after the file read, and withholds a revoked page", async () => {
    const response = await GET(new Request(`${url}?limit=25`), context);
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ root: "/trusted", itemId: "item-1", limit: 25, after: null }));
    expect(mocks.authorize).toHaveBeenCalledTimes(2);
    expect((await GET(new Request(`${url}?limit=101`), context)).status).toBe(400);
    mocks.authorize.mockResolvedValueOnce(authorized).mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await GET(new Request(url), context)).status).toBe(403);
  });

  it("creates a comment and reply using authenticated identity and an in-lock scope recheck", async () => {
    const response = await POST(post({ operationId, body: "Review this", parentId: commentId }), context);
    expect(response.status).toBe(200);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.any(Request), "workspace-1", "item-1", "comment");
    expect(mocks.authorizeAtPath).toHaveBeenCalledWith(expect.any(Request), "workspace-1", "item-1", authorized.relativePath, "comment");
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ operationId,
      mutation: { kind: "create", body: "Review this", parentId: commentId },
      actor: { userId: actorUserId, name: "Ava", type: "human", authorType: "human" } }));
    expect((await POST(post({ operationId, body: "Hello", actorUserId: "forged" }), context)).status).toBe(400);
    expect((await POST(post({ operationId, body: "x".repeat(25_000) }), context)).status).toBe(413);
  });

  it("attributes the verified Mac app to a person while retaining external-agent audit provenance", async () => {
    mocks.authorize.mockResolvedValue({ ...authorized, actorType: "external_agent", canUseHumanPresence: true });
    expect((await POST(post({ operationId, body: "From the Mac" }), context)).status).toBe(200);
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ actor: {
      userId: actorUserId, name: "Ava", type: "external_agent", authorType: "human",
    } }));
    mocks.authorize.mockResolvedValue({ ...authorized, actorType: "external_agent", canUseHumanPresence: false });
    expect((await POST(post({ operationId: commentId, body: "From an agent" }), context)).status).toBe(200);
    expect(mocks.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ actor: {
      userId: actorUserId, name: "Ava", type: "external_agent", authorType: "external_agent",
    } }));
  });

  it("requires edit permission to resolve and does not commit after revocation", async () => {
    const response = await PATCH(patch({ operationId, commentId, resolved: true }), context);
    expect(response.status).toBe(200);
    expect(mocks.authorizeAtPath).toHaveBeenCalledWith(expect.any(Request), "workspace-1", "item-1", authorized.relativePath, "edit");
    mocks.authorize.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await PATCH(patch({ operationId, commentId, resolved: false }), context)).status).toBe(403);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    mocks.authorizeAtPath.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await POST(post({ operationId, body: "Too late" }), context)).status).toBe(403);
  });
});
