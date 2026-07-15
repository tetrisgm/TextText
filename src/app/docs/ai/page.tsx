// /docs/ai: the human-readable guide to connecting an AI to Write.
// The click-to-approve path is the MCP endpoint plus OAuth discovery
// (/.well-known/oauth-protected-resource -> /.well-known/oauth-authorization-server).
// The machine-readable platform guide is /llms.txt; owner tokens live at
// /connect, and OAuth clients can self-register at /oauth/register.

import type { Metadata } from "next";
import Link from "next/link";
import {
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
} from "@/lib/ai/tools";
import { rootDomainUrl } from "@/lib/site-url";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "Connect your AI",
  description:
    "Connect an MCP client to Write's shared 17-tool workspace command surface.",
};

const ACTIONS: Array<[name: string, what: string]> = [
  ["listFolders", "Get the workspace and folder ids."],
  ["createFolder", "Create a subfolder under an existing folder path."],
  ["listItems", "List markdown items in a folder with hashes."],
  ["readMarkdownItem", "Read one item as a markdown file."],
  ["createMarkdownItem", "Create a draft article, note, or bookmark."],
  ["updateMarkdownItem", "Replace one markdown file with If-Match conflict checks."],
];

const MCP_TOOLS = WORKSPACE_TOOL_NAMES.map((name) => {
  const definition = WORKSPACE_TOOL_DEFINITIONS[name];
  return {
    name,
    scope: definition.mutability === "read" ? "read or sync" : "sync",
    what: definition.description,
  };
});

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
  "client_name": "Example MCP Client",
  "redirect_uris": ["https://client.example.com/oauth/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
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
          Write exposes the same 17 workspace commands to MCP clients and its
          on-device Mac assistant. Give an MCP client this URL:{" "}
          <code className="connect-inline-code">{mcpUrl}</code>. The client
          requests either read-only <code className="connect-inline-code">read</code>{" "}
          access or read/write <code className="connect-inline-code">sync</code>{" "}
          access, and the approval page shows which one. Every change is logged,
          notes and bookmarks stay unlisted, and you can revoke access from{" "}
          <Link href="/connect">Connect</Link>.
        </p>

        <section className="connect-section">
          <h2 className="connect-section-title">ChatGPT</h2>
          <ul>
            <li>
              Open Apps in ChatGPT and create a custom MCP app in developer
              mode.
            </li>
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
            Custom MCP app availability and admin approval depend on your
            ChatGPT plan and workspace settings. Write mutations require the{" "}
            <code className="connect-inline-code">sync</code> scope.
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
          <p className="connect-body">
            A <code className="connect-inline-code">read</code> token can call
            the six read tools. A <code className="connect-inline-code">sync</code>{" "}
            token can call all 17 tools.
          </p>
          <div className="connect-table-wrap">
            <table className="connect-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Required scope</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                {MCP_TOOLS.map(({ name, scope, what }) => (
                  <tr key={name}>
                    <td>
                      <code className="connect-inline-code">{name}</code>
                    </td>
                    <td>
                      <code className="connect-inline-code">{scope}</code>
                    </td>
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
            header. Manual tokens carry <code className="connect-inline-code">sync</code>{" "}
            access and remain valid until you revoke them.
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
              to click Approve. The public-client flow uses PKCE S256 and
              requests exactly one scope: <code className="connect-inline-code">read</code>{" "}
              or <code className="connect-inline-code">sync</code>.
            </li>
            <li>
              Approval returns a <code className="connect-inline-code">wsk_</code>{" "}
              access token that expires after one hour and a rotating{" "}
              <code className="connect-inline-code">wrt_</code> refresh token.
              Each refresh replaces both tokens. Reusing a consumed refresh
              token revokes the complete token family.
            </li>
            <li>
              Refresh access expires after 180 days total or 30 days without
              use. Revoke a connection anytime from{" "}
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
              consent page names the app and whether it requests read-only or
              read/write access.
            </li>
            <li>
              <code className="connect-inline-code">read</code> can only inspect
              workspace content. <code className="connect-inline-code">sync</code>{" "}
              also permits mutations. A read-only mutation is rejected before
              its tool handler runs.
            </li>
            <li>
              Every change a connected AI makes is written to the audit log,
              and notes and bookmarks stay unlisted no matter who is calling.
            </li>
            <li>
              <code className="connect-inline-code">delete_item</code> only moves
              an item to Trash. Items can be listed and restored, and MCP has
              no permanent-delete tool.
            </li>
            <li>
              Revoke any connection at any time from{" "}
              <Link href="/connect">Connect</Link>. Revocation is immediate.
            </li>
            <li>
              Content an AI reads can carry instructions (prompt injection).
              Require confirmation for Move to Trash, restore, and publication
              changes, and treat unexpected tool calls as a reason to stop and
              review.
            </li>
            <li>
              Only connect clients you trust. A connected AI can use every
              workspace command allowed by its approved scope.
            </li>
          </ul>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Assistant in Write</h2>
          <p className="connect-body">
            Write for Mac uses Apple&apos;s on-device Foundation Models runtime.
            The assistant calls the same 17 workspace commands directly through
            the signed-in page, so it does not connect back to Write over MCP.
          </p>
          <ul>
            <li>
              Agent commands and quick actions run locally when Apple
              Intelligence is available on macOS 26 or later.
            </li>
            <li>
              Quick actions can summarize, rewrite, suggest a title, suggest
              tags, or suggest an excerpt. Editable results are previewed and
              can be applied or undone.
            </li>
            <li>
              The assistant carries workspace, folder, item, Trash, and exact
              editor-selection context. Images can be processed with private
              on-device OCR when available.
            </li>
          </ul>
          <p className="connect-body">
            The assistant is unavailable in the plain web app and does not
            silently send content to a cloud model. OpenAI and Anthropic are not
            in-app assistant providers. ChatGPT and Claude connect externally
            through MCP using the setup above.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">ChatGPT Actions</h2>
          <p className="connect-body">
            Custom GPTs can import the OpenAPI description instead of MCP. This
            is a smaller sync-backed action surface and requires the{" "}
            <code className="connect-inline-code">sync</code> scope:
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
            <li>
              Ask before publishing, moving an item to Trash, or restoring a
              previously published item. MCP does not expose permanent delete.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
