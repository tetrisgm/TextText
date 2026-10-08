import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), pool: vi.fn(), blog: vi.fn(), resolve: vi.fn(), file: vi.fn(), legacy: vi.fn(), byId: vi.fn(), viewer: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string): never => { throw new Error(`REDIRECT:${url}`); }, notFound: (): never => { throw new Error("NOT_FOUND"); }, useRouter: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock("@/lib/blog-edit-auth", () => ({ getBlogEditAccess: mocks.access }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.viewer }));
vi.mock("@/lib/store", async (original) => ({ ...await original<object>(), getBlog: mocks.blog, resolvePostSlug: mocks.resolve, resolveLegacyPublicSlug: mocks.legacy, readVaultTextpackIdentity: mocks.file, getPostById: mocks.byId, getWorkspacePoolPosts: mocks.pool }));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAuthConfigured: () => false }));
import { PostPageForHandle } from "@/app/t/[handle]/[slug]/page";
describe("legacy owner item canonicalization", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("TEXTTEXT_VAULT_ROOT", "/fixture");
    mocks.access.mockResolvedValue({ isOwner: true, canEdit: true, blogId: "workspace" });
    mocks.blog.mockResolvedValue({ handle: "owner", name: "Workspace" });
    mocks.resolve.mockResolvedValue({ kind: "exact", post: { id: "file-id", slug: "old", status: "draft", visibility: "private" } });
    mocks.legacy.mockResolvedValue({ kind: "missing" }); mocks.file.mockResolvedValue({ itemId: "file-id" });
  });
  it.each([true, false])("opens only an attested canonical item (username alias=%s)", async canonicalUsernameRoute => {
    await expect(PostPageForHandle({ handle: "owner", slug: "old", canonicalUsernameRoute })).rejects.toThrow("REDIRECT:/vault/workspace?item=file-id");
    expect(mocks.file).toHaveBeenCalledWith({ root: "/fixture", workspaceId: "workspace", itemId: "file-id" });
    expect(mocks.pool).not.toHaveBeenCalled();
  });
  it("falls back to home when the legacy item has no canonical file", async () => {
    mocks.file.mockResolvedValue(null);
    await expect(PostPageForHandle({ handle: "owner", slug: "old" })).rejects.toThrow("REDIRECT:/vault/workspace");
    expect(mocks.pool).not.toHaveBeenCalled();
  });
  it("resolves direct edit IDs only within the authenticated workspace", async () => {
    mocks.resolve.mockResolvedValue({ kind: "missing" }); mocks.byId.mockResolvedValue(null);
    await expect(PostPageForHandle({ handle: "owner", slug: "stale", searchParams: Promise.resolve({ edit: ["1"], id: ["file-id"] }) })).rejects.toThrow("REDIRECT:/vault/workspace?item=file-id");
    expect(mocks.file.mock.calls[0][0].workspaceId).toBe("workspace");
  });
  it("leaves anonymous public redirects intact without probing private files", async () => {
    mocks.access.mockResolvedValue({ isOwner: false, canEdit: false, blogId: "workspace" });
    mocks.legacy.mockResolvedValue({ kind: "redirect", folderPath: "blog", post: { slug: "published" } });
    await expect(PostPageForHandle({ handle: "owner", slug: "old" })).rejects.toThrow("REDIRECT:");
    expect(mocks.file).not.toHaveBeenCalled(); expect(mocks.pool).not.toHaveBeenCalled();
  });
  it("keeps the owner's published reader URL on the public access path", async () => {
    mocks.resolve.mockResolvedValue({ kind: "exact", post: { id: "file-id", slug: "public", status: "published", visibility: "public" } });
    mocks.viewer.mockRejectedValue(new Error("PUBLIC_READER_ACCESS"));
    await expect(PostPageForHandle({ handle: "owner", slug: "public", canonicalUsernameRoute: true })).rejects.toThrow("PUBLIC_READER_ACCESS");
    expect(mocks.file).not.toHaveBeenCalled(); expect(mocks.pool).not.toHaveBeenCalled();
  });
  it("does not redirect nonowners or missing blogs into a private workspace", async () => {
    mocks.access.mockResolvedValue({ isOwner: false, canEdit: false, blogId: "workspace" }); mocks.resolve.mockResolvedValue({ kind: "missing" });
    await expect(PostPageForHandle({ handle: "owner", slug: "absent" })).rejects.toThrow("NOT_FOUND");
    mocks.blog.mockResolvedValue(null); mocks.access.mockResolvedValue({ isOwner: true, canEdit: true, blogId: "workspace" });
    await expect(PostPageForHandle({ handle: "absent", slug: "old" })).rejects.toThrow("NOT_FOUND");
    expect(mocks.file).not.toHaveBeenCalled();
  });
});
