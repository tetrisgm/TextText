import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), wait: vi.fn(), views: vi.fn(), visible: vi.fn(), folder: vi.fn() }));
vi.mock("@/app/api/vault/scoped-auth", () => ({ authorizeVaultWorkspaceOrScoped: mocks.auth,
  canSeeVaultFolder: mocks.folder, canSeeVaultItem: mocks.visible }));
vi.mock("@/lib/store", () => ({ listVaultTextpacks: mocks.list, waitVaultTextpacks: mocks.wait, listVaultFolderViews: mocks.views, VaultBusyError: class extends Error {} }));
import { GET } from "./route";
const context = { params: Promise.resolve({ workspaceId: "shared-workspace" }) };
const identity = { root: "/vault", workspaceId: "shared-workspace", actorUserId: "viewer", actorType: "human", fullAccess: true, grants: [] };
const manifest = { revision: "a".repeat(64), items: [] };
describe("shared workspace manifests", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue(identity); mocks.list.mockResolvedValue(manifest); mocks.wait.mockResolvedValue(manifest); mocks.views.mockResolvedValue({ files: [] });
    mocks.visible.mockReturnValue(true); mocks.folder.mockReturnValue(true); });
  it("allows a named workspace viewer to read its manifest and folder views", async () => {
    expect(await (await GET(new Request("https://texttext.test/items"), context)).json()).toEqual(manifest);
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), "shared-workspace");
    expect(await (await GET(new Request("https://texttext.test/items?folderViews=Notes"), context)).json()).toEqual({ files: [] });
  });
  it("rejects unauthorized access before loading files", async () => {
    mocks.auth.mockResolvedValue(new Response(null, { status: 404 }));
    expect((await GET(new Request("https://texttext.test/items"), context)).status).toBe(404);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("does not return a waited manifest after membership is revoked", async () => {
    mocks.auth.mockResolvedValueOnce(identity).mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await GET(new Request("https://texttext.test/items?wait=25", { headers: { "If-None-Match": `"${manifest.revision}"` } }), context)).status).toBe(404);
    expect(mocks.wait).toHaveBeenCalledOnce();
  });
  it("filters every sibling path and problem from a scoped member manifest", async () => {
    const scoped = { ...identity, fullAccess: false, grants: [{ id: "grant", role: "viewer" }] };
    mocks.auth.mockResolvedValue(scoped);
    mocks.visible.mockImplementation((_grants, itemId) => itemId === "shared");
    mocks.list.mockResolvedValue({ revision: "a".repeat(64), items: [
      { itemId: "shared", relativePath: "Reading/Shared.textpack", revision: "b".repeat(64) },
      { itemId: "secret", relativePath: "Private/Secret.textpack", revision: "c".repeat(64) },
    ], tombstones: [{ itemId: "secret", relativePath: "Private/Deleted.textpack", revision: "d".repeat(64), deleted: true }],
    problems: [{ relativePath: "Private/Broken.textpack", reason: "Invalid pack" }] });
    const response = await GET(new Request("https://texttext.test/items"), context);
    const result = await response.json();
    expect(result.items).toEqual([{ itemId: "shared", relativePath: "Reading/Shared.textpack", revision: "b".repeat(64) }]);
    expect(result.tombstones).toEqual([]); expect(result.problems).toEqual([]);
    expect(result.revision).not.toBe("a".repeat(64));
  });
});
