import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), token: vi.fn(), workspace: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.session }));
vi.mock("@/lib/api-tokens", () => ({ resolveApiToken: mocks.token }));
vi.mock("@/lib/store", () => ({ getVaultWorkspaceIdentity: mocks.workspace }));
vi.mock("@/lib/permissions", () => ({
  isUuid: (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  resolveWorkspaceAccess: mocks.access,
}));
import { authorizeVaultCollaboration } from "./collaboration-auth";
const workspaceId = "c943e0da-4016-4cf2-8187-40a00cbe9340";
const access = { blogId: workspaceId, userId: "member", isOwner: false, canView: true, canEditContent: true, canComment: true };
const request = (method = "GET", headers: Record<string, string> = {}) => new Request(`https://texttext.app/api/vault/${workspaceId}/collaboration`, { method, headers });
const status = (result: unknown) => result instanceof Response ? result.status : 200;

describe("named file workspace collaboration authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", "/trusted/vault");
    mocks.session.mockResolvedValue({ sub: "member-sub", userId: "member" });
    mocks.workspace.mockResolvedValue({ id: workspaceId, handle: "someone-elses-space", name: "Shared workspace", ownerId: "owner" });
    mocks.access.mockResolvedValue(access);
  });
  afterEach(() => vi.unstubAllEnvs());
  it("allows a non-owner editor in the requested named workspace", async () => {
    const result = await authorizeVaultCollaboration(request("POST", { origin: "https://texttext.app" }), workspaceId, "edit");
    expect(result).toEqual({ root: "/trusted/vault", workspaceId, name: "Shared workspace", actorUserId: "member", actorType: "human", canEditContent: true, canComment: true });
    expect(mocks.workspace).toHaveBeenCalledWith(workspaceId);
    expect(mocks.access).toHaveBeenCalledWith({ handle: "someone-elses-space", user: { sub: "member-sub", userId: "member" }, fresh: true,
      workspaceSnapshot: { id: workspaceId, ownerId: "owner" } });
  });
  it.each([false, true])("permits reads but denies edits for non-editor with comment permission %s", async (canComment) => {
    mocks.access.mockResolvedValue({ ...access, canEditContent: false, canComment });
    expect(status(await authorizeVaultCollaboration(request(), workspaceId, "read"))).toBe(200);
    expect(status(await authorizeVaultCollaboration(request("POST", { origin: "https://texttext.app" }), workspaceId, "edit"))).toBe(403);
  });
  it("fails closed for mismatched workspace, missing identity and revoked permission", async () => {
    for (const denied of [{ ...access, blogId: "other" }, { ...access, userId: null }, { ...access, canView: false }]) {
      mocks.access.mockResolvedValue(denied);
      expect(status(await authorizeVaultCollaboration(request(), workspaceId, "read"))).toBe(404);
    }
    expect(status(await authorizeVaultCollaboration(request(), "../outside", "read"))).toBe(404);
  });
  it("reauthorizes a previously allowed user after revocation", async () => {
    expect(status(await authorizeVaultCollaboration(request(), workspaceId, "edit"))).toBe(200);
    mocks.access.mockResolvedValue({ ...access, canView: false, canEditContent: false });
    expect(status(await authorizeVaultCollaboration(request(), workspaceId, "edit"))).toBe(404);
    expect(mocks.access).toHaveBeenCalledTimes(2);
  });
  it("does not fall back to cookies when a bearer token is invalid", async () => {
    mocks.token.mockResolvedValue(null);
    expect(status(await authorizeVaultCollaboration(request("GET", { authorization: "Bearer invalid" }), workspaceId, "read"))).toBe(401);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it.each(["", "read", `sync item:${workspaceId}:edit`])("rejects insufficient or item-specific token scope %s", async (scopes) => {
    mocks.token.mockResolvedValue({ sub: "member-sub", userId: "member", scopes });
    expect(status(await authorizeVaultCollaboration(request("GET", { authorization: "Bearer token" }), workspaceId, "read"))).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("accepts a valid sync bearer and still checks its named workspace role", async () => {
    mocks.token.mockResolvedValue({ sub: "member-sub", userId: "member", scopes: "sync" });
    const result = await authorizeVaultCollaboration(request("POST", { authorization: "Bearer token" }), workspaceId, "edit");
    expect(result).toMatchObject({ actorType: "external_agent", workspaceId });
    expect(mocks.access).toHaveBeenCalledTimes(1);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([undefined, "https://attacker.test"])("requires same-origin cookie mutations (%s)", async (origin) => {
    expect(status(await authorizeVaultCollaboration(request("POST", origin ? { origin } : {}), workspaceId, "edit"))).toBe(403);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
  it("fails closed when storage is absent", async () => {
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", "");
    expect(status(await authorizeVaultCollaboration(request(), workspaceId, "read"))).toBe(503);
  });
  it("permits the owner even when ordinary role flags are unset", async () => {
    mocks.access.mockResolvedValue({ ...access, isOwner: true, canView: false, canEditContent: false, canComment: false });
    expect(await authorizeVaultCollaboration(request(), workspaceId, "edit")).toMatchObject({ canEditContent: true, canComment: true });
  });
});
