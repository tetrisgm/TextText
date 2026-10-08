import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: vi.fn(), session: vi.fn(), owned: vi.fn(), access: vi.fn() }));
vi.mock("@/app/api/sync/v1/auth", () => ({ resolveSyncWorkspace: mocks.token }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.session }));
vi.mock("@/lib/store", () => ({ getOwnedBlog: mocks.owned }));
vi.mock("@/lib/permissions", () => ({ resolveWorkspaceAccess: mocks.access }));
import { authorizeVault } from "./auth";

describe("vault authorization", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_URL", "https://texttext.test");
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", "/tmp/vault");
    mocks.token.mockResolvedValue({ sub: "apple-1", userId: "user-1", blog: { handle: "owner" } });
    mocks.session.mockResolvedValue({ sub: "apple-1", userId: "user-1" });
    mocks.owned.mockResolvedValue({ handle: "owner" });
    mocks.access.mockResolvedValue({ isOwner: true, blogId: "workspace-1", userId: "user-1" });
  });
  it("rejects a different workspace even for a valid token", async () => {
    const result = await authorizeVault(new Request("https://texttext.test", { headers: { Authorization: "Bearer token" } }), "workspace-2");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });
  it("never falls back to cookies for an invalid bearer token", async () => {
    mocks.token.mockResolvedValue(new Response(null, { status: 401 }));
    const result = await authorizeVault(new Request("https://texttext.test", { headers: { Authorization: "Bearer bad" } }), "workspace-1");
    expect((result as Response).status).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("accepts cookie owner writes only from the same origin", async () => {
    const denied = await authorizeVault(new Request("https://texttext.test", { method: "PUT", headers: { Origin: "https://other.test" } }), "workspace-1");
    expect((denied as Response).status).toBe(403);
    const accepted = await authorizeVault(new Request("https://texttext.test", { method: "PUT", headers: { Origin: "https://texttext.test" } }), "workspace-1");
    expect(accepted).toMatchObject({ actorType: "human", actorUserId: "user-1", workspaceId: "workspace-1" });
  });
  it("fails closed when session ownership cannot be proven", async () => {
    mocks.access.mockResolvedValue({ isOwner: false, blogId: "workspace-1", userId: "user-1" });
    expect((await authorizeVault(new Request("https://texttext.test"), "workspace-1") as Response).status).toBe(404);
  });
  it("rechecks current ownership instead of reusing request-scoped access", async () => {
    let owner = true;
    mocks.access.mockImplementation(async ({ fresh }) => ({
      isOwner: fresh ? owner : true, blogId: "workspace-1", userId: "user-1",
    }));
    const request = new Request("https://texttext.test", { method: "POST", headers: { Origin: "https://texttext.test" } });
    expect(await authorizeVault(request, "workspace-1")).toMatchObject({ actorUserId: "user-1" });
    owner = false;
    const afterWait = await authorizeVault(request, "workspace-1");
    expect(afterWait).toBeInstanceOf(Response);
    expect((afterWait as Response).status).toBe(404);
  });

});
