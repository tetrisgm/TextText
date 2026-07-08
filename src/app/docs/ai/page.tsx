// /docs/ai: the human-readable guide to connecting ChatGPT or another agent.
// The machine-readable platform guide is /llms.txt; owner tokens live at
// /connect, and OAuth clients can self-register at /oauth/register.

import type { Metadata } from "next";
import Link from "next/link";
import { rootDomainUrl } from "@/lib/site-url";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "Connect ChatGPT or any AI",
  description:
    "OAuth, OpenAPI, MCP, and sync setup for connecting an AI tool to Write.",
};

const ACTIONS: Array<[name: string, what: string]> = [
  ["listFolders", "Get the workspace and folder ids."],
  ["createFolder", "Create a subfolder under an existing folder path."],
  ["listItems", "List markdown items in a folder with hashes."],
  ["readMarkdownItem", "Read one item as a markdown file."],
  ["createMarkdownItem", "Create a draft article, note, or bookmark."],
  ["updateMarkdownItem", "Replace one markdown file with If-Match conflict checks."],
];

export default function AiDocsPage() {
  const origin = rootDomainUrl().origin;

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

  const mcpConfig = `{
  "mcpServers": {
    "write": {
      "url": "${origin}/api/mcp",
      "headers": {
        "Authorization": "Bearer <wsk token>"
      }
    }
  }
}`;

  return (
    <div className="applecms connect-shell">
      <main className="connect-main connect-doc">
        <h1 className="connect-title">Connect ChatGPT or any AI</h1>
        <p className="connect-lede">
          Write exposes one owner workspace as folders of markdown files.
          ChatGPT Actions can import{" "}
          <code className="connect-inline-code">{origin}/openapi.json</code>
          . MCP clients can use{" "}
          <code className="connect-inline-code">{origin}/api/mcp</code>.
        </p>

        <section className="connect-section">
          <h2 className="connect-section-title">OAuth setup</h2>
          <p className="connect-body">
            Register the AI client first. The response contains a{" "}
            <code className="connect-inline-code">client_id</code> and stores
            the exact redirect URI allowlist for future authorization.
          </p>
          <div className="connect-code-wrap">
            <pre className="connect-code">{registrationExample}</pre>
          </div>
          <ul>
            <li>
              Metadata:{" "}
              <code className="connect-inline-code">
                {origin}/.well-known/oauth-authorization-server
              </code>
            </li>
            <li>
              Authorize:{" "}
              <code className="connect-inline-code">
                {origin}/oauth/authorize
              </code>
            </li>
            <li>
              Token:{" "}
              <code className="connect-inline-code">{origin}/oauth/token</code>
            </li>
            <li>
              Scope: <code className="connect-inline-code">sync</code>
            </li>
            <li>PKCE: S256, public client, no client secret.</li>
          </ul>
          <p className="connect-body">
            The OAuth token is a Write{" "}
            <code className="connect-inline-code">wsk_</code> bearer token
            with the sync scope. It can read and write the signed-in owner's
            workspace and can be revoked from <Link href="/connect">Connect</Link>.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">ChatGPT Actions</h2>
          <p className="connect-body">
            Import this OpenAPI URL:
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

        <section className="connect-section">
          <h2 className="connect-section-title">MCP option</h2>
          <p className="connect-body">
            MCP clients can use the same token with the streamable HTTP
            endpoint. Create a token manually from <Link href="/connect">Connect</Link>{" "}
            when the client does not support OAuth.
          </p>
          <div className="connect-code-wrap">
            <pre className="connect-code">{mcpConfig}</pre>
          </div>
        </section>
      </main>
    </div>
  );
}
