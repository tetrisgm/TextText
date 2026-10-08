import { startVaultAgentPresence, VaultAgentPresenceAuthorizationError } from "@/lib/mcp/vault-agent-presence";
import { readVaultTextpackIdentity } from "@/lib/store";
import { resolveWorkspaceAccess } from "@/lib/permissions";

/** The cloud assistant is workspace-owner-only, matching /api/ai. */
export async function startCloudTurnPresence(input: {
  sub: string; userId: string | null; handle: string; itemId: unknown;
  signal: AbortSignal; onAuthorizationLost: () => void;
}) {
  if (typeof input.itemId !== "string" || !input.itemId) return null;
  const root = process.env.TEXTTEXT_VAULT_ROOT;
  if (!root || !input.userId) throw new VaultAgentPresenceAuthorizationError("Item unavailable.");
  const access = () => resolveWorkspaceAccess({ handle: input.handle, user: { sub: input.sub, userId: input.userId }, fresh: true });
  const workspace = await access();
  if (!workspace.isOwner || !workspace.blogId || workspace.userId !== input.userId) throw new VaultAgentPresenceAuthorizationError("Item unavailable.");
  const location = { root, workspaceId: workspace.blogId, itemId: input.itemId };
  const authorize = async () => {
    input.signal.throwIfAborted();
    const current = await access();
    const item = await readVaultTextpackIdentity(location);
    if (!item || current.blogId !== location.workspaceId || !current.isOwner || current.userId !== input.userId) throw new VaultAgentPresenceAuthorizationError("Item unavailable.");
  };
  return startVaultAgentPresence({ ...location, actorUserId: input.userId,
    connectionName: "TextText assistant", connectionId: `cloud-assistant:${input.userId}`,
    role: "viewer", signal: input.signal, onAuthorizationLost: input.onAuthorizationLost, authorize,
  });
}
