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
  const localMcpUrl = "http://127.0.0.1:47118/mcp";
  const cursorConfig = `{ "mcpServers": { "texttext": { "url": "${MCP_URL}" } } }`;
  const vscodeConfig = `{ "servers": { "texttext": { "type": "http", "url": "${MCP_URL}" } } }`;
  const remoteConfig = `{
  "mcpServers": { "texttext": { "command": "npx", "args": ["-y", "mcp-remote", "${MCP_URL}"] } }
}`;
  const tokenConfig = `{
  "mcpServers": { "texttext": { "url": "${MCP_URL}", "headers": { "Authorization": "Bearer wsk_..." } } }
}`;

  return (
    <div className="applecms connect-shell">
      <main className="connect-main connect-doc">
        <h1 className="connect-title">Connect your AI to Texttext</h1>

        <section className="connect-section">
          <h2 className="connect-section-title">Three ways to connect</h2>
          <p className="connect-body">
            Claude Code and Codex on this Mac can use Texttext&apos;s local MCP
            bridge while the app is open. It is immediate, stays on this Mac,
            and needs no Texttext token.
          </p>
          <p className="connect-body">
            Claude.ai, hosted Codex, ChatGPT, and other remote clients connect
            to Texttext&apos;s hosted MCP endpoint using OAuth. They open
            Texttext once so you can approve read or sync access.
          </p>
          <div className="connect-code-wrap">
            <pre className="connect-code">{MCP_URL}</pre>
          </div>
          <p className="connect-body">
            The assistant sidebar inside Texttext is separate. It uses a
            workspace-owned Anthropic or OpenAI API key. API billing is separate
            from Claude.ai and ChatGPT subscriptions.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Claude</h2>
          <h3>Claude Code on this Mac</h3>
          <div className="connect-code-wrap">
            <pre className="connect-code">
              {`claude mcp add --transport http --scope user texttext ${localMcpUrl}`}
            </pre>
          </div>
          <p className="connect-body">
            Keep Texttext open. Claude Code can now read and edit the current
            workspace through the local app.
          </p>
          <h3>Claude Code remotely</h3>
          <div className="connect-code-wrap">
            <pre className="connect-code">
              {`claude mcp add --transport http --scope user texttext ${MCP_URL}\n/mcp\nThen approve in your browser.`}
            </pre>
          </div>
          <h3>Claude.ai</h3>
          <div className="connect-code-wrap">
            <pre className="connect-code">
              {`Settings → Connectors → Add custom connector\nPaste ${MCP_URL} → Add\nApprove in your browser.`}
            </pre>
          </div>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Codex</h2>
          <h3>Codex on this Mac</h3>
          <div className="connect-code-wrap">
            <pre className="connect-code">
              {`codex mcp add texttext --url ${localMcpUrl}`}
            </pre>
          </div>
          <p className="connect-body">
            The Codex app and CLI share the same MCP configuration. Keep
            Texttext open while using the local bridge.
          </p>
          <h3>Hosted Texttext</h3>
          <div className="connect-code-wrap">
            <pre className="connect-code">
              {`codex mcp add texttext --url ${MCP_URL}\ncodex mcp login texttext`}
            </pre>
          </div>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">ChatGPT</h2>
          <div className="connect-code-wrap">
            <pre className="connect-code">
              {`Settings or Workspace Settings → Apps\nEnable developer mode → Create\nPaste ${MCP_URL} → Scan tools → Connect\nApprove Texttext in your browser.`}
            </pre>
          </div>
          <p className="connect-body">
            Full MCP apps currently require an eligible ChatGPT workspace plan.
            Your ChatGPT account supplies the model and billing.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Other MCP clients</h2>
          <p className="connect-body">
            Texttext follows the standard MCP and OAuth discovery flow, so
            Cursor, VS Code, and other compatible clients remain supported.
          </p>
          <h3>Cursor</h3>
          <div className="connect-code-wrap">
            <pre className="connect-code">{`.cursor/mcp.json\n${cursorConfig}\nThen approve in your browser.`}</pre>
          </div>
          <h3>VS Code</h3>
          <div className="connect-code-wrap">
            <pre className="connect-code">{`.vscode/mcp.json\n${vscodeConfig}\nThen approve in your browser.`}</pre>
          </div>
          <h3>Legacy stdio-only clients</h3>
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

          <h3>Keep one document per software project</h3>
          <p className="connect-body">
            <strong>Prompt:</strong> &quot;For every project I work on, keep one
            project document in my Texttext Notes folder. Create missing project
            documents, then append a dated changelog entry after every shipped
            update. Use the repository URL as the stable project identity and
            the commit SHA as the update identity.&quot;
          </p>
          <p className="connect-body">
            Hosts that support MCP prompts can start with{" "}
            <code className="connect-inline-code">maintain_project_documents</code>.
            The assistant uses a stable{" "}
            <code className="connect-inline-code">idempotency_key</code> for each{" "}
            <code className="connect-inline-code">create_item</code> and{" "}
            <code className="connect-inline-code">append_to_item</code> call.
            Retrying after a timeout returns the original result instead of
            creating another document or duplicate changelog entry.
          </p>

          <h3>Capture an AI conversation</h3>
          <p className="connect-body">
            <strong>Prompt:</strong> &quot;Save the useful decisions and final answer
            from this conversation as a Texttext note. Preserve the important
            prompts, conclusions, and source context.&quot;
          </p>
          <p className="connect-body">
            Hosts can use the{" "}
            <code className="connect-inline-code">capture_conversation</code>{" "}
            prompt. Texttext also exposes{" "}
            <code className="connect-inline-code">texttext://workspace</code> and{" "}
            <code className="connect-inline-code">texttext://items/&#123;id&#125;</code>{" "}
            resources so capable clients can load relevant context without
            guessing storage paths.
          </p>

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
          <h3>Resources and prompts</h3>
          <p className="connect-body">
            Texttext exposes workspace and item resources plus reusable prompts
            for project journals, conversation capture, and release notes.
            Clients that only support tools can perform the same workflows with
            the tools below.
          </p>

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
