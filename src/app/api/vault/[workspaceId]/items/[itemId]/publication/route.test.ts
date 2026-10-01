import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), authorizeAtPath: vi.fn(), read: vi.fn(), mutate: vi.fn() }));
vi.mock("@/app/api/vault/scoped-auth", () => ({ authorizeVaultItem: mocks.authorize,
  authorizeVaultItemAtPath: mocks.authorizeAtPath }));
vi.mock("@/lib/store", () => ({ readVaultPublication: mocks.read, mutateVaultPublication: mocks.mutate,
  VaultBusyError: class VaultBusyError extends Error {} }));

import { GET, POST } from "./route";

const url = "https://texttext.test/api/vault/workspace-1/items/item-1/publication";
const context = { params: Promise.resolve({ workspaceId: "workspace-1", itemId: "item-1" }) };
const owner = { root: "/trusted", actorUserId: "b98364d8-e0c2-4f11-9f9a-2661976d03cd",
  actorType: "human", canManageShares: true, relativePath: "Notes/Shared.textpack" };
const operationId = "6d90f794-e8e2-452e-93e1-a9de4e44cfd3";
const baseRevision = "a".repeat(64);
const post = (body: unknown) => new Request(url, { method: "POST",
  headers: { origin: "https://texttext.test" }, body: JSON.stringify(body) });

describe("file-vault publication route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorize.mockResolvedValue(owner);
    mocks.authorizeAtPath.mockResolvedValue(owner);
    mocks.read.mockResolvedValue({ itemId: "item-1", relativePath: owner.relativePath,
      revision: baseRevision, publication: null });
    mocks.mutate.mockImplementation(async input => {
      await input.beforeCommit(owner.relativePath);
      return { status: "written", itemId: "item-1", relativePath: owner.relativePath, revision: "b".repeat(64) };
    });
  });

  it("gives authorized readers current state and checks their access again", async () => {
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ published: false, revision: baseRevision });
    expect(mocks.authorize).toHaveBeenCalledTimes(2);
    mocks.authorize.mockResolvedValueOnce(owner).mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await GET(new Request(url), context)).status).toBe(404);
  });

  it("allows only a workspace owner to publish and rechecks that role under the lock", async () => {
    const input = { operationId, baseRevision, published: true };
    expect((await POST(post(input), context)).status).toBe(200);
    expect(mocks.mutate).toHaveBeenCalledWith(expect.objectContaining({ operationId,
      published: true, actorUserId: owner.actorUserId, beforeCommit: expect.any(Function) }));
    expect(mocks.authorizeAtPath).toHaveBeenCalledWith(expect.any(Request), "workspace-1", "item-1",
      owner.relativePath, "read");
    mocks.authorize.mockResolvedValue({ ...owner, canManageShares: false });
    expect((await POST(post(input), context)).status).toBe(403);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    mocks.authorize.mockResolvedValue(owner);
    mocks.authorizeAtPath.mockResolvedValueOnce({ ...owner, canManageShares: false });
    expect((await POST(post(input), context)).status).toBe(403);
  });

  it("requires a bounded, exact request and returns a stale revision as a conflict", async () => {
    expect((await POST(post({ operationId, baseRevision, published: true, actorUserId: "forged" }), context)).status).toBe(400);
    expect((await POST(post({ operationId, baseRevision, published: "true" }), context)).status).toBe(400);
    expect((await POST(post({ operationId, baseRevision, published: true, padding: "x".repeat(2000) }), context)).status).toBe(413);
    mocks.mutate.mockResolvedValue({ status: "stale", itemId: "item-1", relativePath: owner.relativePath,
      revision: "c".repeat(64) });
    const response = await POST(post({ operationId, baseRevision, published: false }), context);
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
