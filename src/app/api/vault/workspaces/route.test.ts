import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), token: vi.fn(), owner: vi.fn(), identity: vi.fn(), access: vi.fn(), candidates: vi.fn(), grants: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentUser: m.session }));
vi.mock("@/lib/api-tokens", () => ({ resolveApiToken: m.token }));
vi.mock("@/lib/store", () => ({ getOwnedBlog: m.owner, getVaultWorkspaceIdentity: m.identity }));
vi.mock("@/lib/permissions", async original => ({ ...await original(), resolveWorkspaceAccess: m.access }));
vi.mock("@/lib/vault/grants", async original => ({ ...await original(), activeVaultGrants: m.grants, candidateVaultSharedWorkspaces: m.candidates }));
import { GET } from "./route";
const own = "11111111-1111-4111-8111-111111111111", shared = "22222222-2222-4222-8222-222222222222", uid = "33333333-3333-4333-8333-333333333333";
const request = (bearer = false) => new Request("https://texttext.test/api/vault/workspaces", { headers: bearer ? { authorization: "Bearer fixture" } : {} });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("TEXTTEXT_VAULT_ROOT", "/fixture");
  m.session.mockResolvedValue({ sub: "account", userId: uid });
  m.token.mockResolvedValue({ sub: "account", userId: uid, kind: "app", scopes: "sync" });
  m.owner.mockResolvedValue({ handle: "own" });
  m.identity.mockImplementation(async id => ({ id, handle: id === own ? "own" : "shared", name: id === own ? "Mine" : "Shared" }));
  m.access.mockImplementation(async ({ handle }) => ({ userId: uid, blogId: handle === "own" ? own : shared, isOwner: handle === "own", canView: false }));
  m.candidates.mockResolvedValue([shared, own]);
  m.grants.mockResolvedValue([{ scope: { type: "item", key: "secret-file-id" }, role: "viewer" }]);
});
afterEach(() => vi.unstubAllEnvs());
it.each([false, true])("returns only authorized summaries for browser/native=%s", async bearer => {
  const response = await GET(request(bearer));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ defaultWorkspaceId: own, workspaces: [{ id: own, name: "Mine", access: "owner" }, { id: shared, name: "Shared", access: "scoped" }] });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(m.access.mock.calls.every(([args]) => args.fresh === true)).toBe(true);
});
it.each([{kind:"manual",scopes:"sync"},{kind:"oauth",scopes:"sync"},{kind:"app",scopes:"item:one:read sync"},{kind:"app",scopes:"read"}])("rejects non-account bearer %j", async token => {
  m.token.mockResolvedValue({sub:"account",userId:uid,...token});
  expect((await GET(request(true))).status).toBe(403);expect(m.candidates).not.toHaveBeenCalled();expect(m.session).not.toHaveBeenCalled();
});
it("does not fall back to signed-in cookies for an invalid bearer", async()=>{m.token.mockResolvedValue(null);expect((await GET(request(true))).status).toBe(401);expect(m.session).not.toHaveBeenCalled();});
it("omits an invitation revoked during candidate lookup", async()=>{m.candidates.mockImplementation(async()=>{m.grants.mockResolvedValue([]);return[shared]});expect(await(await GET(request())).json()).toEqual({defaultWorkspaceId:own,workspaces:[{id:own,name:"Mine",access:"owner"}]});});
it("fails closed if native credentials are revoked during discovery",async()=>{m.candidates.mockImplementation(async()=>{m.token.mockResolvedValue(null);return[shared]});expect((await GET(request(true))).status).toBe(401);});
it("does not expose earlier results after account identity changes",async()=>{m.access.mockResolvedValueOnce({userId:uid,blogId:own,isOwner:true}).mockResolvedValue({userId:"other",blogId:own,isOwner:true});expect((await GET(request())).status).toBe(401);});
