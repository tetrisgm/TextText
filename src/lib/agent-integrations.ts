export const TEXTTEXT_HOSTED_MCP_URL = "https://texttext.app/api/mcp";
export const TEXTTEXT_LOCAL_MCP_URL = "http://127.0.0.1:47118/mcp";
export const TEXTTEXT_PLUGIN_REPOSITORY = "tetrisgm/write";

export const CLAUDE_PLUGIN_INSTALL_COMMAND =
  "claude plugin marketplace add tetrisgm/write && claude plugin install texttext@texttext";

export const CODEX_PLUGIN_INSTALL_COMMAND =
  "codex plugin marketplace add tetrisgm/write && codex plugin add texttext@texttext";

export const CHATGPT_CONNECTOR_URL =
  "https://chatgpt.com/#settings/Connectors";

export type AgentIntegration = {
  id: "claude" | "codex" | "chatgpt" | "mcp";
  name: string;
  company: string;
  monogram: string;
  description: string;
  environment: string;
  action:
    | { kind: "copy"; label: string; value: string; copiedLabel: string }
    | { kind: "link"; label: string; href: string };
  secondaryAction?: { label: string; href: string };
};

export const AGENT_INTEGRATIONS: readonly AgentIntegration[] = [
  {
    id: "claude",
    name: "Claude",
    company: "Anthropic",
    monogram: "C",
    description:
      "Install Texttext once, then create, reshape, publish, and maintain documents from Claude.",
    environment: "Claude Code and Claude.ai",
    action: {
      kind: "copy",
      label: "Install Claude plugin",
      value: CLAUDE_PLUGIN_INSTALL_COMMAND,
      copiedLabel: "Copied. Paste in Terminal",
    },
    secondaryAction: {
      label: "Use in Claude.ai",
      href: "https://claude.ai/settings/connectors",
    },
  },
  {
    id: "codex",
    name: "Codex",
    company: "OpenAI",
    monogram: "O",
    description:
      "Add the Texttext plugin to Codex for durable project notes, changelogs, publishing, and collaboration.",
    environment: "Codex app and CLI",
    action: {
      kind: "copy",
      label: "Install Codex plugin",
      value: CODEX_PLUGIN_INSTALL_COMMAND,
      copiedLabel: "Copied. Paste in Terminal",
    },
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    company: "OpenAI",
    monogram: "G",
    description:
      "Connect your Texttext workspace as a ChatGPT app and approve access with your Texttext account.",
    environment: "ChatGPT apps",
    action: {
      kind: "link",
      label: "Open ChatGPT apps",
      href: CHATGPT_CONNECTOR_URL,
    },
  },
  {
    id: "mcp",
    name: "Other agents",
    company: "MCP",
    monogram: "M",
    description:
      "Use the hosted OAuth connection in Cursor, Claude-compatible clients, automations, and any MCP app.",
    environment: "Any remote MCP client",
    action: {
      kind: "copy",
      label: "Copy MCP address",
      value: TEXTTEXT_HOSTED_MCP_URL,
      copiedLabel: "MCP address copied",
    },
  },
] as const;

export type AgentWorkflow = {
  id: string;
  title: string;
  description: string;
  prompt: string;
};

export const AGENT_WORKFLOWS: readonly AgentWorkflow[] = [
  {
    id: "live-document",
    title: "Use a live document canvas",
    description:
      "Keep one Texttext document open while you and an agent develop the work together.",
    prompt:
      "Use Texttext as the live canvas for this task. Find the matching document or create it once, tell me which document to open, and keep that same item current as our work develops. Preserve my concurrent edits, reconcile conflicts, and use stable idempotency keys for every append that may retry.",
  },
  {
    id: "capture-conversation",
    title: "Capture a conversation",
    description:
      "Turn the useful answer or full discussion into a clean note with source context.",
    prompt:
      "Save the useful decisions from this conversation as a Texttext note. Include the source context and verify the saved note.",
  },
  {
    id: "project-changelogs",
    title: "Maintain project changelogs",
    description:
      "Keep one durable project document current without creating duplicate entries on retries.",
    prompt:
      "Find the changelog for this project and append today's shipped user-facing changes exactly once. Create it only if it does not exist, keep using the same item, and derive a stable idempotency key from the source commit or release.",
  },
  {
    id: "publish-collaborate",
    title: "Publish and collaborate",
    description:
      "Shape a draft, publish it, and grant the intended people the right level of access.",
    prompt:
      "Turn this draft into a polished article, show me the final title and audience, then publish it after I confirm.",
  },
] as const;

export function hostedMcpUrl(origin?: string): string {
  const normalized = origin?.replace(/\/+$/, "");
  return normalized ? `${normalized}/api/mcp` : TEXTTEXT_HOSTED_MCP_URL;
}
