import type { PresencePeer } from "@/lib/collab/provider";

export type AssistantAgentIdentity = {
  name: string;
  provider?: string;
  color: string;
  status?: "connected" | "working";
};

type CloudLabel = string | null | undefined;
type NativeConnection = { state?: string; providerLabel?: string | null } | null | undefined;

/**
 * The one derivation of "which AI is here" from the two ways one can be
 * connected. It used to be duplicated inline at every surface that shows the
 * agent, and the copies had already drifted: the document presence chip only
 * knew about the native connection, so an API-key assistant never appeared as
 * a collaborator on the page, which contradicted the whole idea that the
 * connected AI is a member of the workspace.
 */
export function assistantAgentIdentity(
  cloudProvider: CloudLabel,
  nativeConnection: NativeConnection,
  colorFor: (seed: string) => string,
  working = false,
): AssistantAgentIdentity | null {
  const status = working ? "working" : "connected";
  if (nativeConnection?.state === "ready") {
    const label = nativeConnection.providerLabel ?? "";
    const claude = label.includes("Claude");
    return {
      name: claude ? "Claude" : "Codex",
      provider: claude ? "claude" : "codex",
      color: colorFor(label || "agent"),
      status,
    };
  }
  if (cloudProvider) {
    const claude = cloudProvider.includes("Anthropic");
    return {
      name: claude ? "Claude" : "OpenAI",
      provider: claude ? "claude" : "chatgpt",
      color: colorFor(cloudProvider),
      status,
    };
  }
  return null;
}

/** A live session supplies its own label. A selected assistant is not presence. */
export function presenceAgentIdentity(peer: PresencePeer): AssistantAgentIdentity | null {
  if (peer.participantType !== "agent") return null;
  return {
    name: peer.userName.trim() || "Agent",
    provider: peer.provider,
    color: peer.color,
    status: peer.role === "viewer" ? "connected" : "working",
  };
}
