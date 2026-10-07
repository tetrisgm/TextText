import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodePresenceAwareness, encodePresenceAwareness } from "@/lib/collab/presence-awareness";
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), authorizeAtPath: vi.fn(), readPresence: vi.fn(), readCollaboration: vi.fn(),
  join: vi.fn(), update: vi.fn(), leave: vi.fn(),
}));
vi.mock("@/app/api/vault/scoped-auth", () => ({ authorizeVaultItem: mocks.authorize, authorizeVaultItemAtPath: mocks.authorizeAtPath }));
vi.mock("@/lib/collab", () => ({ colorForSub: () => "#3c7de0" }));
vi.mock("@/lib/store", () => ({
  readVaultPresence: mocks.readPresence, readVaultCollaboration: mocks.readCollaboration,
  joinVaultPresence: mocks.join, updateVaultPresence: mocks.update, leaveVaultPresence: mocks.leave,
  VaultBusyError: class extends Error {},
  VaultCollaborationEpochError: class extends Error { constructor(readonly epoch: number) { super("File changed"); } },
  VaultPresenceSessionError: class extends Error {},
}));
import { GET, POST } from "./route";
import { VaultCollaborationEpochError } from "@/lib/store";

const url = "https://texttext.test/api/vault/workspace-1/items/item-1/presence";
const context = { params: Promise.resolve({ workspaceId: "workspace-1", itemId: "item-1" }) };
const access = { root: "/trusted", workspaceId: "workspace-1", itemId: "item-1", actorUserId: "user-1", actorType: "human",
  actorName: "Ava", canUseHumanPresence: true, canEditContent: true, canComment: true };
const state = { epoch: 2, seq: 0, revision: "a".repeat(64), update: "AAA=", relativePath: "Notes/Shared.textpack" };
const post = (value: unknown) => new Request(url, { method: "POST", headers: { origin: "https://texttext.test" }, body: JSON.stringify(value) });

describe("file vault human presence route", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "test-only-vault-presence-key");
    mocks.authorize.mockResolvedValue(access); mocks.authorizeAtPath.mockResolvedValue(access);
    mocks.readPresence.mockResolvedValue({ epoch: 2, presence: [] });
    mocks.readCollaboration.mockResolvedValue(state);
    mocks.join.mockImplementation(async input => { await input.beforeCommit("Notes/Shared.textpack"); return { epoch: 2, presence: [{ clientId: input.clientId }] }; });
    mocks.update.mockImplementation(async input => { await input.beforeCommit("Notes/Shared.textpack"); return { epoch: 2, presence: [{ clientId: input.clientId, awareness: input.awareness }] }; });
    mocks.leave.mockImplementation(async input => { await input.beforeCommit("Notes/Shared.textpack"); return { epoch: 2, presence: [] }; });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("advertises native agent support before clients announce a participant", async () => {
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ capabilities: { nativeAgentPresence: true } });
    expect(mocks.join).not.toHaveBeenCalled();
  });

  async function join() {
    const response = await POST(post({ join: true, awarenessClientId: 42 }), context);
    expect(response.status).toBe(200);
    return (await response.json()).session as { clientId: string; sessionCredential: string };
  }

  it("requires named human item access and rechecks before disclosure", async () => {
    mocks.authorize.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await GET(new Request(url), context)).status).toBe(404);
    expect(mocks.readPresence).not.toHaveBeenCalled();
    mocks.authorize.mockResolvedValueOnce(access).mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await GET(new Request(url), context)).status).toBe(403);
    mocks.authorize.mockResolvedValueOnce({ ...access, actorType: "external_agent", canUseHumanPresence: false });
    expect((await POST(post({ join: true, awarenessClientId: 42 }), context)).status).toBe(403);
    expect(mocks.join).not.toHaveBeenCalled();
  });

  it("registers a server-issued session and checks fresh scoped grants against the current path", async () => {
    const session = await join();
    expect(session.clientId).toMatch(/^p-/);
    expect(mocks.join).toHaveBeenCalledWith(expect.objectContaining({
      root: "/trusted", itemId: "item-1", principal: "account:user-1", epoch: 2,
      awarenessClientId: 42, userName: "Ava", color: "#3c7de0", role: "editor",
    }));
    expect(mocks.authorizeAtPath).toHaveBeenCalledWith(expect.any(Request), "workspace-1", "item-1", "Notes/Shared.textpack", "read");
    expect((await POST(post({ clientId: "p-forged", sessionCredential: session.sessionCredential }), context)).status).toBe(409);
  });

  it("admits the verified Mac app token as a human presence session", async () => {
    mocks.authorize.mockResolvedValue({ ...access, actorType: "external_agent", canUseHumanPresence: true });
    mocks.authorizeAtPath.mockResolvedValue({ ...access, actorType: "external_agent", canUseHumanPresence: true });
    expect((await POST(post({ join: true, awarenessClientId: 42 }), context)).status).toBe(200);
  });

  it("sanitizes awareness identity and closes the exact registered session", async () => {
    const session = await join();
    const response = await POST(post({ ...session, awareness: encodePresenceAwareness(42, 1, { user: { name: "Impostor" } }) }), context);
    expect(response.status).toBe(200);
    const submitted = mocks.update.mock.calls[0][0];
    expect(decodePresenceAwareness(submitted.awareness).state?.user).toMatchObject({ name: "Ava", role: "editor", color: "#3c7de0" });
    expect((await POST(post({ ...session, awareness: encodePresenceAwareness(99, 1, {}) }), context)).status).toBe(400);
    expect((await POST(post({ ...session, leave: true }), context)).status).toBe(200);
    expect(mocks.leave).toHaveBeenCalledWith(expect.objectContaining({ clientId: session.clientId, principal: "account:user-1", epoch: 2 }));
  });

  it("denies a revoked grant or role change inside the store lock", async () => {
    mocks.authorizeAtPath.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await POST(post({ join: true, awarenessClientId: 42 }), context)).status).toBe(403);
    mocks.authorizeAtPath.mockResolvedValueOnce({ ...access, canEditContent: false });
    expect((await POST(post({ join: true, awarenessClientId: 42 }), context)).status).toBe(409);
  });

  it("does not disclose the session when access disappears immediately after joining", async () => {
    mocks.authorize.mockResolvedValueOnce(access).mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect((await POST(post({ join: true, awarenessClientId: 42 }), context)).status).toBe(404);
    expect(mocks.join).toHaveBeenCalledTimes(1);
  });

  it("fences old epochs and bounds malformed requests", async () => {
    mocks.join.mockRejectedValueOnce(new VaultCollaborationEpochError(3));
    const stale = await POST(post({ join: true, awarenessClientId: 42 }), context);
    expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ epoch: 3, code: "epoch_changed" });
    for (const invalid of [{}, { join: true, awarenessClientId: -1 }, { join: true, awarenessClientId: 0x100000000 }, { join: true, awarenessClientId: 42, clientId: "forged" }]) {
      const status = (await POST(post(invalid), context)).status;
      expect([400, 409]).toContain(status);
    }
    expect((await POST(post({ join: true, awarenessClientId: 42, padding: "x".repeat(96 * 1024) }), context)).status).toBe(413);
  });
});

describe("native agent vault presence", () => {
  const agent = { name: "Codex", taskId: "task-1" };
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "test-only-vault-presence-key");
    const nativeAccess = { ...access, canAttributeNativeEditor: true };
    mocks.authorize.mockResolvedValue(nativeAccess); mocks.authorizeAtPath.mockResolvedValue(nativeAccess);
    mocks.readCollaboration.mockResolvedValue(state);
    for (const mock of [mocks.join, mocks.update, mocks.leave]) mock.mockImplementation(async input => { await input.beforeCommit("Notes/Shared.textpack"); return { epoch: 2, presence: [] }; });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
  async function joinAgent() { const response = await POST(post({ join: true, awarenessClientId: 42, agent }), context); expect(response.status).toBe(200); return (await response.json()).session; }
  it("attributes agent identity to its authenticated owner and supports update and leave", async () => {
    const session = await joinAgent();
    expect(mocks.join).toHaveBeenCalledWith(expect.objectContaining({ principal: 'native-agent:["user-1","Codex","task-1"]', userName: "Codex (agent) · Ava" }));
    const awareness = encodePresenceAwareness(42, 1, { user: { name: "Another user", role: "admin" } });
    expect((await POST(post({ ...session, agent, awareness }), context)).status).toBe(200);
    const sanitized = decodePresenceAwareness(mocks.update.mock.calls[0][0].awareness);
    expect(JSON.stringify(sanitized)).toContain("Codex (agent) · Ava"); expect(JSON.stringify(sanitized)).not.toContain("Another user");
    expect((await POST(post({ ...session, agent, leave: true }), context)).status).toBe(200);
    expect(mocks.leave).toHaveBeenCalledWith(expect.objectContaining({ principal: 'native-agent:["user-1","Codex","task-1"]' }));
  });
  it("rejects browser attribution, identity spoofing and unsafe task identifiers", async () => {
    mocks.authorize.mockResolvedValueOnce(access);
    expect((await POST(post({ join: true, awarenessClientId: 42, agent }), context)).status).toBe(403);
    expect((await POST(post({ join: true, awarenessClientId: 42, agent, actorUserId: "victim" }), context)).status).toBe(400);
    expect((await POST(post({ join: true, awarenessClientId: 42, agent: { ...agent, taskId: "../other" } }), context)).status).toBe(400);
    expect(mocks.join).not.toHaveBeenCalled();
  });
  it("binds credentials to account and task and rejects expired credentials", async () => {
    const session = await joinAgent();
    expect((await POST(post({ ...session, agent: { ...agent, taskId: "task-2" }, leave: true }), context)).status).toBe(409);
    mocks.authorize.mockResolvedValueOnce({ ...access, actorUserId: "other", canAttributeNativeEditor: true });
    expect((await POST(post({ ...session, agent, leave: true }), context)).status).toBe(409);
    vi.useFakeTimers(); vi.setSystemTime(session.expiresAt + 1);
    expect((await POST(post({ ...session, agent, leave: true }), context)).status).toBe(409);
    expect(mocks.leave).not.toHaveBeenCalled();
  });
  it("rechecks native attribution inside the commit lock", async () => {
    mocks.authorizeAtPath.mockResolvedValueOnce(access);
    expect((await POST(post({ join: true, awarenessClientId: 42, agent }), context)).status).toBe(403);
  });
});
