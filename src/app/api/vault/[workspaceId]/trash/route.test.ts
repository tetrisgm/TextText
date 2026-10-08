import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), list: vi.fn(), restore: vi.fn() }));
vi.mock("@/app/api/vault/auth", () => ({ authorizeVault: mocks.authorize }));
vi.mock("@/lib/store", () => ({ listVaultTrash: mocks.list, restoreVaultTextpack: mocks.restore }));
import { GET, POST } from "./route";
const context = { params: Promise.resolve({ workspaceId: "workspace" }) };
const body = { itemId: "item", operationId: "op", basePath: "Notes/A.textpack", relativePath: "Notes/A.textpack", baseRevision: "a".repeat(64) };
const request = (value: unknown = body) => new Request("https://texttext.test/api/vault/workspace/trash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
beforeEach(() => { vi.resetAllMocks(); mocks.authorize.mockResolvedValue({ actorUserId: "owner", root: "/vault", workspaceId: "workspace", actorType: "human" }); });
it.each([401,403,404])("denies %s without reading or restoring", async status => {
 mocks.authorize.mockResolvedValue(new Response(null,{status}));
 expect((await GET(new Request("https://texttext.test"),context)).status).toBe(status);
 expect((await POST(request(),context)).status).toBe(status);
 expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.restore).not.toHaveBeenCalled();
});
it("rejects extra actor fields and malformed bodies",async()=>{
 for(const value of [null, [], {...body,actorUserId:"other"}, {...body,baseRevision:5}]) expect((await POST(request(value),context)).status).toBe(400);
 expect(mocks.restore).not.toHaveBeenCalled();
});
it("preserves retry identity and freshly checks authorization at commit",async()=>{
 mocks.restore.mockImplementation(async input=>{await input.beforeCommit(input.relativePath);return {status:"restored",itemId:input.itemId,relativePath:input.relativePath,revision:"b".repeat(64)};});
 expect((await POST(request(),context)).status).toBe(200);expect((await POST(request(),context)).status).toBe(200);
 for(const [call] of mocks.restore.mock.calls) expect(call).toMatchObject({...body,actorUserId:"owner",actorType:"human"});
 mocks.authorize.mockResolvedValueOnce({actorUserId:"owner"}).mockResolvedValueOnce(new Response(null,{status:403}));
 expect((await POST(request(),context)).status).toBe(403);
});
it("rechecks authority before returning deleted filenames",async()=>{
 mocks.list.mockResolvedValue({items:[{relativePath:"private.textpack"}]});
 mocks.authorize.mockResolvedValueOnce({actorUserId:"owner"}).mockResolvedValueOnce(new Response(null,{status:403}));
 const result=await GET(new Request("https://texttext.test"),context);
 expect(result.status).toBe(403);expect(result.headers.get("Cache-Control")).toBe("no-store");expect(await result.text()).not.toContain("private.textpack");
});
it("returns a conflict for stale deletion or occupied path",async()=>{
 mocks.restore.mockRejectedValue(new Error("The deleted file changed. Refresh Trash before restoring it."));
 expect((await POST(request(),context)).status).toBe(409);
});
