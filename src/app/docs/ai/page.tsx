// /docs/ai: the canonical provider-first setup and tool reference for TextText.

import type { Metadata } from "next";
import Link from "next/link";
import {
  AGENT_INTEGRATIONS,
  AGENT_WORKFLOWS,
  CLAUDE_PLUGIN_INSTALL_COMMAND,
  CODEX_PLUGIN_INSTALL_COMMAND,
  TEXTTEXT_HOSTED_MCP_URL,
} from "@/lib/agent-integrations";
import {
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
} from "@/lib/ai/tools";
import "@/styles/connect.css";

const READ_TOOLS = WORKSPACE_TOOL_NAMES.filter(
  (name) => WORKSPACE_TOOL_DEFINITIONS[name].mutability === "read",
);
const TEXTTEXT_TOOLS = WORKSPACE_TOOL_NAMES.filter(
  (name) => WORKSPACE_TOOL_DEFINITIONS[name].mutability === "write",
);

export const metadata: Metadata = {
  title: "Add TextText to your AI",
  description:
    "Install TextText in Claude and Codex, connect ChatGPT, or use any MCP client.",
};

function ToolTable({ names }: { names: typeof WORKSPACE_TOOL_NAMES }) {
  return (
    <div className="connect-table-wrap">
      <table className="connect-table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {names.map((name) => (
            <tr key={name}>
              <td>
                <code className="connect-inline-code">{name}</code>
              </td>
              <td>{WORKSPACE_TOOL_DEFINITIONS[name].description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InstallCommand({
  children,
  command,
}: {
  children: React.ReactNode;
  command: string;
}) {
  return (
    <div className="connect-code-wrap">
      <p className="connect-code-label">{children}</p>
      <pre className="connect-code">{command}</pre>
    </div>
  );
}

export default function AiDocsPage() {
  const tokenConfig = `{
  "mcpServers": {
    "texttext": {
      "url": "${TEXTTEXT_HOSTED_MCP_URL}",
      "headers": { "Authorization": "Bearer wsk_..." }
    }
  }
}`;

  return (
    <div className="applecms connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">Agents and integrations</p>
        <h1 className="connect-title">Add TextText to your AI</h1>
        <p className="connect-lede">
          TextText becomes the durable document workspace for Claude, Codex,
          ChatGPT, and other agents. Your AI keeps its own account and model.
          TextText supplies the documents, permissions, collaboration, and
          publishing tools.
        </p>

        <section className="connect-section" id="embedded-agent">
          <h2 className="connect-section-title">Use an agent inside TextText</h2>
          <p className="connect-body">
            In the TextText Mac app, Continue with ChatGPT starts a Codex-powered
            agent directly in the assistant sidebar. Your existing eligible
            ChatGPT or Codex plan supplies the model, so TextText does not ask
            you for API credits. The conversation, approvals, and document work
            stay in TextText.
          </p>
          <ol className="connect-steps">
            <li>Open TextText on your Mac and open a workspace.</li>
            <li>Choose Continue with ChatGPT in the Library card, Assistant, or AI Settings.</li>
            <li>Complete the browser sign-in if TextText asks you to connect.</li>
            <li>Wait for the account and tool check to show Connected.</li>
            <li>Ask: <em>&quot;What folders are in my TextText workspace?&quot;</em></li>
          </ol>
          <p className="connect-body">
            The embedded connection is Mac-only. In a browser, use an external
            MCP connection or the advanced API-key path below.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Choose your AI</h2>
          <div className="connect-integration-grid">
            {AGENT_INTEGRATIONS.map((integration) => (
              <article
                className="connect-integration-card"
                key={integration.id}
              >
                <div className="connect-integration-heading">
                  <span
                    className={`connect-integration-mark is-${integration.id}`}
                    aria-hidden="true"
                  >
                    {integration.monogram}
                  </span>
                  <div>
                    <p className="connect-provider-kicker">
                      {integration.company}
                    </p>
                    <h3>{integration.name}</h3>
                  </div>
                </div>
                <p className="connect-integration-description">
                  {integration.description}
                </p>
                <p className="connect-integration-environment">
                  {integration.environment}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Claude</h2>
          <p className="connect-body">
            The TextText plugin gives Claude Code the MCP connection and the
            skills for conversation capture, project changelogs, publishing,
            and collaboration. Install it once:
          </p>
          <InstallCommand command={CLAUDE_PLUGIN_INSTALL_COMMAND}>
            Claude Code
          </InstallCommand>
          <p className="connect-body">
            Claude opens TextText so you can approve access. In Claude.ai or
            Claude Desktop, add a custom connector and paste{" "}
            <code className="connect-inline-code">
              {TEXTTEXT_HOSTED_MCP_URL}
            </code>
            .
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Codex</h2>
          <p className="connect-body">
            The TextText plugin gives the Codex app and CLI the same connection
            and reusable skills:
          </p>
          <InstallCommand command={CODEX_PLUGIN_INSTALL_COMMAND}>
            Codex app or CLI
          </InstallCommand>
          <p className="connect-body">
            Codex opens TextText during installation so you can approve access.
            The plugin is then available in future tasks without repeating the
            setup.
          </p>
        </section>

        <section className="connect-section" id="chatgpt-external">
          <h2 className="connect-section-title">ChatGPT</h2>
          <ol className="connect-steps">
            <li>Open ChatGPT Settings or Workspace Settings.</li>
            <li>Open Apps, enable developer mode, then choose Create.</li>
            <li>
              Paste{" "}
              <code className="connect-inline-code">
                {TEXTTEXT_HOSTED_MCP_URL}
              </code>{" "}
              and scan the tools.
            </li>
            <li>Choose Connect and approve TextText in the browser.</li>
          </ol>
          <p className="connect-body">
            ChatGPT supplies the model and billing. TextText never needs your
            ChatGPT password or API key.
          </p>
        </section>

        <section className="connect-section" id="api-key">
          <h2 className="connect-section-title">Use an API key</h2>
          <p className="connect-body">
            API keys are an advanced fallback for users who want TextText to
            call Anthropic or OpenAI directly. Provider API usage is billed
            separately from ChatGPT and Claude subscriptions. Add or remove a
            key in Workspace Settings. TextText never displays a saved key.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Ready-made skills</h2>
          <p className="connect-body">
            Claude and Codex install these workflows with the plugin. ChatGPT
            and other MCP clients can run the same workflows from the prompts.
          </p>
          <div className="connect-workflow-grid">
            {AGENT_WORKFLOWS.map((workflow) => (
              <article className="connect-workflow" key={workflow.id}>
                <h3>{workflow.title}</h3>
                <p>{workflow.description}</p>
                <blockquote>{workflow.prompt}</blockquote>
              </article>
            ))}
          </div>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">What agents can do</h2>
          <div className="connect-capability-strip">
            <span>{WORKSPACE_TOOL_NAMES.length} document tools</span>
            <span>Revocable tokens</span>
            <span>Audited mutations</span>
            <span>Conflict-safe edits</span>
          </div>
          <ul className="connect-feature-list">
            <li>Create notes, articles, bookmarks, folders, and assets.</li>
            <li>Find, read, append to, reshape, move, and organize documents.</li>
            <li>Maintain one project changelog without duplicate retry entries.</li>
            <li>Publish articles and manage collaborators after confirmation.</li>
            <li>Comment, restore from Trash, and recapture bookmarks.</li>
          </ul>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Verify the connection</h2>
          <p className="connect-body">
            Ask: <em>&quot;What folders are in my TextText workspace?&quot;</em>{" "}
            The agent should request approval if needed, then list your folders.
          </p>
          <p className="connect-body">
            Then ask:{" "}
            <em>
              &quot;Create a draft note in TextText titled MCP test and read it
              back to verify it.&quot;
            </em>
          </p>
        </section>

        <details className="connect-section connect-advanced">
          <summary className="connect-section-title">
            Advanced and manual connections
          </summary>
          <p className="connect-body">
            Use these for clients that cannot install the plugin.
          </p>
          <h3>Agents on the same Mac</h3>
          <p className="connect-body">
            No MCP connection is needed. The Mac app installs a{" "}
            <code className="connect-inline-code">texttext</code> command, and
            agents use it to read and edit documents as files. Presence is
            automatic: an agent shows up in the document with its own name and
            cursor while it works.
          </p>
          <h3>Hosted MCP</h3>
          <p className="connect-body">
            Any standards-compatible MCP client can connect to{" "}
            <code className="connect-inline-code">
              {TEXTTEXT_HOSTED_MCP_URL}
            </code>{" "}
            with a workspace token. Create and revoke one at{" "}
            <Link href="/connect">Connect</Link>. TextText does not run an OAuth
            authorization server: a token is one thing to understand and one
            thing to take away.
          </p>
          <div className="connect-code-wrap">
            <pre className="connect-code">{tokenConfig}</pre>
          </div>
        </details>

        <section className="connect-section">
          <h2 className="connect-section-title">Troubleshooting</h2>
          <h3>The client shows no TextText tools</h3>
          <p className="connect-body">
            Restart the AI client after installing the plugin. If approval was
            interrupted, remove the connection and install it again.
          </p>
          <h3>A write was rejected as a conflict</h3>
          <p className="connect-body">
            The document changed after the agent read it. Ask the agent to read
            the latest version, merge the intended edit, and retry.
          </p>
          <h3>Manage or revoke access</h3>
          <p className="connect-body">
            Open <Link href="/connect">Connect</Link> to see every approved app
            and revoke one without changing your Claude, Codex, or ChatGPT
            account.
          </p>
        </section>

        <details className="connect-section connect-advanced">
          <summary className="connect-section-title">Tool reference</summary>
          <h3>Read tools ({READ_TOOLS.length})</h3>
          <ToolTable names={READ_TOOLS} />
          <h3>Mutation tools ({TEXTTEXT_TOOLS.length})</h3>
          <ToolTable names={TEXTTEXT_TOOLS} />
        </details>
      </main>
    </div>
  );
}
