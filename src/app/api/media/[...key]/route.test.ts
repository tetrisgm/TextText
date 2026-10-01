import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), post: vi.fn(), visual: vi.fn(), itemAccess: vi.fn(), workspaceAccess: vi.fn(), read: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/store", () => ({ getPostById: mocks.post, getVisualUploadItemId: mocks.visual }));
vi.mock("@/lib/permissions", () => ({ isUuid: (id: string) => /^[a-f0-9-]{36}$/.test(id), resolveItemAccess: mocks.itemAccess, resolveWorkspaceAccess: mocks.workspaceAccess }));
vi.mock("@/app/api/sync/v1/auth", () => ({ resolveSyncWorkspace: mocks.sync }));
vi.mock("@/lib/media-storage", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/media-storage")>(), isMediaStorageConfigured: () => true, readMedia: mocks.read }));
import { GET } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
function request(key = `documents/demo/${id}/assets/photo.png`, headers = {}) { return GET(new Request(`https://texttext.example/api/media/${key}`, { headers }), { params: Promise.resolve({ key: key.split("/") }) }); }
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue(null); mocks.post.mockResolvedValue({ id, visibility: "private", status: "draft", type: "article" }); mocks.itemAccess.mockResolvedValue({ canView: false }); mocks.workspaceAccess.mockResolvedValue({ canEditContent: false }); mocks.read.mockImplementation(async () => new Response("media")); });
describe("media ACL delivery", () => {
  it("denies private and absent items before accessing R2", async () => {
    expect((await request()).status).toBe(404); mocks.post.mockResolvedValue(null); expect((await request()).status).toBe(404); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("allows current item access, forwards ranges and honors revocation", async () => {
    mocks.user.mockResolvedValue({ id: "viewer" }); mocks.itemAccess.mockResolvedValue({ canView: true });
    expect((await request(undefined, { range: "bytes=0-3" })).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(`documents/demo/${id}/assets/photo.png`, "bytes=0-3");
    mocks.itemAccess.mockResolvedValue({ canView: false }); expect((await request()).status).toBe(404);
  });
  it("permits anonymous reads only for published public item types", async () => {
    mocks.post.mockResolvedValue({ visibility: "public", status: "published", type: "article" }); expect((await request()).status).toBe(200);
    mocks.post.mockResolvedValue({ visibility: "public", status: "published", type: "note" }); expect((await request()).status).toBe(404);
  });
  it("resolves visual uploads by indexed claim and restricts unbound staging", async () => {
    mocks.visual.mockResolvedValue(id); mocks.itemAccess.mockResolvedValue({ canView: true });
    expect((await request(`documents/demo/visual/${id}/photo.png`)).status).toBe(200); expect(mocks.visual).toHaveBeenCalledWith("demo", id);
    expect((await request("editor/media/demo/date/photo.png")).status).toBe(404);
    mocks.user.mockResolvedValue({ id: "editor" }); mocks.workspaceAccess.mockResolvedValue({ canEditContent: true }); expect((await request("editor/media/demo/date/photo.png")).status).toBe(200);
  });
  it("rejects foreign bearer workspace and encoded path separators", async () => {
    mocks.sync.mockResolvedValue({ blog: { handle: "other" } }); expect((await request(undefined, { authorization: "Bearer test" })).status).toBe(404);
    expect((await GET(new Request("https://texttext.example/api/media/x"), { params: Promise.resolve({ key: ["documents", "demo", "a/b"] }) })).status).toBe(404); expect(mocks.read).not.toHaveBeenCalled();
  });
});
