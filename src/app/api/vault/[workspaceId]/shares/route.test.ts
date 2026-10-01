import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), read: vi.fn(), list: vi.fn(), invite: vi.fn(), change: vi.fn() }));
vi.mock("@/app/api/vault/scoped-auth", () => ({ authorizeVaultWorkspaceOrScoped: mocks.authorize }));
vi.mock("@/lib/store", () => ({ readVaultTextpack: mocks.read }));
vi.mock("@/lib/vault/grants", () => ({ listVaultGrants: mocks.list, inviteVaultGrant: mocks.invite, changeVaultGrant: mocks.change }));
import { GET, POST, PATCH, DELETE } from "./route";

const workspaceId = "56129da8-7467-4876-b238-46d748c2c57b", itemId = "item-one";
const grantId = "f6d89625-919a-4ad7-bcff-ddc7edfc22d3";
const context = { params: Promise.resolve({ workspaceId }) };
const url = `https://texttext.test/api/vault/${workspaceId}/shares`;
const owner = { root: "/trusted/vault", workspaceId, actorUserId: "e3cfb17b-0dea-4e90-a25e-e58deccf611f",
  actorType: "human", isOwner: true, canManageShares: true };
const scope = { scopeType: "item", scopeKey: itemId };
const request = (method: string, value: unknown) => new Request(url, { method,
  headers: { Origin: "https://texttext.test", "Content-Type": "application/json" }, body: JSON.stringify(value) });

describe("file-vault sharing route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorize.mockResolvedValue(owner);
    mocks.read.mockResolvedValue({ itemId, relativePath: "Notes/One.textpack" });
    mocks.list.mockResolvedValue([{ id: grantId, email: "member@example.test", role: "editor", createdAt: "2026-09-30T00:00:00.000Z", scope: { type: "item", key: itemId } }]);
    mocks.change.mockResolvedValue(true);
  });

  it("denies non-owner and generic sync tokens before reading or mutating grants", async () => {
    mocks.authorize.mockResolvedValueOnce({ ...owner, isOwner: false, canManageShares: false });
    expect((await GET(new Request(`${url}?${new URLSearchParams(scope)}`), context)).status).toBe(403);
    mocks.authorize.mockResolvedValueOnce({ ...owner, actorType: "external_agent", canManageShares: false });
    expect((await POST(request("POST", { ...scope, email: "member@example.test", role: "editor" }), context)).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.invite).not.toHaveBeenCalled();
  });

  it("returns only the requested scope's grants and accepts a verified owner app token", async () => {
    mocks.authorize.mockResolvedValue({ ...owner, actorType: "external_agent", canManageShares: true });
    const response = await GET(new Request(`${url}?${new URLSearchParams(scope)}`), context);
    expect(await response.json()).toEqual({ grants: [{ id: grantId, email: "member@example.test", role: "editor", createdAt: "2026-09-30T00:00:00.000Z" }] });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.list).toHaveBeenCalledWith(workspaceId, { type: "item", key: itemId });
  });

  it("checks a TextPack exists before invitation and passes the audited actor", async () => {
    mocks.read.mockResolvedValueOnce(null);
    expect((await POST(request("POST", { ...scope, email: "member@example.test", role: "editor" }), context)).status).toBe(404);
    expect(mocks.invite).not.toHaveBeenCalled();
    const response = await POST(request("POST", { ...scope, email: "member@example.test", role: "editor" }), context);
    expect(response.status).toBe(200);
    expect(mocks.invite).toHaveBeenCalledWith({ root: owner.root, workspaceId, scope: { type: "item", key: itemId },
      email: "member@example.test", role: "editor", actorUserId: owner.actorUserId, actorType: "human" });
  });

  it("updates and revokes only the addressed grant", async () => {
    expect((await PATCH(request("PATCH", { ...scope, grantId, role: "viewer" }), context)).status).toBe(200);
    expect(mocks.change).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, scope: { type: "item", key: itemId }, grantId, role: "viewer" }));
    expect((await DELETE(request("DELETE", { ...scope, grantId }), context)).status).toBe(200);
    expect(mocks.change).toHaveBeenCalledWith(expect.objectContaining({ grantId, revoke: true }));
    mocks.change.mockResolvedValueOnce(false);
    expect((await DELETE(request("DELETE", { ...scope, grantId }), context)).status).toBe(404);
  });
});
