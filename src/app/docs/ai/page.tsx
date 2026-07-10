// /docs/ai: the human-readable guide to connecting an AI to Write.
// The click-to-approve path is the MCP endpoint plus OAuth discovery
// (/.well-known/oauth-protected-resource -> /.well-known/oauth-authorization-server).
// The machine-readable platform guide is /llms.txt; owner tokens live at
// /connect, and OAuth clients can self-register at /oauth/register.

import type { Metadata } from "next";
import Link from "next/link";
import { rootDomainUrl } from "@/lib/site-url";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "Connect your AI",
  description:
    "Connect ChatGPT, Claude, Claude Code, Cursor, or any MCP client to Write. Paste one URL and click Approve.",
};

const ACTIONS: Array<[name: string, what: string]> = [
  ["listFolders", "Get the workspace and folder ids."],
  ["createFolder", "Create a subfolder under an existing folder path."],
  ["listItems", "List markdown items in a folder with hashes."],
  ["readMarkdownItem", "Read one item as a markdown file."],
  ["createMarkdownItem", "Create a draft article, note, or bookmark."],
  ["updateMarkdownItem", "Replace one markdown file with If-Match conflict checks."],
];

const MCP_TOOLS: Array<[name: string, kind: "Read" | "Write", what: string]> = [
  ["list_folders", "Read", "List the workspace folders with paths and modes."],
  ["list_items", "Read", "List the markdown items in a folder."],
  ["read_item", "Read", "Read one item as markdown with metadata."],
  ["search", "Read", "Search items across the workspace."],
  ["create_folder", "Write", "Create a subfolder under an existing folder."],
  ["create_item", "Write", "Create a draft article, note, or bookmark."],
  ["update_item", "Write", "Replace an item's markdown and metadata."],
  ["append_to_item", "Write", "Append markdown to the end of an item."],
];

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

export default function AiDocsPage() {
  const origin = rootDomainUrl().origin;
  const mcpUrl = `${origin}/api/mcp`;
  const cursorInstallUrl = `cursor://anysphere.cursor-deeplink/mcp/install?name=write&config=${encodeURIComponent(
    base64(JSON.stringify({ url: mcpUrl })),
  )}`;
  const vscodeInstallUrl = `vscode:mcp/install?${encodeURIComponent(
    JSON.stringify({ name: "write", type: "http", url: mcpUrl }),
  )}`;

  const registrationExample = `POST ${origin}/oauth/register
Content-Type: application/json

{
  "client_name": "ChatGPT",
  "redirect_uris": ["https://chat.openai.com/aip/oauth/callback"],
  "grant_types": ["authorization_code"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "scope": "sync"
}`;

  const claudeCodeCommand = `claude mcp add --transport http write ${mcpUrl}`;

  const cursorConfig = `{
  "mcpServers": {
    "write": {
      "url": "${mcpUrl}"
    }
  }
}`;

  const tokenConfig = `{
  "mcpServers": {
    "write": {
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer <wsk token>"
      }
    }
  }
}`;

  return (
    <div className="applecms connect-shell">
      <main className="connect-main connect-doc">
        <h1 className="connect-title">Connect your AI</h1>
        <p className="connect-lede">
          Write speaks MCP. Give any AI this one URL and approve it once:{" "}
          <code className="connect-inline-code">{mcpUrl}</code>. The AI can
          then read and write your folders and markdown items. Every change it
          makes is logged, notes and bookmarks stay unlisted, and you can
          revoke access anytime from <Link href="/connect">Connect</Link>.
        </p>

        <section className="connect-section">
          <h2 className="connect-section-title">ChatGPT</h2>
          <ul>
            <li>Open Settings, then Connectors, then Create.</li>
            <li>
              Paste{" "}
              <code className="connect-inline-code">{mcpUrl}</code> as the MCP
              server URL.
            </li>
            <li>
              ChatGPT opens a Write approval page. Sign in if needed and click
              Approve.
            </li>
          </ul>
          <p className="connect-body">
            Creating and editing items requires connector write access, which
            ChatGPT gates behind developer mode on paid plans. Read-only use
            works everywhere connectors do.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Claude</h2>
          <ul>
            <li>
              On claude.ai or in Claude Desktop, open Settings, then
              Connectors, then Add custom connector.
            </li>
            <li>
              Paste <code className="connect-inline-code">{mcpUrl}</code> and
              click Add.
            </li>
            <li>Claude opens a Write approval page. Click Approve.</li>
          </ul>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Claude Code</h2>
          <p className="connect-body">Run this once, then approve in the browser:</p>
          <div className="connect-code-wrap">
            <pre className="connect-code">{claudeCodeCommand}</pre>
          </div>
          <p className="connect-body">
            Use <code className="connect-inline-code">/mcp</code> inside Claude
            Code to check the connection or re-authenticate.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Cursor, VS Code, and other MCP editors</h2>
          <p className="connect-body">One-click installs:</p>
          <p className="connect-link-actions">
            <a className="ac-btn ac-btn-filled" href={cursorInstallUrl}>
              Add to Cursor
            </a>{" "}
            <a className="ac-btn ac-btn-gray" href={vscodeInstallUrl}>
              Add to VS Code
            </a>
          </p>
          <p className="connect-body">
            Or add Write to the editor&apos;s MCP config by hand (Cursor:{" "}
            <code className="connect-inline-code">.cursor/mcp.json</code>, VS
            Code: <code className="connect-inline-code">.vscode/mcp.json</code>
            ). The editor walks the same approval flow on first use.
          </p>
          <div className="connect-code-wrap">
            <pre className="connect-code">{cursorConfig}</pre>
          </div>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">What a connected AI can do</h2>
          <div className="connect-table-wrap">
            <table className="connect-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Access</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                {MCP_TOOLS.map(([name, kind, what]) => (
                  <tr key={name}>
                    <td>
                      <code className="connect-inline-code">{name}</code>
                    </td>
                    <td>{kind}</td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Clients without OAuth, and local models</h2>
          <p className="connect-body">
            If a client cannot open an approval page, mint a token manually
            from <Link href="/connect">Connect</Link> and pass it as a bearer
            header:
          </p>
          <div className="connect-code-wrap">
            <pre className="connect-code">{tokenConfig}</pre>
          </div>
          <p className="connect-body">
            Local models such as Ollama do not connect to MCP servers by
            themselves. Run them inside an MCP-capable host (for example LM
            Studio or mcphost) and use the token config above.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">How approval works</h2>
          <ul>
            <li>
              The MCP endpoint answers unauthenticated requests with a pointer
              to{" "}
              <code className="connect-inline-code">
                {origin}/.well-known/oauth-protected-resource
              </code>
              .
            </li>
            <li>
              That names this origin as the authorization server, described at{" "}
              <code className="connect-inline-code">
                {origin}/.well-known/oauth-authorization-server
              </code>
              .
            </li>
            <li>
              Clients self-register at{" "}
              <code className="connect-inline-code">{origin}/oauth/register</code>{" "}
              and send you to{" "}
              <code className="connect-inline-code">{origin}/oauth/authorize</code>{" "}
              to click Approve. PKCE S256, public client, scope{" "}
              <code className="connect-inline-code">sync</code>.
            </li>
            <li>
              The resulting token is a Write{" "}
              <code className="connect-inline-code">wsk_</code> bearer token
              scoped to your workspace. Revoke it anytime from{" "}
              <Link href="/connect">Connect</Link>.
            </li>
          </ul>
          <p className="connect-body">
            Zero-config discovery for client developers:{" "}
            <code className="connect-inline-code">
              {origin}/.well-known/mcp.json
            </code>{" "}
            names this server and its endpoint. Manual registration, for
            developers wiring their own client:
          </p>
          <div className="connect-code-wrap">
            <pre className="connect-code">{registrationExample}</pre>
          </div>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Security</h2>
          <ul>
            <li>
              Approval grants access to your one workspace, nothing else. The
              consent page names the app requesting it.
            </li>
            <li>
              Every change a connected AI makes is written to the audit log,
              and notes and bookmarks stay unlisted no matter who is calling.
            </li>
            <li>
              Revoke any connection at any time from{" "}
              <Link href="/connect">Connect</Link>. Revocation is immediate.
            </li>
            <li>
              Content an AI reads can carry instructions (prompt injection).
              Prefer clients that ask you to confirm each write, and treat
              unexpected tool calls as a reason to stop and review.
            </li>
            <li>
              Only connect clients you trust: a connected AI can read and
              write your workspace the way you can.
            </li>
          </ul>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">ChatGPT Actions</h2>
          <p className="connect-body">
            Custom GPTs can import the OpenAPI description instead of MCP:
          </p>
          <p>
            <code className="connect-inline-code">{origin}/openapi.json</code>
          </p>
          <div className="connect-table-wrap">
            <table className="connect-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                {ACTIONS.map(([name, what]) => (
                  <tr key={name}>
                    <td>
                      <code className="connect-inline-code">{name}</code>
                    </td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="connect-body">
            Updates replace the whole markdown file. Send{" "}
            <code className="connect-inline-code">If-Match</code> with the
            last ETag or manifest hash. If the item changed, Write returns 412
            so the AI can read, merge, and retry.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Content rules</h2>
          <ul>
            <li>
              Blog folder kinds are{" "}
              <code className="connect-inline-code">article</code>,{" "}
              <code className="connect-inline-code">media_post</code>, and{" "}
              <code className="connect-inline-code">video_post</code>.
              Create public writing as drafts unless the owner asks to publish.
            </li>
            <li>
              Notes use <code className="connect-inline-code">note</code> and
              bookmarks use{" "}
              <code className="connect-inline-code">bookmark</code>. Both stay
              private and unlisted.
            </li>
            <li>Ask before publishing. Ask before deleting.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
