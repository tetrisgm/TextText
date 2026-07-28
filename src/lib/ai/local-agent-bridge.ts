import type { AssistantViewSnapshot } from "@/components/workspace/assistant/context";
import type { WorkspaceAgentToolExecutor } from "@/lib/ai/agent-protocol";
import type { WorkspaceAgentToolDefinition } from "@/lib/ai/agent-tools";

export const LOCAL_AGENT_BRIDGE_VERSION = 1;

export type LocalAgentBridgeManifest = {
  version: typeof LOCAL_AGENT_BRIDGE_VERSION;
  context: string;
  view: AssistantViewSnapshot;
  tools: WorkspaceAgentToolDefinition[];
};

export type LocalAgentBridge = {
  manifest: () => LocalAgentBridgeManifest;
  call: WorkspaceAgentToolExecutor;
};

type LocalAgentBridgeHost = {
  __TEXTTEXT_AGENT_BRIDGE__?: LocalAgentBridge;
};

declare global {
  interface Window extends LocalAgentBridgeHost {}
}

export function installLocalAgentBridge(
  host: LocalAgentBridgeHost,
  bridge: LocalAgentBridge,
): () => void {
  const previous = host.__TEXTTEXT_AGENT_BRIDGE__;
  host.__TEXTTEXT_AGENT_BRIDGE__ = bridge;
  return () => {
    if (host.__TEXTTEXT_AGENT_BRIDGE__ !== bridge) return;
    if (previous) host.__TEXTTEXT_AGENT_BRIDGE__ = previous;
    else delete host.__TEXTTEXT_AGENT_BRIDGE__;
  };
}
