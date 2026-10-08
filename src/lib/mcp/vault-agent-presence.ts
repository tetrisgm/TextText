import { randomUUID } from "node:crypto";
import { buildAgentPresence } from "@/lib/collab/agent-presence.server";
import { decodePresenceAwareness, encodePresenceAwareness } from "@/lib/collab/presence-awareness";
import { joinVaultPresence, leaveVaultPresence, readVaultCollaboration, updateVaultPresence } from "@/lib/store";

export class VaultAgentPresenceAuthorizationError extends Error {}

export type VaultAgentPresenceContext = {
  root: string; workspaceId: string; itemId: string; actorUserId: string;
  /** Authenticated connection metadata, never tool arguments. */
  connectionName: string; connectionId?: string; ownerDisplayName?: string;
  authorize: (path: string) => Promise<void>;
  role?: "viewer" | "editor";
  signal?: AbortSignal;
  onAuthorizationLost?: () => void;
};
/** Presence is transient, mutations remain responsible for commit-time authorization. */
export async function startVaultAgentPresence(context: VaultAgentPresenceContext): Promise<{ close(): Promise<void> }> {
  context.signal?.throwIfAborted();
  await context.authorize("");
  const location = { root: context.root, workspaceId: context.workspaceId, itemId: context.itemId };
  const state = await readVaultCollaboration(location);
  if (!state) throw new Error("Item not found.");
  const actor = buildAgentPresence({ userId: context.actorUserId, connectionName: context.connectionName, connectionId: context.connectionId }, { role: context.role ?? "editor", ownerDisplayName: context.ownerDisplayName });
  if (!actor?.awareness) throw new Error("Agent attribution is unavailable.");
  const decoded = decodePresenceAwareness(actor.awareness);
  // Separate session per operation: an earlier command's cleanup cannot remove a later peer.
  const session = randomUUID();
  const identity = { ...location, clientId: `p-${session}`,
    principal: `native-agent:${JSON.stringify([context.actorUserId, "AI agent", session])}`,
    epoch: state.epoch, awarenessClientId: decoded.clientId, sessionExpiresAt: Date.now() + 5 * 60_000,
    userName: actor.userName, color: actor.color, role: context.role ?? "editor", beforeCommit: context.authorize };
  let clock = decoded.clock;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  const pulse = async () => {
    await context.authorize(state.relativePath);
    await updateVaultPresence({ ...identity, awareness: encodePresenceAwareness(decoded.clientId, ++clock, decoded.state) });
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      running = pulse().then(schedule).catch(error => {
        if (error instanceof VaultAgentPresenceAuthorizationError) { context.onAuthorizationLost?.(); void close(); }
        else schedule(); // Presence transport failures do not cancel a legitimate model turn.
      });
    }, 10_000);
    timer.unref?.();
  };
  let closing: Promise<void> | undefined;
  const aborted = () => { void close(); };
  const close = () => {
    if (closing) return closing;
    stopped = true;
    if (timer) clearTimeout(timer);
    context.signal?.removeEventListener("abort", aborted);
    closing = (async () => {
      await running;
      // Cleanup cannot turn an acknowledged edit into an apparent failure.
      // Server leases expire after 30 seconds without a pulse, including process death.
      await leaveVaultPresence({ ...identity, beforeCommit: undefined }).catch(() => undefined);
    })();
    return closing;
  };
  await joinVaultPresence(identity);
  try {
    context.signal?.throwIfAborted();
    await pulse();
    context.signal?.throwIfAborted();
    context.signal?.addEventListener("abort", aborted, { once: true });
    schedule();
    return { close };
  } catch (error) { await close(); throw error; }
}

export async function withVaultAgentPresence<T>(context: VaultAgentPresenceContext, action: () => Promise<T>): Promise<T> {
  const lease = await startVaultAgentPresence(context);
  try { return await action(); }
  finally { await lease.close(); }
}
