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
import { TEXTTEXT_HOSTED_MCP_URL } from "@/lib/agent-integrations";
import "@/styles/connect.css";
import "@/styles/docs-mcp.css";

export const metadata: Metadata = {
  title: "MCP reference",
  description:
    "Every TextText MCP tool, per-client setup for Claude, Codex, Cursor, ChatGPT, Copilot and Windsurf, and how to connect other MCP servers to your assistant.",
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
      "Create and change documents. Every call writes an audit row and uses a conflict check rather than overwriting newer content.",
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
    match: (name) => WORKSPACE_TOOL_DEFINITIONS[name].confirmation === "audience",
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
    id: "claude-code",
    name: "Claude Code",
    steps: [
      "Install the TextText plugin, which carries the connection and the workflows:",
    ],
    code: {
      label: "Terminal",
      value: "claude plugin marketplace add texttext/texttext\nclaude plugin install texttext@texttext",
    },
  },
  {
    id: "claude-code-manual",
    name: "Claude Code, without the plugin",
    steps: ["Add the endpoint directly:"],
    code: {
      label: "Terminal",
      value: `claude mcp add texttext --transport http ${MCP_URL} --scope user`,
    },
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    steps: [
      "Settings, then Developer, then Edit Config, and add TextText to mcpServers:",
    ],
    code: {
      label: "claude_desktop_config.json",
      value: `{
  "mcpServers": {
    "texttext": {
      "type": "http",
      "url": "${MCP_URL}"
    }
  }
}`,
    },
  },
  {
    id: "codex",
    name: "Codex app and CLI",
    steps: [
      "Install the plugin, or add a Streamable HTTP server pointing at the endpoint:",
    ],
    code: {
      label: "~/.codex/config.toml",
      value: `[mcp_servers.texttext]\nurl = "${MCP_URL}"`,
    },
  },
  {
    id: "cursor",
    name: "Cursor",
    steps: [
      "Settings, then Tools and MCP, then Add. Or write the file directly:",
    ],
    code: {
      label: ".cursor/mcp.json",
      value: `{
  "mcpServers": {
    "texttext": {
      "url": "${MCP_URL}"
    }
  }
}`,
    },
  },
  {
    id: "copilot",
    name: "GitHub Copilot in VS Code",
    steps: ["Create the workspace MCP file:"],
    code: {
      label: ".vscode/mcp.json",
      value: `{
  "servers": {
    "texttext": {
      "type": "http",
      "url": "${MCP_URL}"
    }
  }
}`,
    },
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    steps: [
      "Create a token at Connect and copy it, along with the address below.",
      "In ChatGPT, open Settings, then the connectors area, and add a custom connector using that address with the token as its bearer credential.",
      "Some ChatGPT connector kinds expect an authorization server rather than a pasted token. If yours offers no token field, use Claude, Codex, Cursor or Copilot instead.",
    ],
    code: { label: "Server address", value: MCP_URL },
  },
  {
    id: "windsurf",
    name: "Windsurf and other MCP clients",
    steps: [
      "Any client that speaks Streamable HTTP can use the same address. There is nothing TextText-specific in the transport:",
    ],
    code: { label: "Server address", value: MCP_URL },
  },
];

export default function McpReferencePage() {
  const groups = groupedTools();
  const readCount = groups.find((group) => group.id === "reading")?.names.length ?? 0;

  return (
    <div className="applecms connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">Reference</p>
        <h1 className="connect-title">MCP</h1>
        <p className="connect-lede">
          TextText speaks MCP in both directions. Any client can work on your
          documents through the hosted server, and your own assistant can use
          tools from servers you connect to it.
        </p>

        <section className="connect-section" id="endpoint">
          <h2 className="connect-section-title">The endpoint</h2>
          <p className="connect-body">
            One address, Streamable HTTP, and a workspace token you create and
            paste. It is the same server for every client.
          </p>
          <pre className="docs-code" aria-label="TextText MCP endpoint">
            <code>{MCP_URL}</code>
          </pre>
          <p className="connect-body">
            Create a token at <Link href="/connect">Connect</Link>, and revoke it
            there. Every client authenticates the same way: one thing to
            understand, one thing to take away.
          </p>
        </section>

        <section className="connect-section" id="clients">
          <h2 className="connect-section-title">Connect a client</h2>
          <p className="connect-body">
            Pick yours. The plugin paths also install ready-made workflows; the
            manual paths give the same tools without them.
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
          <ol className="docs-verify">
            <li>
              <em>&quot;What folders are in my TextText workspace?&quot;</em> It
              should ask for approval the first time, then list Blog, Notes and
              Bookmarks.
            </li>
            <li>
              <em>
                &quot;Create a draft note in TextText called MCP test, then read
                it back.&quot;
              </em>{" "}
              The note should appear in your Notes folder while you watch.
            </li>
          </ol>
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
            <div className="docs-tool-group" id={`tools-${group.id}`} key={group.id}>
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
            already has, so &quot;put this spec in Figma&quot; and
            &quot;write up what you did in TextText&quot; are the same
            conversation from either end.
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
            The design tools run locally: Paper listens on{" "}
            <code>127.0.0.1:29979</code>, and pen.dev and Figma ship the same
            shape, because the design file never leaves your Mac. Nothing on the
            internet can reach that address, including TextText&apos;s own
            servers, so a loopback connection works in the{" "}
            <strong>Mac app</strong> and not on the web. The app makes the
            request natively and refuses any address that is not loopback.
          </p>
          <p className="connect-body">
            Local connections do not carry an access token yet. The local design
            servers do not ask for one.
          </p>
        </section>

        <section className="connect-section" id="safety">
          <h2 className="connect-section-title">What holds in both directions</h2>
          <ul className="connect-feature-list">
            <li>
              Every request is scoped to one workspace, and visibility fails
              closed. Notes and bookmarks stay unlisted.
            </li>
            <li>
              Every mutation writes an audit row naming the agent that made it,
              including calls your assistant makes to a connected server.
            </li>
            <li>
              Writes carry a conflict check, so an agent working from a stale
              read is refused rather than allowed to overwrite newer content.
            </li>
            <li>
              A connected server&apos;s tool names, descriptions and results are
              treated as data. If one tries to instruct your assistant, the
              assistant is told plainly that it is reading somebody else&apos;s
              text, and it will tell you what happened.
            </li>
            <li>
              A connected server&apos;s address is re-checked before every
              connection and must resolve to a public host, and its access token
              is encrypted at rest and never shown back to any browser.
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
