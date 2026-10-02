import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), search: vi.fn(), visible: vi.fn() }));
vi.mock("@/app/api/vault/scoped-auth", () => ({ authorizeVaultWorkspaceOrScoped: mocks.auth, canSeeVaultItem: mocks.visible }));
vi.mock("@/lib/store", () => ({ listVaultTextpacks: mocks.list, searchVaultTextpacks: mocks.search, VaultBusyError: class extends Error {} }));
import { GET } from "./route";

const context = { params: Promise.resolve({ workspaceId: "workspace-1" }) };
const request = (query = "deep", folder = "Bookmarks") => new Request(`https://texttext.test/api/vault/workspace-1/search?q=${query}&folder=${folder}`);
const identity = { root: "/vault", workspaceId: "workspace-1", fullAccess: false, grants: [{ id: "grant" }] };
const items = [
  { itemId: "shared", relativePath: "Bookmarks/Shared.textpack" },
  { itemId: "secret", relativePath: "Bookmarks/Secret.textpack" },
  { itemId: "note", relativePath: "Notes/Elsewhere.textpack" },
];

describe("vault content search", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue(identity);
    mocks.list.mockResolvedValue({ items });
    mocks.visible.mockImplementation((_grants, itemId) => itemId === "shared");
    mocks.search.mockResolvedValue({ items: [{ path: "Bookmarks/Shared.textpack", title: "Shared", snippet: "Deep text" }], truncated: false, skippedCount: 0 });
  });
  it("limits the scan to visible items in the requested folder", async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.search.mock.calls[0][1]).toEqual([items[0]]);
    expect((await response.json()).items).toHaveLength(1);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("rechecks grants before returning matches", async () => {
    mocks.visible.mockReturnValueOnce(true).mockReturnValueOnce(false).mockReturnValue(false);
    expect((await (await GET(request(), context)).json()).items).toEqual([]);
    mocks.auth.mockResolvedValueOnce(identity).mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await GET(request(), context)).status).toBe(404);
  });
  it("rejects unauthorized and invalid searches without scanning", async () => {
    mocks.auth.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect((await GET(request(), context)).status).toBe(401);
    expect((await GET(request(""), context)).status).toBe(400);
    expect(mocks.search).not.toHaveBeenCalled();
  });
});
