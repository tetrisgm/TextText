// /docs/ai: the human-readable guide to pointing an agent at Write. The
// machine version of this page is /llms.txt; tokens live at /connect.

import type { Metadata } from "next";
import Link from "next/link";
import { rootDomainUrl } from "@/lib/site-url";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "Write for AI agents",
  description:
    "How agents read and write a Write blog: tokens, the MCP server, and the file sync API.",
};

const MCP_TOOLS: Array<[name: string, what: string]> = [
  ["list_folders", "The workspace's folders and their modes."],
  ["list_items", "Manifest entries for one folder: id, slug, title, kind, status, hash."],
  ["read_item", "One item as its markdown file."],
  ["create_item", "Create an item in a folder from a whole markdown file."],
  ["update_item", "Replace an item's file, with an optional conflict-checking hash."],
  ["append_to_item", "Add markdown to the end of an item's body."],
  ["search", "Substring search over titles, excerpts, and bodies."],
];

const SYNC_ENDPOINTS: Array<[method: string, path: string, what: string]> = [
  ["GET", "/workspace", "The blog and its folders."],
  ["GET", "/folders/{folderId}/manifest", "Every item in a folder with a sha256 hash per file."],
  ["GET", "/files/{postId}", "One markdown file. The hash is the ETag."],
  ["PUT", "/files/{postId}", "Replace a file. Requires If-Match with the last seen ETag; a stale value answers 412."],
  ["POST", "/files", "Create a post from a markdown file."],
  ["DELETE", "/files/{postId}", "Delete a post. Agents should ask the owner first."],
];

export default function AiDocsPage() {
  const origin = rootDomainUrl().origin;

  const mcpConfig = `{
  "mcpServers": {
    "write": {
      "url": "${origin}/api/mcp",
      "headers": {
        "Authorization": "Bearer <your token>"
      }
    }
  }
}`;

  return (
    <div className="applecms connect-shell">
      <main className="connect-main connect-doc">
        <h1 className="connect-title">Write for AI agents</h1>
        <p className="connect-lede">
          Everything an agent needs to read and write a blog on Write. Tokens
          are minted on the <Link href="/connect">Connect page</Link>; the
          machine-readable version of this page is{" "}
          <a href="/llms.txt">/llms.txt</a>.
        </p>

        <section className="connect-section">
          <h2 className="connect-section-title">How a blog is organized</h2>
          <p className="connect-body">
            A blog is one workspace. A workspace holds folders, and every item
            in a folder is a plain markdown file: single-line{" "}
            <code className="connect-inline-code">key: value</code>{" "}
            frontmatter, then the body. There is no separate API object model
            to learn; what you sync is what the editor edits.
          </p>
          <ul>
            <li>
              <strong>blog</strong>: public writing. Item kinds are{" "}
              <code className="connect-inline-code">article</code>,{" "}
              <code className="connect-inline-code">media_post</code>, and{" "}
              <code className="connect-inline-code">video_post</code>.
              Items are drafts until published.
            </li>
            <li>
              <strong>notes</strong>: private notes. Always unlisted; a note
              never becomes public, whatever its file says.
            </li>
            <li>
              <strong>bookmarks</strong>: private saved links. Also always
              unlisted.
            </li>
          </ul>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Get a token</h2>
          <p className="connect-body">
            Sign in and open <Link href="/connect">Connect</Link>. Create a
            token, name it after the tool it is for, and copy it immediately:
            the raw value is shown exactly once. Every request carries it as{" "}
            <code className="connect-inline-code">
              Authorization: Bearer wsk_...
            </code>
            . Revoking a token on the same page cuts that tool off without
            touching the others.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">MCP server</h2>
          <p className="connect-body">
            The MCP endpoint is{" "}
            <code className="connect-inline-code">{origin}/api/mcp</code>{" "}
            (streamable HTTP). Claude, Cursor, and other MCP clients take a
            config like this:
          </p>
          <div className="connect-code-wrap">
            <pre className="connect-code">{mcpConfig}</pre>
          </div>
          <h3>Tools</h3>
          <div className="connect-table-wrap">
            <table className="connect-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                {MCP_TOOLS.map(([name, what]) => (
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
            There is deliberately no delete tool. When something should go
            away, the agent asks and the owner deletes it in the app.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Sync API</h2>
          <p className="connect-body">
            For file-level sync clients, the base URL is{" "}
            <code className="connect-inline-code">{origin}/api/sync/v1</code>,
            with the same bearer tokens.
          </p>
          <div className="connect-table-wrap">
            <table className="connect-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Path</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                {SYNC_ENDPOINTS.map(([method, path, what]) => (
                  <tr key={`${method} ${path}`}>
                    <td>
                      <code className="connect-inline-code">{method}</code>
                    </td>
                    <td>
                      <code className="connect-inline-code">{path}</code>
                    </td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="connect-body">
            The conflict rule: every file's sha256 hash travels in the
            manifest and as the file's ETag. A client writes by sending the
            whole file back with{" "}
            <code className="connect-inline-code">If-Match</code> set to the
            hash it last read. If the post changed on the server since, the
            write fails with 412; refetch, merge, retry. That one rule is the
            entire sync protocol.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Rules for agents</h2>
          <ul>
            <li>
              Authored public pieces are created as drafts in the blog
              folder. Publishing is the owner's call: ask before setting{" "}
              <code className="connect-inline-code">status: published</code>.
            </li>
            <li>
              Private text the owner wants to keep goes in notes; URLs worth
              saving go in bookmarks. Both stay unlisted, always.
            </li>
            <li>Ask before publishing. Ask before deleting.</li>
            <li>
              When an update reports a conflict, read the latest version and
              merge; never blind-overwrite.
            </li>
          </ul>
          <p className="connect-body">
            Ready to wire one up? Head back to{" "}
            <Link href="/connect">Connect</Link>.
          </p>
        </section>
      </main>
    </div>
  );
}
