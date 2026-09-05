import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ user: vi.fn(), blog: vi.fn(), post: vi.fn(), userId: vi.fn(), create: vi.fn(), list: vi.fn(), revoke: vi.fn(), removePresence: vi.fn() }));
vi.mock("@/auth", () => ({ isAuthConfigured: true }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mock.user }));
vi.mock("@/lib/store", () => ({ getOwnedBlog: mock.blog, getPostById: mock.post, getUserIdBySub: mock.userId }));
vi.mock("@/lib/api-tokens", () => ({ createApiToken: mock.create, listApiTokens: mock.list, revokeApiToken: mock.revoke }));
vi.mock("@/lib/collab", () => ({ removePresence: mock.removePresence }));
import { createItemAgentAction, listItemAgentsAction, prepareLocalItemAgentAction, removeItemAgentAction } from "../agent-connect-actions";
import { agentPresenceClientId } from "@/lib/collab/agent-presence.server";
const id = "11111111-1111-4111-8111-111111111111";
const tokenId = "22222222-2222-4222-8222-222222222222";
const token = { id: tokenId, name: "Codex", scopes: `item:${id}:edit`, expiresAt: "2026-09-12T00:00:00.000Z" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-05T00:00:00.000Z"));
  mock.user.mockResolvedValue({ sub: "owner-sub" }); mock.blog.mockResolvedValue({ handle: "owner" });
  mock.post.mockResolvedValue({ id }); mock.userId.mockResolvedValue("owner-id");
  mock.create.mockResolvedValue({ raw: "one-time-secret", record: { id: tokenId } });
  mock.list.mockResolvedValue([token]); mock.revoke.mockResolvedValue(true); mock.removePresence.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
describe("item connection server actions", () => {
  const calls = [() => createItemAgentAction("owner", id, "Codex", "edit"), () => prepareLocalItemAgentAction("owner", id, "Codex"), () => listItemAgentsAction("owner", id), () => removeItemAgentAction("owner", id, tokenId)];
  it.each(calls.map((call, index) => ({ call, index })))("requires a signed-in owner for action $index", async ({ call }) => {
    mock.user.mockResolvedValue(null); await expect(call()).rejects.toThrow("Sign in");
    mock.user.mockResolvedValue({ sub: "other" }); mock.blog.mockResolvedValue({ handle: "other" }); await expect(call()).rejects.toThrow("Only the workspace owner");
    expect(mock.create).not.toHaveBeenCalled(); expect(mock.revoke).not.toHaveBeenCalled();
  });
  it("requires a real owned item and validates all client input", async () => {
    mock.post.mockResolvedValue(null); await expect(calls[0]()).rejects.toThrow("Item not found");
    mock.post.mockResolvedValue({ id });
    await expect(createItemAgentAction("owner", "bad", "Codex", "edit")).rejects.toThrow();
    await expect(createItemAgentAction("owner", id, "bad", "edit")).rejects.toThrow();
    await expect(createItemAgentAction("owner", id, "Claude Desktop", "edit")).rejects.toThrow("OAuth");
    await expect(createItemAgentAction("owner", id, "Codex", "admin")).rejects.toThrow();
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("creates an expiring item token with atomic audit metadata and returns its secret once", async () => {
    const now = Date.now();
    const result = await calls[0]();
    expect(result).toMatchObject({ token: "one-time-secret", id: tokenId, presenceId: agentPresenceClientId("owner-id", tokenId) });
    const options = mock.create.mock.calls[0][2];
    expect(options).toMatchObject({ kind: "mcp", scopes: `item:${id}:edit`, audit: { actionName: "agent.item.connect", targetId: id, actorUserId: "owner-id" } });
    expect(options.expiresAt.getTime() - now).toBeGreaterThanOrEqual(7 * 86400000);
    expect(options.expiresAt.getTime() - now).toBeLessThan(7 * 86400000 + 1000);
    expect(JSON.stringify(options)).not.toContain("one-time-secret");
    expect(JSON.stringify(await listItemAgentsAction("owner", id))).not.toContain("one-time-secret");
  });
  it("creates read-only scope without broad sync", async () => {
    await createItemAgentAction("owner", id, "Codex", "read");
    expect(mock.create.mock.calls[0][2].scopes).toBe(`item:${id}:read`);
  });
  it("prepares unique local presence without minting a credential", async () => {
    const first = await prepareLocalItemAgentAction("owner", id, "Claude Code");
    const second = await prepareLocalItemAgentAction("owner", id, "Claude Code");
    expect(first.presenceId).not.toBe(second.presenceId);
    expect(first.instruction).toContain(id); expect(first.instruction).toContain("--as 'Claude Code ");
    expect(mock.create).not.toHaveBeenCalled();
    await expect(prepareLocalItemAgentAction("owner", id, "Claude Desktop")).rejects.toThrow();
  });
  it("lists only exact item grants and never exposes secrets", async () => {
    mock.list.mockResolvedValue([token, { ...token, id: "other", scopes: "sync" }, { ...token, id: "another", scopes: `item:${tokenId}:read` }]);
    expect(await listItemAgentsAction("owner", id)).toEqual([{ id: tokenId, name: "Codex", role: "edit", expiresAt: token.expiresAt, presenceId: agentPresenceClientId("owner-id", tokenId) }]);
  });
  it("revokes only the matching owned grant with audit and removes its presence", async () => {
    await removeItemAgentAction("owner", id, tokenId);
    expect(mock.revoke).toHaveBeenCalledWith("owner-id", tokenId, expect.objectContaining({ actionName: "agent.item.disconnect", targetId: id }));
    expect(mock.removePresence).toHaveBeenCalledWith(id, agentPresenceClientId("owner-id", tokenId));
    mock.list.mockResolvedValue([{ ...token, scopes: "sync" }]);
    await expect(removeItemAgentAction("owner", id, tokenId)).rejects.toThrow("Connection not found");
    expect(mock.revoke).toHaveBeenCalledTimes(1);
  });
  it("reports failed mint or revoke without claiming success", async () => {
    mock.create.mockRejectedValue(new Error("database unavailable")); await expect(calls[0]()).rejects.toThrow();
    mock.revoke.mockResolvedValue(false); await expect(removeItemAgentAction("owner", id, tokenId)).rejects.toThrow("already removed");
    expect(mock.removePresence).not.toHaveBeenCalled();
  });
  it("keeps revocation effective when presence cleanup fails", async () => {
    mock.removePresence.mockRejectedValue(new Error("unavailable"));
    await expect(removeItemAgentAction("owner", id, tokenId)).resolves.toBeUndefined();
    expect(mock.revoke).toHaveBeenCalledTimes(1);
  });
});
