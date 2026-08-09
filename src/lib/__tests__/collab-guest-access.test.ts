// A workspace created through /try is owned by a token in the browser, not by
// an account. Collab did not consult that token, so the zero-setup demo showed
// "Document could not be saved" on its first screen while the item was in fact
// saving through the editor's server actions.
//
// This is a permission boundary, so the conditions are pinned rather than
// assumed: the token must own the very workspace holding the post, and it must
// be an UNCLAIMED workspace. A claimed workspace never reaches the token branch
// inside getBlogEditAccess, and a signed-in user or a capability link is
// resolved before this fallback runs at all.

import { beforeEach, describe, expect, it, vi } from "vitest";

const collabAccess = vi.fn();
const getCurrentUser = vi.fn();
const resolveDocumentCapability = vi.fn();
const getPostStoreContext = vi.fn();
const getBlogEditAccess = vi.fn();

vi.mock("@/lib/collab", () => ({
  collabAccess: (...args: unknown[]) => collabAccess(...args),
  colorForSub: () => "#112233",
}));
vi.mock("@/lib/session", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}));
vi.mock("@/lib/store", () => ({
  getPostStoreContext: (...args: unknown[]) => getPostStoreContext(...args),
  resolveDocumentCapability: (...args: unknown[]) =>
    resolveDocumentCapability(...args),
}));
vi.mock("@/lib/blog-edit-auth", () => ({
  getBlogEditAccess: (...args: unknown[]) => getBlogEditAccess(...args),
}));
vi.mock("@/lib/document-capability", () => ({
  documentCapabilityCookieName: (postId: string) => `dc_${postId}`,
}));

const POST = "11111111-2222-3333-4444-555555555555";

async function resolve(): Promise<{ role: string | null }> {
  const { getCollabRequestAccess } = await import("@/lib/collab/access.server");
  const request = new Request("https://texttext.example/api/collab/x");
  const access = await getCollabRequestAccess(request, POST);
  return { role: access.role };
}

describe("guest workspace collaboration access", () => {
  beforeEach(() => {
    vi.resetModules();
    collabAccess.mockReset().mockResolvedValue(null);
    getCurrentUser.mockReset().mockResolvedValue(null);
    resolveDocumentCapability.mockReset().mockResolvedValue(null);
    getPostStoreContext
      .mockReset()
      .mockResolvedValue({ blogId: "b1", handle: "demo", post: { id: POST } });
    getBlogEditAccess
      .mockReset()
      .mockResolvedValue({ isUnclaimed: true, isTokenEditor: true });
  });

  it("lets the token that owns an unclaimed workspace co-edit its own item", async () => {
    expect((await resolve()).role).toBe("editor");
    expect(getBlogEditAccess).toHaveBeenCalledWith("demo");
  });

  it("refuses a browser holding no edit token for that workspace", async () => {
    getBlogEditAccess.mockResolvedValue({
      isUnclaimed: true,
      isTokenEditor: false,
    });
    expect((await resolve()).role).toBeNull();
  });

  it("refuses once the workspace has been claimed by an account", async () => {
    // A claimed workspace resolves through the account path or not at all.
    getBlogEditAccess.mockResolvedValue({
      isUnclaimed: false,
      isTokenEditor: true,
    });
    expect((await resolve()).role).toBeNull();
  });

  it("refuses when the post belongs to no workspace this request can see", async () => {
    getPostStoreContext.mockResolvedValue(null);
    expect((await resolve()).role).toBeNull();
    expect(getBlogEditAccess).not.toHaveBeenCalled();
  });

  it("never widens an account or capability decision", async () => {
    // A signed-in user who was refused stays refused: the guest fallback is
    // only consulted when there is no user and no capability at all.
    getCurrentUser.mockResolvedValue({ sub: "user-1" });
    expect((await resolve()).role).toBeNull();
    expect(getBlogEditAccess).not.toHaveBeenCalled();
  });

  it("says an item was trashed rather than forbidden", async () => {
    // getPostStoreContext excludes trashed rows, so a refused caller plus a
    // missing live row is the trashed case, not the never-existed one.
    getPostStoreContext.mockResolvedValue(null);
    const { getCollabRequestAccess } = await import("@/lib/collab/access.server");
    const access = await getCollabRequestAccess(
      new Request("https://texttext.example/api/collab/x"),
      POST,
    );
    expect(access.role).toBeNull();
    expect(access.trashed).toBe(true);
  });

  it("does not call an accessible item trashed", async () => {
    const { getCollabRequestAccess } = await import("@/lib/collab/access.server");
    const access = await getCollabRequestAccess(
      new Request("https://texttext.example/api/collab/x"),
      POST,
    );
    expect(access.trashed).toBe(false);
  });

  it("leaves an existing grant alone", async () => {
    collabAccess.mockResolvedValue("viewer");
    expect((await resolve()).role).toBe("viewer");
    expect(getBlogEditAccess).not.toHaveBeenCalled();
  });
});
