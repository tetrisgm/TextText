// Lowercase on purpose: a hostname is case-insensitive on the wire, but
// this exact string gets pasted into connectors and compared by tools that
// are not, and a mixed-case copy of it already broke the Mac sign-in once.
export const TEXTTEXT_HOSTED_MCP_URL = "https://texttext.app/api/mcp";
export const CLAUDE_PLUGIN_INSTALL_COMMAND =
  "claude plugin marketplace add tetrisgm/TextText && claude plugin install texttext@texttext";

export const CODEX_PLUGIN_INSTALL_COMMAND =
  "codex plugin marketplace add tetrisgm/TextText && codex plugin add texttext@texttext";

export const CHATGPT_CONNECTOR_URL =
  "https://chatgpt.com/#settings/Connectors";

export type AgentIntegrationStep = {
  /** One sentence, imperative, sentence case. */
  text: string;
  /** Optional value this step hands the person, with a labeled copy action. */
  copy?: { label: string; value: string };
};

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
  /** How you actually get connected, start to finish. */
  steps: AgentIntegrationStep[];
  /** What the person sees once it works; the reason to bother. */
  outcome: string;
};

/**
 * Every path in here ends in a token a person creates at /connect and pastes.
 *
 * These steps described a browser window opening for an approval, which was
 * the OAuth flow; that flow was deleted (owner ruling 2026-08-15) and the copy
 * outlived it here, on the three surfaces that render this list: /connect,
 * /docs/ai, and the assistant rail. Onboarding copy is a claim about the
 * product like any other.
 */
export const AGENT_INTEGRATIONS: readonly AgentIntegration[] = [
  {
    id: "claude",
    name: "Claude",
    company: "Anthropic",
    monogram: "C",
    description:
      "Install TextText once, then create, reshape, publish, and maintain documents from Claude.",
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
    steps: [
      {
        text: "Copy the install command.",
        copy: { label: "Copy install command", value: CLAUDE_PLUGIN_INSTALL_COMMAND },
      },
      { text: "Paste it into Terminal and press Return. It adds the TextText plugin to Claude Code." },
      { text: "Create a token at Connect, then paste it into Claude when it asks for the TextText credential." },
    ],
    outcome: "Claude appears as a collaborator with its own cursor whenever it works in your documents.",
  },
  {
    id: "codex",
    name: "Codex",
    company: "OpenAI",
    monogram: "O",
    description:
      "Add the TextText plugin to Codex for durable project notes, changelogs, publishing, and collaboration.",
    environment: "Codex app and CLI",
    action: {
      kind: "copy",
      label: "Install Codex plugin",
      value: CODEX_PLUGIN_INSTALL_COMMAND,
      copiedLabel: "Copied. Paste in Terminal",
    },
    steps: [
      {
        text: "Copy the install command.",
        copy: { label: "Copy install command", value: CODEX_PLUGIN_INSTALL_COMMAND },
      },
      { text: "Paste it into Terminal and press Return. It adds the TextText plugin to Codex." },
      { text: "Create a token at Connect, then paste it into Codex when it asks for the TextText credential." },
    ],
    outcome: "Codex appears as a collaborator with its own cursor whenever it works in your documents.",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    company: "OpenAI",
    monogram: "G",
    description:
      "Connect your TextText workspace as a ChatGPT app, using a token you create and paste.",
    environment: "ChatGPT apps",
    action: {
      kind: "link",
      label: "Open ChatGPT apps",
      href: CHATGPT_CONNECTOR_URL,
    },
    steps: [
      {
        text: "Copy the TextText address first.",
        copy: { label: "Copy TextText address", value: TEXTTEXT_HOSTED_MCP_URL },
      },
      { text: "Open ChatGPT's settings. The button below takes you there; depending on your plan the section is called Connectors or Plugins." },
      { text: "Add TextText there with the copied address, and give it a token you created at Connect as its bearer credential." },
    ],
    outcome: "ChatGPT can read and edit your documents from any chat, and appears as a collaborator while it works.",
  },
  {
    id: "mcp",
    name: "Other agents",
    company: "MCP",
    monogram: "M",
    description:
      "Use the hosted address in Cursor, Claude-compatible clients, automations, and any MCP app.",
    environment: "Any remote MCP client",
    action: {
      kind: "copy",
      label: "Copy MCP address",
      value: TEXTTEXT_HOSTED_MCP_URL,
      copiedLabel: "MCP address copied",
    },
    steps: [
      {
        text: "Copy the TextText address.",
        copy: { label: "Copy TextText address", value: TEXTTEXT_HOSTED_MCP_URL },
      },
      { text: "Add it wherever your app configures MCP servers, and give the connection a name you will recognize." },
      { text: "Give the client a token you created at Connect. One token, one workspace, revocable from the same page." },
    ],
    outcome: "The app appears in your documents under the name on its token, with every change attributed to it.",
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
      "Keep one TextText document open while you and an agent develop the work together.",
    prompt:
      "Use TextText as the live canvas for this task. Find the matching document or create it once, tell me which document to open, and keep that same item current as our work develops. Preserve my concurrent edits, reconcile conflicts, and use stable idempotency keys for every append that may retry.",
  },
  {
    id: "capture-conversation",
    title: "Capture a conversation",
    description:
      "Turn the useful answer or full discussion into a clean note with source context.",
    prompt:
      "Save the useful decisions from this conversation as a TextText note. Include the source context and verify the saved note.",
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
