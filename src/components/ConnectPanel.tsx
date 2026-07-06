"use client";

// The signed-in body of /connect: token management plus copy-ready recipes
// for MCP clients and sync clients. Raw token values exist in the browser
// exactly once, right after creation; revoking uses a two-tap inline confirm
// instead of a dialog.

import { useRef, useState } from "react";
import {
  createApiTokenAction,
  revokeApiTokenAction,
} from "@/app/editor/token-actions";
import type { ApiTokenSummary } from "@/lib/api-tokens";

type FreshToken = { id: string; name: string; token: string };

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// UTC on purpose: the same string renders on server and client, so hydration
// never disagrees about a date near midnight.
function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const EXAMPLE_PROMPTS = [
  "What did I publish last month? Read my latest post and draft a follow-up.",
  "Save this link to my bookmarks with a one-line note on why it matters.",
  "Append today's progress to my weeknotes draft.",
];

export function ConnectPanel({
  initialTokens,
  origin,
}: {
  initialTokens: ApiTokenSummary[];
  origin: string;
}) {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>(initialTokens);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<FreshToken | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Clipboard can be denied; the values stay selectable by hand.
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createApiTokenAction(name);
      setFresh({ id: created.id, name: created.name, token: created.token });
      setTokens((previous) => [
        {
          id: created.id,
          name: created.name,
          createdAt: created.createdAt,
          lastUsedAt: created.lastUsedAt,
        },
        ...previous,
      ]);
      setName("");
    } catch (err) {
      setError(errorMessage(err, "The token could not be created."));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    setError(null);
    try {
      await revokeApiTokenAction(id);
      setTokens((previous) => previous.filter((token) => token.id !== id));
      setFresh((previous) => (previous?.id === id ? null : previous));
    } catch (err) {
      setError(errorMessage(err, "The token could not be revoked."));
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <div>
      <section className="connect-section" aria-labelledby="connect-tokens">
        <h2 className="connect-section-title" id="connect-tokens">
          API tokens
        </h2>
        <p className="connect-sub">
          A token gives an agent or sync client full access to your blog.
          Name it after the machine or tool it is for.
        </p>

        <form className="connect-form" onSubmit={handleCreate}>
          <input
            className="ac-field"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Token name, e.g. Claude on my laptop"
            maxLength={80}
            aria-label="Token name"
          />
          <button
            className="ac-btn ac-btn-filled"
            type="submit"
            disabled={busy || !name.trim()}
          >
            Create token
          </button>
        </form>

        {fresh && (
          <div className="connect-fresh" role="status">
            <p className="connect-fresh-name">{fresh.name}</p>
            <div className="connect-fresh-row">
              <code className="connect-fresh-token">{fresh.token}</code>
              <button
                className="ac-btn ac-btn-gray"
                type="button"
                onClick={() => copy(fresh.token, "fresh")}
              >
                {copiedKey === "fresh" ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="connect-warn">
              Save it now. It is not shown again.
            </p>
          </div>
        )}

        {error && <p className="connect-error">{error}</p>}

        {tokens.length === 0 ? (
          <p className="connect-empty">
            No tokens yet. Create one to connect an agent.
          </p>
        ) : (
          <ul className="connect-rows">
            {tokens.map((token) => (
              <li className="connect-row" key={token.id}>
                <div className="connect-row-main">
                  <div className="connect-row-name">{token.name}</div>
                  <div className="connect-row-meta">
                    Created {formatDay(token.createdAt)}
                    {token.lastUsedAt
                      ? ` · Last used ${formatDay(token.lastUsedAt)}`
                      : " · Never used"}
                  </div>
                </div>
                <div className="connect-row-actions">
                  {confirmingId === token.id ? (
                    <>
                      <span className="connect-confirm-label">Revoke?</span>
                      <button
                        className="ac-btn ac-btn-plain ac-danger"
                        type="button"
                        onClick={() => handleRevoke(token.id)}
                      >
                        Yes
                      </button>
                      <button
                        className="ac-btn ac-btn-plain"
                        type="button"
                        onClick={() => setConfirmingId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="ac-btn ac-btn-plain ac-danger"
                      type="button"
                      onClick={() => setConfirmingId(token.id)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="connect-section" aria-labelledby="connect-mcp">
        <h2 className="connect-section-title" id="connect-mcp">
          Use with Claude, ChatGPT, Cursor, or any MCP client
        </h2>
        <p className="connect-sub">
          Write speaks MCP over streamable HTTP. Add this to your client's
          MCP configuration and replace the placeholder with a token from
          above.
        </p>
        <div className="connect-code-wrap">
          <pre className="connect-code">{mcpConfig}</pre>
          <button
            className="ac-btn ac-btn-gray connect-code-copy"
            type="button"
            onClick={() => copy(mcpConfig, "mcp")}
          >
            {copiedKey === "mcp" ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="connect-body">Then try prompts like these:</p>
        <ul className="connect-prompts">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <li key={prompt}>{prompt}</li>
          ))}
        </ul>
      </section>

      <section className="connect-section" aria-labelledby="connect-sync">
        <h2 className="connect-section-title" id="connect-sync">
          Sync files
        </h2>
        <p className="connect-body">
          Every post is a plain markdown file with one-line{" "}
          <code className="connect-inline-code">key: value</code> frontmatter.
          The sync API lives at{" "}
          <code className="connect-inline-code">{origin}/api/sync/v1</code>{" "}
          and takes the same tokens:{" "}
          <code className="connect-inline-code">GET /workspace</code> lists
          your folders, and{" "}
          <code className="connect-inline-code">
            GET /folders/{"{folderId}"}/manifest
          </code>{" "}
          returns every item with a sha256 hash of its file, so a client can
          tell what changed without downloading anything twice.
        </p>
        <p className="connect-body">
          <code className="connect-inline-code">
            GET /files/{"{id}"}
          </code>{" "}
          returns a file with its hash as the ETag. To write, send the whole
          file back with{" "}
          <code className="connect-inline-code">PUT</code> and set{" "}
          <code className="connect-inline-code">If-Match</code> to that ETag:
          if the post changed on the server in the meantime, the request
          fails with 412 instead of overwriting it, and your client refetches
          and merges. New files are POSTed to{" "}
          <code className="connect-inline-code">/files</code>.
        </p>
      </section>
    </div>
  );
}
