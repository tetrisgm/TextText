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
      connection: sessionLabel(identity ? "Agent" : "Browser", peer, peers),
      role: peer.role === "editor" ? "Can edit this item" : peer.role === "viewer" ? "Read-only session" : "Permission not reported",
    } satisfies ParticipantMark;
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * "Browser session", or "Browser session 2 of 3" when the same name has more
 * than one live session, so two marks stay distinguishable without exposing a
 * row ID nobody can act on.
 */
function sessionLabel(kind: string, peer: PresencePeer, peers: readonly PresencePeer[]): string {
  const same = peers
    .filter((candidate) => candidate.clientId && candidate.userName === peer.userName)
    .map((candidate) => candidate.clientId)
    .sort();
  const index = same.indexOf(peer.clientId);
  return same.length > 1 && index >= 0
    ? `${kind} session ${index + 1} of ${same.length}`
    : `${kind} session`;
}
