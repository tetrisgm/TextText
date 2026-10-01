import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), userId: vi.fn(), identity: vi.fn(), list: vi.fn(), candidates: vi.fn(), grants: vi.fn(), canSee: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.session }));
vi.mock("@/lib/store", () => ({ getUserIdBySub: mocks.userId, getVaultWorkspaceIdentity: mocks.identity, listVaultTextpacks: mocks.list }));
vi.mock("@/lib/vault/grants", () => ({ candidateVaultSharedWorkspaces: mocks.candidates, activeVaultGrants: mocks.grants }));
vi.mock("@/app/api/vault/scoped-auth", () => ({ canSeeVaultItem: mocks.canSee }));
import { GET } from "./route";

const workspaceId = "56129da8-7467-4876-b238-46d748c2c57b";
describe("shared file-vault discovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", "/trusted/vault");
    mocks.session.mockResolvedValue({ sub: "recipient", userId: "recipient-id" });
    mocks.candidates.mockResolvedValue([workspaceId]);
    mocks.identity.mockResolvedValue({ id: workspaceId, name: "Shared workspace" });
    mocks.grants.mockResolvedValue([{ id: "grant", scope: { type: "item", key: "shared" }, role: "viewer" }]);
    mocks.list.mockResolvedValue({ items: [
      { itemId: "shared", relativePath: "Reading/Shared.textpack" },
      { itemId: "secret", relativePath: "Private/Secret.textpack" },
    ], problems: [{ relativePath: "Private/Broken.textpack" }], revision: "private-global-revision" });
    mocks.canSee.mockImplementation((_grants, itemId) => itemId === "shared");
  });
  it("returns only the invitee's file paths and a no-store entry link", async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ workspaces: [{ id: workspaceId, name: "Shared workspace",
      items: [{ itemId: "shared", relativePath: "Reading/Shared.textpack" }], folders: [] }] });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("omits revoked, deleted, or missing workspace grants", async () => {
    mocks.grants.mockResolvedValue([]);
    expect(await (await GET()).json()).toEqual({ workspaces: [] });
    mocks.grants.mockResolvedValue([{ id: "grant", scope: { type: "folder", key: "Reading" }, role: "viewer" }]);
    mocks.identity.mockResolvedValue(null);
    expect(await (await GET()).json()).toEqual({ workspaces: [] });
  });
  it("requires sign-in before looking up grant candidates", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(mocks.candidates).not.toHaveBeenCalled();
  });
});
