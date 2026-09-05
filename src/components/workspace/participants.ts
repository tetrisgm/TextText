import type { PresencePeer } from "@/lib/collab/provider";
import { presenceAgentIdentity } from "./assistant/agent-identity";

export type ParticipantMark = {
  id: string;
  name: string;
  initials: string;
  agent: boolean;
  provider?: string;
  state: "Editing" | "Viewing" | "Working" | "Present";
  connection: string;
  role: string;
};

/** Presence identifies sessions, not people. Never merge two same-name clients. */
export function participantMarks(peers: readonly PresencePeer[]): ParticipantMark[] {
  const sessions = new Map(peers.filter((peer) => peer.clientId).map((peer) => [peer.clientId, peer]));
  return Array.from(sessions.values()).map((peer) => {
    const identity = presenceAgentIdentity(peer);
    const name = identity?.name ?? (peer.userName.trim() || "Someone");
    const parts = name.split(/\s+/);
    return {
      id: peer.clientId,
      name,
      initials: (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase(),
      agent: Boolean(identity),
      provider: identity?.provider,
      // Editor means an open editor session, not a claim of keystrokes.
      // A live agent lease indicates work, never a configured provider alone.
      state: peer.role === "viewer" ? "Viewing" : identity ? "Working" : peer.role === "editor" ? "Editing" : "Present",
      connection: `${identity ? "Agent" : "Browser"} session: ${peer.clientId}`,
      role: peer.role === "editor" ? "Can edit this item" : peer.role === "viewer" ? "Read-only session" : "Permission not reported",
    } satisfies ParticipantMark;
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
