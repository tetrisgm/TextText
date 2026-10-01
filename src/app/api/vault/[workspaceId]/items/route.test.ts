import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), wait: vi.fn(), views: vi.fn() }));
vi.mock("@/app/api/vault/collaboration-auth", () => ({ authorizeVaultCollaboration: mocks.auth }));
vi.mock("@/lib/store", () => ({ listVaultTextpacks: mocks.list, waitVaultTextpacks: mocks.wait, listVaultFolderViews: mocks.views, VaultBusyError: class extends Error {} }));
import { GET } from "./route";
const context = { params: Promise.resolve({ workspaceId: "shared-workspace" }) };
const identity = { root: "/vault", workspaceId: "shared-workspace", actorUserId: "viewer", actorType: "human" };
const manifest = { revision: "a".repeat(64), items: [] };
describe("shared workspace manifests", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue(identity); mocks.list.mockResolvedValue(manifest); mocks.wait.mockResolvedValue(manifest); mocks.views.mockResolvedValue({ files: [] }); });
  it("allows a named workspace viewer to read its manifest and folder views", async () => {
    expect(await (await GET(new Request("https://texttext.test/items"), context)).json()).toEqual(manifest);
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), "shared-workspace", "read");
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
});
