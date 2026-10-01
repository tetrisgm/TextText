import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), token: vi.fn(), workspace: vi.fn(), item: vi.fn(), access: vi.fn(), grants: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.session }));
vi.mock("@/lib/api-tokens", () => ({ resolveApiToken: mocks.token }));
vi.mock("@/lib/store", () => ({ getVaultWorkspaceIdentity: mocks.workspace, readVaultTextpack: mocks.item }));
vi.mock("@/lib/permissions", async importOriginal => ({ ...await importOriginal(), resolveWorkspaceAccess: mocks.access }));
vi.mock("@/lib/vault/grants", async importOriginal => ({ ...await importOriginal(), activeVaultGrants: mocks.grants }));
import { authorizeVaultItem, authorizeVaultItemAtPath } from "./scoped-auth";

const workspaceId = "56129da8-7467-4876-b238-46d748c2c57b", itemId = "item-one";
const request = (method = "GET", headers: Record<string, string> = {}) => new Request(`https://texttext.test/api/vault/${workspaceId}/items/${itemId}`, { method, headers });
const access = { blogId: workspaceId, userId: "f6d89625-919a-4ad7-bcff-ddc7edfc22d3", isOwner: false,
  canView: false, canEditContent: false, canComment: false };
const itemGrant = { id: "grant-one", scope: { type: "item", key: itemId }, role: "editor", folderSignature: null };
const folderGrant = { id: "grant-folder", scope: { type: "folder", key: "Reading" }, role: "commenter", folderSignature: "valid" };
const status = (result: unknown) => result instanceof Response ? result.status : 200;

describe("file-vault item authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", "/trusted/vault");
    mocks.session.mockResolvedValue({ sub: "member", userId: access.userId, name: "Member" });
    mocks.workspace.mockResolvedValue({ id: workspaceId, handle: "shared", name: "Shared" });
    mocks.access.mockResolvedValue(access);
    mocks.grants.mockResolvedValue([itemGrant]);
    mocks.item.mockResolvedValue({ itemId, relativePath: "Private/One.textpack", bytes: new Uint8Array([1]) });
  });

  it("uses workspace-qualified item identity and does not expose siblings", async () => {
    const allowed = await authorizeVaultItem(request(), workspaceId, itemId, "edit");
    expect(allowed).toMatchObject({ itemId, relativePath: "Private/One.textpack", canEditContent: true, fullAccess: false });
    expect(mocks.access).toHaveBeenCalledWith({ handle: "shared", user: expect.any(Object), fresh: true });
    expect(status(await authorizeVaultItemAtPath(request(), workspaceId, "sibling", "Private/Sibling.textpack", "read"))).toBe(404);
    expect(status(await authorizeVaultItemAtPath(request(), "5964de1f-149c-488d-8357-b95d7ec1ce48", itemId, "Private/One.textpack", "read"))).toBe(404);
  });

  it("honors folder boundaries and fresh revocation at the supplied locked path", async () => {
    mocks.grants.mockResolvedValue([folderGrant]);
    expect(status(await authorizeVaultItemAtPath(request(), workspaceId, itemId, "Reading/Child.textpack", "comment"))).toBe(200);
    expect(status(await authorizeVaultItemAtPath(request(), workspaceId, itemId, "Reading/Child.textpack", "edit"))).toBe(403);
    expect(status(await authorizeVaultItemAtPath(request(), workspaceId, itemId, "Reading Elsewhere/Child.textpack", "read"))).toBe(404);
    mocks.grants.mockResolvedValue([]);
    expect(status(await authorizeVaultItemAtPath(request(), workspaceId, itemId, "Reading/Child.textpack", "read"))).toBe(404);
  });

  it("recognizes verified app tokens for human presence without changing audit actor type", async () => {
    mocks.token.mockResolvedValue({ userId: access.userId, sub: "owner", name: "TextText Mac", scopes: "sync", kind: "app" });
    const app = await authorizeVaultItemAtPath(request("POST", { authorization: "Bearer opaque" }), workspaceId, itemId, "Private/One.textpack", "edit");
    expect(app).toMatchObject({ actorType: "external_agent", actorName: "TextText Mac", canUseHumanPresence: true });
    mocks.token.mockResolvedValue({ userId: access.userId, sub: "owner", name: "Agent", scopes: "sync", kind: "manual" });
    const agent = await authorizeVaultItemAtPath(request("POST", { authorization: "Bearer opaque" }), workspaceId, itemId, "Private/One.textpack", "edit");
    expect(agent).toMatchObject({ actorType: "external_agent", canUseHumanPresence: false, canManageShares: false });
  });

  it("checks same-origin cookie mutations and refuses invalid bearer fallback", async () => {
    expect(status(await authorizeVaultItemAtPath(request("POST"), workspaceId, itemId, "Private/One.textpack", "edit"))).toBe(403);
    mocks.session.mockClear();
    mocks.token.mockResolvedValue(null);
    expect(status(await authorizeVaultItemAtPath(request("GET", { authorization: "Bearer invalid" }), workspaceId, itemId, "Private/One.textpack", "read"))).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
  });
});
