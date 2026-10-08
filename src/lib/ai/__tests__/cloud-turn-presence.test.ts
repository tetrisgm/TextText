import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ access: vi.fn(), identity: vi.fn(), start: vi.fn() }));
vi.mock("@/lib/store", () => ({ readVaultTextpackIdentity: mock.identity }));
vi.mock("@/lib/permissions", () => ({ resolveWorkspaceAccess: mock.access }));
vi.mock("@/lib/mcp/vault-agent-presence", async original => ({ ...await original<typeof import("@/lib/mcp/vault-agent-presence")>(), startVaultAgentPresence: mock.start }));
import { startCloudTurnPresence } from "../cloud-turn-presence.server";
afterEach(() => vi.unstubAllEnvs());
const input = () => ({ sub: "authenticated-sub", userId: "owner", handle: "workspace", itemId: "item", signal: new AbortController().signal, onAuthorizationLost: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("TEXTTEXT_VAULT_ROOT", "/fixture"); mock.access.mockResolvedValue({ blogId: "workspace-id", userId: "owner", isOwner: true }); mock.identity.mockResolvedValue({ itemId: "item", relativePath: "Notes/A.textpack" }); mock.start.mockImplementation(async context => { await context.authorize(""); return { close: async () => {} }; }); });
it("binds viewer agent identity to the authenticated owner and rechecks uncached authority", async () => {
 await startCloudTurnPresence(input()); const context = mock.start.mock.calls[0][0];
 expect(context).toMatchObject({ actorUserId: "owner", connectionName: "TextText assistant", connectionId: "cloud-assistant:owner", role: "viewer", itemId: "item", workspaceId: "workspace-id" });
 expect(mock.access).toHaveBeenLastCalledWith({handle:"workspace",user:{sub:"authenticated-sub",userId:"owner"},fresh:true});
 mock.access.mockResolvedValue({ blogId: "workspace-id", userId: "owner", isOwner: false }); await expect(context.authorize("")).rejects.toThrow("unavailable");
});
it("refuses changed session identity and missing files", async () => {
 mock.access.mockResolvedValue({blogId:"workspace-id",userId:"other",isOwner:true}); await expect(startCloudTurnPresence(input())).rejects.toThrow("unavailable");
 mock.access.mockResolvedValue({blogId:"workspace-id",userId:"owner",isOwner:true}); mock.identity.mockResolvedValue(null); await expect(startCloudTurnPresence(input())).rejects.toThrow("unavailable");
});
it("does not invent a participant target for requests without an item", async () => {
 expect(await startCloudTurnPresence({...input(),itemId:undefined})).toBeNull(); expect(mock.start).not.toHaveBeenCalled();
});
