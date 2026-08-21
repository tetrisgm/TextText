// Lowercase on purpose: a hostname is case-insensitive on the wire, but
// this exact string gets pasted into connectors and compared by tools that
// are not, and a mixed-case copy of it already broke the Mac sign-in once.
export const TEXTTEXT_HOSTED_MCP_URL = "https://texttext.app/api/mcp";
export const CLAUDE_PLUGIN_INSTALL_COMMAND =
  "claude plugin marketplace add tetrisgm/TextText && claude plugin install texttext@texttext";

export const CODEX_PLUGIN_INSTALL_COMMAND =
  "codex plugin marketplace add tetrisgm/TextText && codex plugin add texttext@texttext";

export const TEXTTEXT_CLI_VERIFY_COMMAND =
  "if command -v texttext >/dev/null 2>&1; then texttext ls; else /Applications/TextText.app/Contents/Helpers/texttext ls; fi";

export const AGENT_CONNECTION_CHECK_PROMPT =
  "Use TextText to create a private note titled Agent connection check. Add one line: Connected through [your agent name], replacing the brackets with your name. Read the note back, tell me where you saved it, and do not publish or share it.";

export type AgentIntegrationStep = {
  /** One sentence, imperative, sentence case. */
  text: string;
  /** Optional value this step hands the person, with a labeled copy action. */
  copy?: { label: string; value: string };
};

export type AgentIntegration = {
  id: "claude" | "codex" | "mcp";
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
 * Claude Code and Codex on the same Mac use the CLI shipped in the standalone
 * app. Installing either plugin must not start MCP or ask for a workspace
 * token. Hosted MCP is a separate, explicit path for remote clients. The
 * sandboxed TestFlight app uses the API-key in-app assistant.
 */
export const AGENT_INTEGRATIONS: readonly AgentIntegration[] = [
  {
    id: "claude",
    name: "Claude",
    company: "Anthropic",
    monogram: "C",
    description:
      "Install the TextText skills, then work in your signed-in Mac workspace with no token or server setup.",
    environment: "Claude Code on this Mac",
    action: {
      kind: "copy",
      label: "Install Claude plugin",
      value: CLAUDE_PLUGIN_INSTALL_COMMAND,
      copiedLabel: "Copied. Paste in Terminal",
    },
    steps: [
      {
        text: "Copy the install command.",
        copy: {
          label: "Copy install command",
          value: CLAUDE_PLUGIN_INSTALL_COMMAND,
        },
      },
      {
        text: "Paste it into Terminal and press Return. It adds the TextText plugin to Claude Code.",
      },
      {
        text: "Keep the standalone TextText app in Applications and sign in once. The plugin uses the command already bundled with the app.",
      },
      {
        text: "Ask Claude to list your TextText workspace. It checks the installed command with this read-only request.",
        copy: {
          label: "Copy verification command",
          value: TEXTTEXT_CLI_VERIFY_COMMAND,
        },
      },
    ],
    outcome:
      "During connected edits, TextText can show Claude as an active collaborator and records its supplied label and intent in the audit.",
  },
  {
    id: "codex",
    name: "Codex",
    company: "OpenAI",
    monogram: "O",
    description:
      "Add TextText skills to Codex, then work in your signed-in Mac workspace with no token or server setup.",
    environment: "Codex app and CLI on this Mac",
    action: {
      kind: "copy",
      label: "Install Codex plugin",
      value: CODEX_PLUGIN_INSTALL_COMMAND,
      copiedLabel: "Copied. Paste in Terminal",
    },
    steps: [
      {
        text: "Copy the install command.",
        copy: {
          label: "Copy install command",
          value: CODEX_PLUGIN_INSTALL_COMMAND,
        },
      },
      {
        text: "Paste it into Terminal and press Return. It adds the TextText plugin to Codex.",
      },
      {
        text: "Keep the standalone TextText app in Applications and sign in once. The plugin uses the command already bundled with the app.",
      },
      {
        text: "Ask Codex to list your TextText workspace. It checks the installed command with this read-only request.",
        copy: {
          label: "Copy verification command",
          value: TEXTTEXT_CLI_VERIFY_COMMAND,
        },
      },
    ],
    outcome:
      "During connected edits, TextText can show Codex as an active collaborator and records its supplied label and intent in the audit.",
  },
  {
    id: "mcp",
    name: "Remote agents",
    company: "Hosted MCP",
    monogram: "M",
    description:
      "Connect from another computer, a browser client, or an automation with a revocable workspace token.",
    environment: "Remote MCP clients",
    action: {
      kind: "copy",
      label: "Copy MCP address",
      value: TEXTTEXT_HOSTED_MCP_URL,
      copiedLabel: "MCP address copied",
    },
    steps: [
      {
        text: "Copy the TextText address.",
        copy: {
          label: "Copy TextText address",
          value: TEXTTEXT_HOSTED_MCP_URL,
        },
      },
      {
        text: "Add it wherever your app configures MCP servers, and give the connection a name you will recognize.",
      },
      {
        text: "Create a token at Connect and save it in the client's protected credential field. One token, one workspace, revocable from the same page.",
      },
    ],
    outcome:
      "The remote client can use TextText's hosted tools inside the token's workspace. Revoke the token from Connect at any time.",
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
