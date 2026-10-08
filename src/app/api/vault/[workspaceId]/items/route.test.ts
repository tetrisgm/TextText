import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), wait: vi.fn(), views: vi.fn(), kept: vi.fn(), reads: vi.fn(), visible: vi.fn(), folder: vi.fn() }));
vi.mock("@/app/api/vault/scoped-auth", () => ({ authorizeVaultWorkspaceOrScoped: mocks.auth,
  canSeeVaultFolder: mocks.folder, canSeeVaultItem: mocks.visible }));
vi.mock("@/lib/store", () => ({ listVaultTextpacks: mocks.list, waitVaultTextpacks: mocks.wait, listVaultFolderViews: mocks.views, listVaultKeptFeedEntries: mocks.kept, listVaultReadFeedEntries: mocks.reads, VaultBusyError: class extends Error {} }));
import { GET } from "./route";
const context = { params: Promise.resolve({ workspaceId: "shared-workspace" }) };
const identity = { root: "/vault", workspaceId: "shared-workspace", actorUserId: "viewer", actorType: "human", fullAccess: true, grants: [], canEditContent: false };
const manifest = { revision: "a".repeat(64), items: [], tombstones: [], folders: [], problems: [] };
describe("shared workspace manifests", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue(identity); mocks.list.mockResolvedValue(manifest); mocks.wait.mockResolvedValue(manifest); mocks.views.mockResolvedValue({ files: [] }); mocks.kept.mockResolvedValue([]); mocks.reads.mockResolvedValue([]);
    mocks.visible.mockReturnValue(true); mocks.folder.mockReturnValue(true); });
  it("allows a named workspace viewer to read its manifest and folder views", async () => {
    expect(await (await GET(new Request("https://texttext.test/items"), context)).json()).toMatchObject({items:[], fullAccess:true,canCreateContent:false,writableFolders:[]});
    expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), "shared-workspace");
    expect(await (await GET(new Request("https://texttext.test/items?folderViews=Notes"), context)).json()).toEqual({ files: [] });
  });
  it("rejects unauthorized access before loading files", async () => {
    mocks.auth.mockResolvedValue(new Response(null, { status: 404 }));
    expect((await GET(new Request("https://texttext.test/items"), context)).status).toBe(404);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("invalidates capabilities on role downgrade without waiting for a file edit", async () => {
    mocks.auth.mockResolvedValue({ ...identity, canEditContent: true });
    mocks.list.mockResolvedValue({ ...manifest, items: [{ itemId: "one", relativePath: "Notes/One.textpack" }] });
    const first = await GET(new Request("https://texttext.test/items"), context);
    expect((await first.json()).items[0].canEditContent).toBe(true);
    mocks.auth.mockResolvedValue(identity);
    const downgraded = await GET(new Request("https://texttext.test/items?wait=25", { headers: { "If-None-Match": first.headers.get("ETag")! } }), context);
    expect(downgraded.status).toBe(200);
    expect(await downgraded.json()).toMatchObject({fullAccess:true,canCreateContent:false,items:[{canEditContent:false}]});
    expect(downgraded.headers.get("ETag")).not.toBe(first.headers.get("ETag"));
    expect(mocks.wait).not.toHaveBeenCalled();
  });
  it("waits on the raw filesystem revision when the permission-aware ETag matches", async () => {
    const first = await GET(new Request("https://texttext.test/items"), context);
    const next = await GET(new Request("https://texttext.test/items?wait=25", {headers:{"If-None-Match":first.headers.get("ETag")!}}), context);
    expect(next.status).toBe(304);
    expect(mocks.wait).toHaveBeenCalledWith(expect.objectContaining({revision:manifest.revision,waitMs:25_000}));
  });
  it("describes partial writable scopes without granting creation outside them", async () => {
    mocks.auth.mockResolvedValue({...identity,fullAccess:false,grants:[
      {id:"folder",scope:{type:"folder",key:"Shared"},role:"editor"},
      {id:"item",scope:{type:"item",key:"read-only"},role:"viewer"},
    ]});
    mocks.list.mockResolvedValue({...manifest,items:[{itemId:"editable",relativePath:"Shared/One.textpack"},
      {itemId:"read-only",relativePath:"Private/One.textpack"}],tombstones:[{itemId:"gone",relativePath:"Shared/Gone.textpack"}]});
    const result=await(await GET(new Request("https://texttext.test/items"),context)).json();
    expect(result).toMatchObject({fullAccess:false,canCreateContent:false,writableFolders:["Shared"]});
    expect(result.items.map((item:{canEditContent:boolean})=>item.canEditContent)).toEqual([true,false]);
    expect(result.tombstones[0].canEditContent).toBe(true);
  });
  it("does not return a waited manifest after membership is revoked", async () => {
    const first = await GET(new Request("https://texttext.test/items"), context);
    mocks.auth.mockResolvedValueOnce(identity).mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await GET(new Request("https://texttext.test/items?wait=25", { headers: { "If-None-Match": first.headers.get("ETag")! } }), context)).status).toBe(404);
    expect(mocks.wait).toHaveBeenCalledOnce();
  });
  it("filters every sibling path and problem from a scoped member manifest", async () => {
    const scoped = { ...identity, fullAccess: false, grants: [{ id: "grant", scope: {type:"item",key:"shared"}, role: "viewer" }] };
    mocks.auth.mockResolvedValue(scoped);
    mocks.visible.mockImplementation((_grants, itemId) => itemId === "shared");
    mocks.list.mockResolvedValue({ revision: "a".repeat(64), items: [
      { itemId: "shared", relativePath: "Reading/Shared.textpack", revision: "b".repeat(64) },
      { itemId: "secret", relativePath: "Private/Secret.textpack", revision: "c".repeat(64) },
    ], tombstones: [{ itemId: "secret", relativePath: "Private/Deleted.textpack", revision: "d".repeat(64), deleted: true }],
    problems: [{ relativePath: "Private/Broken.textpack", reason: "Invalid pack" }] });
    const response = await GET(new Request("https://texttext.test/items"), context);
    const result = await response.json();
    expect(result.items).toEqual([{ itemId: "shared", relativePath: "Reading/Shared.textpack", revision: "b".repeat(64), canEditContent:false }]);
    expect(result.tombstones).toEqual([]); expect(result.problems).toEqual([]);
    expect(result.revision).not.toBe("a".repeat(64));
  });
  it("returns only granted empty folders and changes scoped etags when folders change", async () => {
    mocks.auth.mockResolvedValue({ ...identity, fullAccess: false, grants: [{ id: "grant", scope: {type:"item",key:"shared"}, role: "viewer" }] });
    mocks.folder.mockImplementation((_grants, folder) => folder.startsWith("Shared"));
    mocks.list.mockResolvedValue({ ...manifest, items: [], tombstones: [], folders: ["Shared", "Private"] });
    const first = await (await GET(new Request("https://texttext.test/items"), context)).json();
    expect(first.folders).toEqual(["Shared"]);
    mocks.list.mockResolvedValue({ ...manifest, items: [], tombstones: [], folders: ["Shared", "Shared/Empty", "Private"] });
    const next = await (await GET(new Request("https://texttext.test/items"), context)).json();
    expect(next.folders).toEqual(["Shared", "Shared/Empty"]);
    expect(next.revision).not.toBe(first.revision);
  });
  it("scans only authorized saved stories and rechecks access before returning them", async () => {
    const scoped = { ...identity, fullAccess: false, grants: [{ id: "grant", scope: {type:"item",key:"shared"}, role: "viewer" }] };
    mocks.auth.mockResolvedValue(scoped);
    mocks.visible.mockImplementation((_grants, itemId) => itemId === "shared");
    mocks.list.mockResolvedValue({ ...manifest, items: [
      { itemId: "shared", relativePath: "Bookmarks/Shared.textpack" },
      { itemId: "secret", relativePath: "Bookmarks/Secret.textpack" },
    ] });
    mocks.kept.mockResolvedValue([{ itemId: "shared", hash: "b".repeat(64), path: "Bookmarks/Shared.textpack", title: "Shared", source: "News", keptAt: "2026-10-02T10:00:00Z" }]);
    const result = await (await GET(new Request("https://texttext.test/items?keptFeedEntries=1"), context)).json();
    expect(mocks.kept.mock.calls[0][0].items).toEqual([{ itemId: "shared", relativePath: "Bookmarks/Shared.textpack" }]);
    expect(result).toEqual({ hashes: ["b".repeat(64)], entries: [{ hash: "b".repeat(64), path: "Bookmarks/Shared.textpack", title: "Shared", source: "News", keptAt: "2026-10-02T10:00:00Z" }] });
    mocks.auth.mockResolvedValueOnce(scoped).mockResolvedValueOnce({ ...scoped, grants: [] });
    mocks.visible.mockReturnValueOnce(true).mockReturnValue(false);
    expect(await (await GET(new Request("https://texttext.test/items?keptFeedEntries=1"), context)).json()).toEqual({ hashes: [], entries: [] });
  });
  it("returns only currently authorized unsaved reading records", async () => {
    mocks.list.mockResolvedValue({ ...manifest, items: [{ itemId: "read", relativePath: "Feeds/History/Story.textpack" }] });
    mocks.reads.mockResolvedValue([{ itemId: "read", hash: "c".repeat(64), path: "Feeds/History/Story.textpack", revision: "d".repeat(64), title: "Story", source: "News", readAt: "2026-10-02T11:00:00Z" }]);
    const result = await (await GET(new Request("https://texttext.test/items?readFeedEntries=1"), context)).json();
    expect(result.entries).toEqual([{ hash: "c".repeat(64), path: "Feeds/History/Story.textpack", revision: "d".repeat(64), title: "Story", source: "News", readAt: "2026-10-02T11:00:00Z" }]);
    mocks.list.mockResolvedValueOnce({ ...manifest, items: [{ itemId: "read", relativePath: "Feeds/History/Story.textpack" }] })
      .mockResolvedValueOnce({ ...manifest, items: [{ itemId: "read", relativePath: "Private/Story.textpack" }] });
    expect(await (await GET(new Request("https://texttext.test/items?readFeedEntries=1"), context)).json()).toEqual({ hashes: [], entries: [] });
  });
});
