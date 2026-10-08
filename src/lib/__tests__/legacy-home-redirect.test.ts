import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), pool: vi.fn(), blog: vi.fn(), viewer: vi.fn(), redirect: vi.fn((url: string): never => { throw new Error(`REDIRECT:${url}`); }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock("@/lib/blog-edit-auth", () => ({ getBlogEditAccess: mocks.access }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.viewer }));
vi.mock("@/lib/store", async (original) => ({ ...await original<object>(), getBlog: mocks.blog, getBlogEditRecord: async () => ({ id: "workspace", ownerId: "owner" }), getWorkspacePoolPosts: mocks.pool, getFolderCollectionLayout: async () => null }));
vi.mock("@/lib/permissions", () => ({ resolveWorkspaceAccess: async () => null, resolveFolderAccess: async () => null }));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAuthConfigured: () => false }));
import { BlogHomeForHandle } from "@/app/t/[handle]/page";
describe("legacy owner home canonicalization", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.blog.mockResolvedValue({ handle: "ramine", username: "ramine", name: "Workspace" }); mocks.viewer.mockResolvedValue({ userId: "owner", sub: "owner" }); mocks.access.mockResolvedValue({ isOwner: true, canEdit: true, blogId: "workspace" }); });
  it.each([true, false])("redirects handle and username entry before loading the SQL pool (claimed=%s)", async (redirectClaimed) => {
    await expect(BlogHomeForHandle({ handle: "ramine", redirectClaimed, searchParams: Promise.resolve({ folder: "notes", layout: "grid", q: "old-search" }) })).rejects.toThrow("REDIRECT:/vault/workspace");
    expect(mocks.pool).not.toHaveBeenCalled();
  });
  it("requires authoritative ownership and does not trust the embedded viewer id", async () => {
    mocks.access.mockRejectedValue(new Error("identity unavailable"));
    await expect(BlogHomeForHandle({ handle: "ramine" })).rejects.toThrow("identity unavailable");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.pool).not.toHaveBeenCalled();
  });
  it("does not redirect a nonowner to the private vault", async () => {
    mocks.access.mockResolvedValue({ isOwner: false, canEdit: false, blogId: "workspace" });
    mocks.viewer.mockResolvedValue(null);
    await expect(BlogHomeForHandle({ handle: "ramine" })).rejects.toThrow("REDIRECT:");
    expect(mocks.redirect.mock.calls[0][0]).not.toContain("/vault/");
  });
  it("keeps unknown workspaces not found", async () => {
    mocks.blog.mockResolvedValue(null);
    await expect(BlogHomeForHandle({ handle: "absent" })).rejects.toThrow("NOT_FOUND");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
