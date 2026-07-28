// /docs/ai: the canonical hosted OAuth setup and tool reference for Texttext MCP.

import type { Metadata } from "next";
import Link from "next/link";
import {
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
} from "@/lib/ai/tools";
import "@/styles/connect.css";

const MCP_URL = "https://texttext.app/api/mcp";
const READ_TOOLS = WORKSPACE_TOOL_NAMES.filter(
  (name) => WORKSPACE_TOOL_DEFINITIONS[name].mutability === "read",
);
const WRITE_TOOLS = WORKSPACE_TOOL_NAMES.filter(
  (name) => WORKSPACE_TOOL_DEFINITIONS[name].mutability === "write",
);

export const metadata: Metadata = {
  title: "Connect your AI to Texttext",
  description: `Connect an AI assistant to Texttext's ${WORKSPACE_TOOL_NAMES.length} workspace tools.`,
};

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

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

export default function AiDocsPage() {
  const cursorInstallUrl = `cursor://anysphere.cursor-deeplink/mcp/install?name=write&config=${encodeURIComponent(
    base64(JSON.stringify({ url: MCP_URL })),
  )}`;
  const cursorConfig = `{ "mcpServers": { "write": { "url": "${MCP_URL}" } } }`;
  const vscodeConfig = `{ "servers": { "write": { "type": "http", "url": "${MCP_URL}" } } }`;
  const codexConfig = `[mcp_servers.write]\nurl = "${MCP_URL}"`;
  const remoteConfig = `{
  "mcpServers": { "write": { "command": "npx", "args": ["-y", "mcp-remote", "${MCP_URL}"] } }
}`;
  const tokenConfig = `{
  "mcpServers": { "write": { "url": "${MCP_URL}", "headers": { "Authorization": "Bearer wsk_..." } } }
}`;

  return (
    <div className="applecms connect-shell">
      <main className="connect-main connect-doc">
        <h1 className="connect-title">Connect your AI to Texttext</h1>

        <section className="connect-section">
          <h2 className="connect-section-title">Overview</h2>
          <p className="connect-body">
            An MCP server is an authenticated API that an AI assistant can call
            on your behalf. Connect one once, and your assistant can read and
            write your Texttext workspace from wherever it runs.
          </p>
          <p className="connect-body">
            Texttext&apos;s server reads and writes the folders and markdown items in
            your one workspace. It respects your sharing, keeps notes and
            bookmarks unlisted, and logs every change.
          </p>
          <div className="connect-code-wrap">
            <pre className="connect-code">{MCP_URL}</pre>
          </div>
          <p className="connect-body">
            <code className="connect-inline-code">read</code> inspects and{" "}
            <code className="connect-inline-code">sync</code> also writes. The
            approval page shows which scope a client asked for.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Getting started</h2>

          <h3>Claude Code (CLI)</h3>
          <div className="connect-code-wrap">
            <pre className="connect-code">
              {`claude mcp add --transport http write ${MCP_URL}\n/mcp\nThen approve in your browser.`}
            </pre>
          </div>

          <h3>Claude Desktop / claude.ai</h3>
          <div className="connect-code-wrap">
            <pre className="connect-code">
              {`Settings → Connectors → Add custom connector\nPaste ${MCP_URL} → Add\nApprove in your browser.`}
            </pre>
          </div>

          <h3>Cursor</h3>
          <p className="connect-link-actions">
            <a className="ac-btn ac-btn-filled" href={cursorInstallUrl}>
              Add to Cursor
            </a>
          </p>
          <div className="connect-code-wrap">
            <pre className="connect-code">{`.cursor/mcp.json\n${cursorConfig}\nThen approve in your browser.`}</pre>
          </div>

          <h3>VS Code / Copilot</h3>
          <div className="connect-code-wrap">
            <pre className="connect-code">{`.vscode/mcp.json\n${vscodeConfig}\nThen approve in your browser.`}</pre>
          </div>

          <h3>Codex CLI</h3>
          <div className="connect-code-wrap">
            <pre className="connect-code">{`~/.codex/config.toml: ${codexConfig}\nThen approve in your browser.`}</pre>
          </div>

          <h3>Any other client</h3>
          <p className="connect-body">Use the mcp-remote fallback:</p>
          <div className="connect-code-wrap">
            <pre className="connect-code">{remoteConfig}</pre>
          </div>
          <p className="connect-body">
            If the host does not support OAuth, mint a{" "}
            <code className="connect-inline-code">sync</code> token at{" "}
            <Link href="/connect">Connect</Link> and send it as a bearer header:
          </p>
          <div className="connect-code-wrap">
            <pre className="connect-code">{tokenConfig}</pre>
          </div>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Verifying the connection</h2>
          <p className="connect-body">
            Ask your assistant: <em>&quot;What folders are in my Texttext workspace?&quot;</em>{" "}
            It calls <code className="connect-inline-code">list_folders</code>,
            asks to connect if it has not, and lists Blog, Notes, and Bookmarks.
          </p>
          <p className="connect-body">
            To verify writes, ask: <em>&quot;Create a draft note in Texttext titled
            &apos;MCP test&apos;.&quot;</em> It creates a draft in Notes and nothing goes
            public.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Troubleshooting</h2>
          <h3>Reconnect a stale session</h3>
          <p className="connect-body">
            The most common problem is a long-running assistant session that
            connected before you approved access. Restart the session, or run{" "}
            <code className="connect-inline-code">/mcp</code> in Claude Code,
            and try again.
          </p>
          <h3>The client shows no Texttext tools</h3>
          <p className="connect-body">
            Restart the MCP host after editing its configuration.
          </p>
          <h3>Approval page will not open</h3>
          <p className="connect-body">
            The client does not support OAuth. Mint a token at{" "}
            <Link href="/connect">Connect</Link> and use the bearer-header
            configuration above.
          </p>
          <h3>A write was rejected as a conflict</h3>
          <p className="connect-body">
            The item changed since you read it. Read it again and retry. This
            is the content hash guard working.
          </p>
          <h3>Read-only connection</h3>
          <p className="connect-body">
            You approved <code className="connect-inline-code">read</code>.
            Reconnect and approve <code className="connect-inline-code">sync</code>{" "}
            to write.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Guides</h2>

          <h3>Capture research into Notes</h3>
          <p className="connect-body">
            <strong>Prompt:</strong> &quot;Research the current EU AI Act enforcement
            timeline and save what you find as a note in my Texttext workspace.&quot;
          </p>
          <p className="connect-body">
            The assistant calls <code className="connect-inline-code">get_workspace</code>,{" "}
            <code className="connect-inline-code">list_folders</code>, then{" "}
            <code className="connect-inline-code">create_item</code> in the Notes
            folder. As it gathers more, it uses{" "}
            <code className="connect-inline-code">append_to_item</code> so it does
            not rewrite the whole body. It reads the item back to confirm. The
            note stays a draft and remains unlisted forever. The{" "}
            <code className="connect-inline-code">markdown_fragment</code> input is
            part of the external MCP flow shown here. The in-app assistant uses
            the shared workspace command surface directly.
          </p>

          <h3>Publish a drafted article</h3>
          <p className="connect-body">
            <strong>Prompt:</strong> &quot;Polish my &apos;Ship logs&apos; draft in Texttext and
            publish it.&quot;
          </p>
          <p className="connect-body">
            The assistant searches for the draft, reads its markdown, tags, and
            current hash, then calls <code className="connect-inline-code">update_item</code>{" "}
            with the edited body, complete tag list, and hash. Publishing changes
            the audience, so it asks for confirmation before calling{" "}
            <code className="connect-inline-code">set_item_status</code>. If the
            hash is stale, it reads, merges, and retries.
          </p>

          <h3>Sync tags across a workspace</h3>
          <p className="connect-body">
            <strong>Prompt:</strong> &quot;Find every Texttext post tagged &apos;draft-idea&apos;
            and add the tag &apos;q3&apos; to each.&quot;
          </p>
          <p className="connect-body">
            The assistant searches or lists folders, reads each match for its{" "}
            <code className="connect-inline-code">tags</code> and current hash,
            then calls <code className="connect-inline-code">update_item</code>{" "}
            once per item. Tags are a full-list replacement, so it sends the
            existing tags plus <code className="connect-inline-code">q3</code>.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Reference</h2>
          <h3>Read tools ({READ_TOOLS.length})</h3>
          <p className="connect-body">Any connected assistant can call these.</p>
          <ToolTable names={READ_TOOLS} />

          <h3>Texttext tools ({WRITE_TOOLS.length})</h3>
          <p className="connect-body">
            These require the <code className="connect-inline-code">sync</code>{" "}
            scope. Texttext marks publishing, moving to Trash, restoring, and
            sharing as destructive or audience-changing. Clients that support
            confirmations will ask you first.
          </p>
          <ToolTable names={WRITE_TOOLS} />

          <ul>
            <li>The approval page shows the client name and requested scope.</li>
            <li>Every mutation is recorded in the action audit log.</li>
            <li>Delete tools only move content to Trash.</li>
            <li>Revoke a connection anytime from <Link href="/connect">Connect</Link>.</li>
            <li>
              Content can contain prompt injection. Stop and review unexpected
              tool calls.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
