// /docs/mcp: the complete MCP reference, both directions.
//
// The tool table is GENERATED from the registry the server actually serves, not
// transcribed from it. A hand-written list of 33 tools is a list that is wrong
// within a month, and a reference nobody can trust is worse than no reference:
// an agent author reads it, writes code against a tool that was renamed, and
// concludes the product is broken. Adding a tool to WORKSPACE_TOOL_DEFINITIONS
// puts it on this page in the same commit, with its real description.

import type { Metadata } from "next";
import Link from "next/link";
import {
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
  type WorkspaceToolName,
} from "@/lib/ai/tools";
import {
  TEXTTEXT_CLAUDE_CODE_MCP_CONFIG,
  TEXTTEXT_CODEX_MCP_CONFIG,
  TEXTTEXT_CURSOR_MCP_CONFIG,
  TEXTTEXT_VSCODE_MCP_CONFIG,
} from "@/lib/agent-mcp-configs";
import {
  AGENT_CONNECTION_CHECK_PROMPT,
  TEXTTEXT_HOSTED_MCP_URL,
} from "@/lib/agent-integrations";
import "@/styles/connect.css";
import "@/styles/docs-mcp.css";

export const metadata: Metadata = {
  title: "MCP reference",
  description:
    "Every TextText MCP tool, bearer-authenticated remote setup, and how to connect other MCP servers to your assistant.",
};

const MCP_URL = TEXTTEXT_HOSTED_MCP_URL;

/** How the tools group for a reader. Each tool appears exactly once. */
const GROUPS: Array<{
  id: string;
  title: string;
  blurb: string;
  match: (name: WorkspaceToolName) => boolean;
}> = [
  {
    id: "reading",
    title: "Reading",
    blurb:
      "Never mutate anything and need only read access. Safe to call without confirmation.",
    match: (name) => WORKSPACE_TOOL_DEFINITIONS[name].mutability === "read",
  },
  {
    id: "writing",
    title: "Writing",
    blurb:
      "Create and change documents. Every call writes an audit row. A client can supply the current content hash to refuse a stale write.",
    match: (name) => {
      const tool = WORKSPACE_TOOL_DEFINITIONS[name];
      return tool.mutability === "write" && tool.confirmation === "none";
    },
  },
  {
    id: "audience",
    title: "Audience and access",
    blurb:
      "Change who can see something. These ask for confirmation first, and the web assistant is not given them at all.",
    match: (name) =>
      WORKSPACE_TOOL_DEFINITIONS[name].confirmation === "audience",
  },
  {
    id: "destructive",
    title: "Destructive",
    blurb:
      "Remove or replace. These ask for confirmation first, and the web assistant is not given them at all.",
    match: (name) =>
      WORKSPACE_TOOL_DEFINITIONS[name].confirmation === "destructive",
  },
];

/**
 * Registry descriptions are written for the MODEL: several carry a whole
 * procedure and a warning. That is right for a tool call and wrong for a person
 * scanning a page for one name, so the first sentence leads and the rest stays
 * one disclosure away rather than being cut. An agent author still gets every
 * word the agent gets.
 */
function splitDescription(text: string): { lead: string; rest: string } {
  const match = /^(.*?[.!?])(\s+)(.+)$/s.exec(text.trim());
  if (!match || match[1].length > 200) return { lead: text.trim(), rest: "" };
  return { lead: match[1], rest: match[3].trim() };
}

function groupedTools() {
  const seen = new Set<WorkspaceToolName>();
  return GROUPS.map((group) => {
    const names = WORKSPACE_TOOL_NAMES.filter(
      (name) => !seen.has(name) && group.match(name),
    );
    for (const name of names) seen.add(name);
    return { ...group, names };
  });
}

const CLIENTS: Array<{
  id: string;
  name: string;
  steps: string[];
  code?: { label: string; value: string };
}> = [
  {
    id: "codex",
    name: "Codex",
    steps: [
      "Create a revocable workspace token at Connect.",
      "Provide it to the Codex process as TEXTTEXT_WORKSPACE_TOKEN through your credential or environment manager. Do not put the token in this command.",
      "Run the copyable command below. It saves the endpoint and only the environment variable name.",
      "Start a new Codex task and run the shared connection proof below.",
    ],
    code: {
      label: "Codex command",
      value: TEXTTEXT_CODEX_MCP_CONFIG,
    },
  },
  {
    id: "claude-code",
    name: "Claude Code",
    steps: [
      "Create a revocable workspace token at Connect.",
      "Put the configuration below in .mcp.json for a project. Keep the token itself out of the file.",
      "Provide TEXTTEXT_WORKSPACE_TOKEN through the environment that launches Claude Code, approve the project server, and check /mcp.",
      "Start a new Claude Code session and run the shared connection proof below.",
    ],
    code: {
      label: ".mcp.json",
      value: TEXTTEXT_CLAUDE_CODE_MCP_CONFIG,
    },
  },
  {
    id: "cursor",
    name: "Cursor",
    steps: [
      "Create a revocable workspace token at Connect.",
      "Put the configuration below in ~/.cursor/mcp.json for every project, or .cursor/mcp.json for one project.",
      "Provide TEXTTEXT_WORKSPACE_TOKEN through the environment that launches Cursor, then enable the TextText server.",
      "Start a new Cursor conversation and run the shared connection proof below.",
    ],
    code: {
      label: "Cursor mcp.json",
      value: TEXTTEXT_CURSOR_MCP_CONFIG,
    },
  },
  {
    id: "vscode",
    name: "VS Code",
    steps: [
      "Create a revocable workspace token at Connect.",
      "Open MCP: Open User Configuration and paste the configuration below.",
      "Start the TextText server. VS Code asks for the token once as a masked input and keeps it in secure storage.",
      "Start a new agent conversation and run the shared connection proof below.",
    ],
    code: {
      label: "VS Code mcp.json",
      value: TEXTTEXT_VSCODE_MCP_CONFIG,
    },
  },
  {
    id: "oauth-only",
    name: "Claude and Claude Desktop connectors",
    steps: [
      "Claude and Claude Desktop remote connectors currently accept authless or OAuth servers, not a manually supplied bearer token.",
      "TextText does not currently provide an OAuth authorization server, so do not add the hosted endpoint there and expect it to authenticate.",
      "On this Mac, use the token-free TextText plugin in Claude Code. Otherwise use Codex, Cursor, VS Code, or another client with protected bearer headers.",
    ],
  },
  {
    id: "bearer-client",
    name: "Another bearer-authenticated MCP client",
    steps: [
      "Create a revocable workspace token at Connect.",
      "Add the endpoint below only in a client that provides a protected bearer-credential or Authorization-header field.",
      "Save the token in that protected field, enable the server, and run the shared connection proof below.",
      "If the client is OAuth-only, it is not compatible with this endpoint today.",
    ],
    code: {
      label: "MCP endpoint",
      value: MCP_URL,
    },
  },
];

export default function McpReferencePage() {
  const groups = groupedTools();
  const readCount =
    groups.find((group) => group.id === "reading")?.names.length ?? 0;

  return (
    <div className="applecms connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">Reference</p>
        <h1 className="connect-title">MCP</h1>
        <p className="connect-lede">
          TextText speaks MCP in both directions. A bearer-authenticated client
          can work on your documents through the hosted server, and your own
          assistant can use tools from servers you connect to it.
        </p>

        <section className="connect-section" id="endpoint">
          <h2 className="connect-section-title">The endpoint</h2>
          <p className="connect-body">
            One address, Streamable HTTP, and a workspace token you create and
            save in the client&apos;s protected bearer-credential field.
          </p>
          <pre className="docs-code" aria-label="TextText MCP endpoint">
            <code>{MCP_URL}</code>
          </pre>
          <p className="connect-body">
            Create a token at <Link href="/connect">Connect</Link>, and revoke
            it there. The hosted endpoint does not currently provide the OAuth
            authorization flow required by some connector galleries.
          </p>
        </section>

        <section className="connect-section" id="clients">
          <h2 className="connect-section-title">Connect a client</h2>
          <p className="connect-body">
            Use the hosted endpoint only when the client accepts a bearer token.
            For local Claude or Codex, the recommended path is the token-free
            TextText plugin described in the{" "}
            <Link href="/docs/ai#external-agent">connection guide</Link>.
          </p>
          <div className="docs-clients">
            {CLIENTS.map((client) => (
              <article className="docs-client" id={client.id} key={client.id}>
                <h3>{client.name}</h3>
                <ol>
                  {client.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {client.code && (
                  <>
                    <p className="docs-code-label">{client.code.label}</p>
                    <pre className="docs-code">
                      <code>{client.code.value}</code>
                    </pre>
                  </>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="connect-section" id="verify">
          <h2 className="connect-section-title">Check that it worked</h2>
          <p className="connect-body">Ask your agent, in its own words:</p>
          <blockquote className="docs-prompt">
            {AGENT_CONNECTION_CHECK_PROMPT}
          </blockquote>
          <p className="connect-body">
            Success is one private note, an exact receipt with title, item id,
            and saved location, followed by a read of that same item id. Retry
            the prompt with the same idempotency key to confirm that it does not
            create a duplicate.
          </p>
          <p className="connect-body">
            If the tools do not appear, the client is usually still holding an
            older tool list. Restart it, then reconnect.
          </p>
        </section>

        <section className="connect-section" id="tools">
          <h2 className="connect-section-title">
            Tool reference: {WORKSPACE_TOOL_NAMES.length} tools
          </h2>
          <p className="connect-body">
            {readCount} of them only read. This list is generated from the
            server&apos;s own registry, so it is what your client will actually
            receive.
          </p>
          {groups.map((group) => (
            <div
              className="docs-tool-group"
              id={`tools-${group.id}`}
              key={group.id}
            >
              <h3>
                {group.title} <span>{group.names.length}</span>
              </h3>
              <p className="connect-body">{group.blurb}</p>
              <dl className="docs-tool-list">
                {group.names.map((name) => {
                  const { lead, rest } = splitDescription(
                    WORKSPACE_TOOL_DEFINITIONS[name].description,
                  );
                  return (
                    <div className="docs-tool" key={name}>
                      <dt>
                        <code>{name}</code>
                      </dt>
                      <dd>
                        {lead}
                        {rest && (
                          <details className="docs-tool-more">
                            <summary>What the agent is also told</summary>
                            <p>{rest}</p>
                          </details>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          ))}
        </section>

        <section className="connect-section" id="outbound">
          <h2 className="connect-section-title">
            The other direction: connect a server to TextText
          </h2>
          <p className="connect-body">
            Your assistant can also be a client. Connect an MCP server in
            Workspace Settings and its tools join the ones your assistant
            already has, so &quot;put this spec in Figma&quot; and &quot;write
            up what you did in TextText&quot; are the same conversation from
            either end.
          </p>
          <ol className="docs-verify">
            <li>
              Workspace Settings, then Connected MCP servers, then Add server.
            </li>
            <li>
              Give it a name and its https address, and an access token if that
              server needs one. TextText connects once to see what it offers.
            </li>
            <li>
              It is saved switched OFF. Turn on Allow when you want your
              assistant to use it.
            </li>
          </ol>
          <p className="connect-body">
            The name becomes the namespace: a tool called{" "}
            <code>create_frame</code> on a connection named Figma reaches your
            assistant as <code>figma__create_frame</code>, so a connected server
            can never shadow one of TextText&apos;s own tools.
          </p>
          <h3>Servers on your own machine</h3>
          <p className="connect-body">
            Paper, pen.dev, and Figma can expose desktop MCP servers tied to the
            app&apos;s current file or selection. Paper listens on{" "}
            <code>127.0.0.1:29979</code>. A loopback address is reachable only
            from that Mac, not from TextText&apos;s servers. Outbound TextText
            MCP connections use a public https address in this release, so these
            loopback endpoints are not offered in Workspace Settings.
          </p>
          <p className="connect-body">
            TextText&apos;s local Claude and Codex integration is different: the
            standalone Mac app bundles a signed-in CLI for working on TextText
            documents. It does not turn TextText into a client for another
            app&apos;s loopback MCP server.
          </p>
        </section>

        <section className="connect-section" id="safety">
          <h2 className="connect-section-title">
            What holds in both directions
          </h2>
          <ul className="connect-feature-list">
            <li>
              Every request is scoped to one workspace, and visibility fails
              closed. Notes and bookmarks stay unlisted.
            </li>
            <li>
              TextText workspace mutations write an audit row with the
              authenticated account. Connected-server tool calls stay named in
              the assistant conversation.
            </li>
            <li>
              A write that supplies the current content hash refuses a stale
              read instead of overwriting newer content. The guarded local CLI
              supplies that hash for edits.
            </li>
            <li>
              A connected server&apos;s tool names, descriptions and results are
              treated as data. If one tries to instruct your assistant, the
              assistant is told plainly that it is reading somebody else&apos;s
              text, and it will tell you what happened.
            </li>
            <li>
              A remote connected server&apos;s address is re-checked before
              every connection and must resolve to a public host. Its access
              token is encrypted at rest and never shown back to any browser.
            </li>
          </ul>
          <p className="connect-body">
            <Link href="/docs/security">Security and privacy</Link> covers what
            stays on your machine and how to revoke access.
          </p>
        </section>
      </main>
    </div>
  );
}
