import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("./auth", () => ({ authorizeVault: mocks.authorize }));
import { GET } from "./route";
beforeEach(() => vi.resetAllMocks());
it("returns the resolved nonsecret account ID for native offline identity caching", async () => {
  mocks.authorize.mockResolvedValue({ workspaceId: "workspace", name: "Workspace", actorUserId: "account-a" });
  const response = await GET(new Request("https://texttext.test/api/vault"));
  expect(await response.json()).toEqual({ workspaceId: "workspace", name: "Workspace", accountId: "account-a" });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("passes through an authorization failure without disclosing an account", async () => {
  const denied = new Response(null, { status: 401 }); mocks.authorize.mockResolvedValue(denied);
  expect(await GET(new Request("https://texttext.test/api/vault"))).toBe(denied);
});
