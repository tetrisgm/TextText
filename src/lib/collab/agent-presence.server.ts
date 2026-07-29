// One construction site for external-agent collaborator presence.
//
// Hosted MCP (src/lib/mcp/tools.ts) and the native loopback MCP path (the
// agent-presence route) both need an agent to appear as the SAME collaborator:
// same canonical provider name, same stable client id, same provider color.
// Building that twice is how Codex ends up as two collaborators, or as an
// anonymous "AI agent" on one transport and "Codex" on the other, so both
// callers go through here.
//
// Server-only: it hashes with node:crypto and encodes Yjs awareness.

import { createHash } from "node:crypto";
import {
  colorForSub,
  createAgentAwareness,
  type AgentSelectionState,
  type PresenceEntry,
} from "@/lib/collab";
import type { AgentFocusEvent } from "@/lib/collab/agent-focus";
import { agentIdentity, agentProviderColor } from "@/lib/collab/agent-identity";

/** Fallback name when a client connects without identifying itself at all. */
export const UNKNOWN_AGENT_CONNECTION_NAME = "AI agent";

export type AgentPresenceActor = {
  /** The raw connection name (OAuth client name, or MCP clientInfo.name). */
  connectionName: string;
  /** The signed-in user this agent is acting for. */
  userId: string;
};

/**
 * A stable per-(user, connection) client id.
 *
 * Keyed on the RAW connection name rather than the canonical provider so two
 * different connections stay two collaborators, and on the user id so the same
 * agent name in two workspaces never shares a presence row.
 */
export function agentPresenceClientId(
  userId: string,
  connectionName: string,
): string {
  return `agent-${createHash("sha256")
    .update(`${userId}:${connectionName}`, "utf8")
    .digest("hex")
    .slice(0, 16)}`;
}

/** Normalize a possibly missing or blank connection name. */
export function agentConnectionName(raw: unknown): string {
  return typeof raw === "string" && raw.trim()
    ? raw.trim()
    : UNKNOWN_AGENT_CONNECTION_NAME;
}

/**
 * Build the presence row for an agent, with encoded awareness carrying the
 * provider identity plus an optional selection (the cursor) and focus event.
 * Returns null only when there is no user to attribute the agent to.
 */
export function buildAgentPresence(
  actor: AgentPresenceActor,
  state: {
    selection?: AgentSelectionState | null;
    focus?: AgentFocusEvent | null;
  } = {},
): PresenceEntry | null {
  if (!actor.userId) return null;
  const connectionName = agentConnectionName(actor.connectionName);
  const identity = agentIdentity(connectionName);
  const clientId = agentPresenceClientId(actor.userId, connectionName);
  const color = agentProviderColor(identity.provider) ?? colorForSub(clientId);
  const userName = identity.displayName;
  return {
    clientId,
    userName,
    color,
    awareness: createAgentAwareness({
      clientId,
      userName,
      color,
      provider: identity.provider,
      selection: state.selection,
      focus: state.focus,
    }),
  };
}
