import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), profile: vi.fn() }));
vi.mock("@/app/api/vault/auth", () => ({ authorizeVault: mocks.authorize }));
vi.mock("@/lib/store", () => ({ getVaultAccountProfile: mocks.profile }));
import { GET } from "./route";
const context = { params: Promise.resolve({ workspaceId: "workspace" }) };
const request = new Request("https://texttext.test/api/vault/workspace/account?userId=other");
beforeEach(() => { vi.resetAllMocks(); mocks.authorize.mockResolvedValue({ actorUserId: "owner", name: "My workspace" }); });
it.each([401,403,404])("denies %s without reading a profile", async status => {
  mocks.authorize.mockResolvedValue(new Response(null,{status}));
  expect((await GET(request, context)).status).toBe(status); expect(mocks.profile).not.toHaveBeenCalled();
});
it("uses only the authorized actor and returns an explicit private profile projection", async () => {
  mocks.profile.mockResolvedValue({ email: "owner@example.test", name: "Owner", identities: ["apple"], token: "not-exposed", sub: "not-exposed" });
  const response = await GET(request, context);
  expect(mocks.authorize).toHaveBeenCalledWith(request,"workspace"); expect(mocks.profile).toHaveBeenCalledWith("owner");
  expect(await response.json()).toEqual({ email:"owner@example.test",name:"Owner",identities:["apple"],workspaceName:"My workspace" });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("preserves missing identity fields and fails closed for a removed account", async () => {
  mocks.profile.mockResolvedValueOnce({email:null,name:null,identities:[]}).mockResolvedValueOnce(null);
  expect(await (await GET(request,context)).json()).toEqual({email:null,name:null,identities:[],workspaceName:"My workspace"});
  expect((await GET(request,context)).status).toBe(404);
});
