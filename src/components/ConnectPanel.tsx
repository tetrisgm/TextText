"use client";

import { useRef, useState } from "react";
import {
  createApiTokenAction,
  revokeApiTokenAction,
  revokeOAuthConnectionAction,
} from "@/app/editor/token-actions";
import type { ApiTokenSummary } from "@/lib/api-tokens";
import type { OAuthConnectionSummary } from "@/lib/oauth-connections";

type FreshToken = { id: string; name: string; token: string };

const LOCAL_MCP_URL = "http://127.0.0.1:47118/mcp";
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const EXAMPLE_PROMPTS = [
  "Create one project note for every repository I am working on.",
  "Append today's shipped changes to each matching project changelog.",
  "Save the useful decisions from this conversation as a Texttext note.",
];

export function ConnectPanel({
  initialConnections,
  initialTokens,
  origin,
}: {
  initialConnections: OAuthConnectionSummary[];
  initialTokens: ApiTokenSummary[];
  origin: string;
}) {
  const [connections, setConnections] =
    useState<OAuthConnectionSummary[]>(initialConnections);
  const [tokens, setTokens] = useState<ApiTokenSummary[]>(initialTokens);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<FreshToken | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteOrigin =
    origin ||
    (typeof window === "undefined"
      ? "https://texttext.app"
      : window.location.origin);
  const remoteMcpUrl = `${remoteOrigin}/api/mcp`;

  const commands = {
    claudeLocal: `claude mcp add --transport http --scope user texttext ${LOCAL_MCP_URL}`,
    claudeRemote: `claude mcp add --transport http --scope user texttext ${remoteMcpUrl}`,
    codexLocal: `codex mcp add texttext --url ${LOCAL_MCP_URL}`,
    codexRemote: `codex mcp add texttext --url ${remoteMcpUrl}\ncodex mcp login texttext`,
  };
  const tokenConfig = `{
  "mcpServers": {
    "texttext": {
      "url": "${remoteMcpUrl}",
      "headers": { "Authorization": "Bearer <your token>" }
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
      setError("Clipboard access was denied. Select and copy the text instead.");
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

  async function handleDisconnect(clientId: string) {
    setError(null);
    try {
      await revokeOAuthConnectionAction(clientId);
      setConnections((previous) =>
        previous.filter((connection) => connection.clientId !== clientId),
      );
    } catch (err) {
      setError(errorMessage(err, "The app could not be disconnected."));
    } finally {
      setConfirming(null);
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
      setConfirming(null);
    }
  }

  function CodeRecipe({
    copyKey,
    value,
  }: {
    copyKey: string;
    value: string;
  }) {
    return (
      <div className="connect-code-wrap">
        <pre className="connect-code">{value}</pre>
        <button
          className="ac-btn ac-btn-gray connect-code-copy"
          type="button"
          onClick={() => void copy(value, copyKey)}
        >
          {copiedKey === copyKey ? "Copied" : "Copy"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <section className="connect-section" aria-labelledby="connect-primary">
        <h2 className="connect-section-title" id="connect-primary">
          Use your AI account
        </h2>
        <p className="connect-sub">
          Claude, Codex, and ChatGPT keep their own model, account, and billing.
          Texttext gives them permission to work with your documents through MCP.
        </p>

        <div className="connect-provider-list">
          <section className="connect-provider" aria-labelledby="connect-claude">
            <div className="connect-provider-heading">
              <div>
                <p className="connect-provider-kicker">Anthropic</p>
                <h3 id="connect-claude">Claude</h3>
              </div>
              <span className="connect-scope">Claude.ai or Claude Code</span>
            </div>
            <p className="connect-body">
              In Claude.ai, open Settings, choose Connectors, add a custom
              connector, and paste{" "}
              <code className="connect-inline-code">{remoteMcpUrl}</code>.
              Claude opens Texttext for approval.
            </p>
            <p className="connect-body">
              Claude Code on this Mac can use the local bridge while Texttext is
              open. It needs no token and keeps local file changes immediate.
            </p>
            <CodeRecipe copyKey="claude-local" value={commands.claudeLocal} />
            <details className="connect-details">
              <summary>Use Claude Code remotely</summary>
              <CodeRecipe copyKey="claude-remote" value={commands.claudeRemote} />
            </details>
          </section>

          <section className="connect-provider" aria-labelledby="connect-codex">
            <div className="connect-provider-heading">
              <div>
                <p className="connect-provider-kicker">OpenAI</p>
                <h3 id="connect-codex">Codex</h3>
              </div>
              <span className="connect-scope">Codex app or CLI</span>
            </div>
            <p className="connect-body">
              Codex on this Mac can use the local bridge while Texttext is open.
              The Codex app and CLI share the same MCP configuration.
            </p>
            <CodeRecipe copyKey="codex-local" value={commands.codexLocal} />
            <details className="connect-details">
              <summary>Use hosted Texttext from Codex</summary>
              <CodeRecipe copyKey="codex-remote" value={commands.codexRemote} />
            </details>
          </section>

          <section className="connect-provider" aria-labelledby="connect-chatgpt">
            <div className="connect-provider-heading">
              <div>
                <p className="connect-provider-kicker">OpenAI</p>
                <h3 id="connect-chatgpt">ChatGPT</h3>
              </div>
              <span className="connect-scope">Apps with full MCP</span>
            </div>
            <ol className="connect-steps">
              <li>Open ChatGPT Settings or Workspace Settings.</li>
              <li>Open Apps, enable developer mode, then choose Create.</li>
              <li>
                Paste <code className="connect-inline-code">{remoteMcpUrl}</code>,
                scan tools, and approve Texttext.
              </li>
            </ol>
            <p className="connect-sub">
              Full MCP apps currently require an eligible ChatGPT workspace plan.
            </p>
          </section>
        </div>

        <p className="connect-body">Once connected, try:</p>
        <ul className="connect-prompts">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <li key={prompt}>{prompt}</li>
          ))}
        </ul>
      </section>

      <section className="connect-section" aria-labelledby="connect-apps">
        <h2 className="connect-section-title" id="connect-apps">
          Connected apps
        </h2>
        <p className="connect-sub">
          These clients approved access through Texttext. Disconnecting revokes
          every active grant for that client.
        </p>
        {connections.length === 0 ? (
          <p className="connect-empty">No OAuth apps are connected.</p>
        ) : (
          <ul className="connect-rows">
            {connections.map((connection) => (
              <li className="connect-row" key={connection.clientId}>
                <div className="connect-row-main">
                  <div className="connect-row-name">{connection.name}</div>
                  <div className="connect-row-meta">
                    {connection.scope === "sync" ? "Can read and write" : "Read only"}
                    {" · "}Connected {formatDay(connection.connectedAt)}
                    {connection.lastUsedAt
                      ? ` · Last used ${formatDay(connection.lastUsedAt)}`
                      : ""}
                  </div>
                </div>
                <div className="connect-row-actions">
                  {confirming === `oauth:${connection.clientId}` ? (
                    <>
                      <span className="connect-confirm-label">Disconnect?</span>
                      <button
                        className="ac-btn ac-btn-plain ac-danger"
                        type="button"
                        onClick={() => void handleDisconnect(connection.clientId)}
                      >
                        Disconnect
                      </button>
                      <button
                        className="ac-btn ac-btn-plain"
                        type="button"
                        onClick={() => setConfirming(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="ac-btn ac-btn-plain ac-danger"
                      type="button"
                      onClick={() => setConfirming(`oauth:${connection.clientId}`)}
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="connect-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="connect-section" aria-labelledby="connect-in-app">
        <h2 className="connect-section-title" id="connect-in-app">
          In-app assistant
        </h2>
        <p className="connect-body">
          To use the Texttext assistant sidebar, add a workspace-owned Anthropic
          or OpenAI API key in Workspace Settings and choose a model. Provider
          API billing is separate from Claude.ai and ChatGPT subscriptions.
        </p>
      </section>

      <details className="connect-section connect-advanced">
        <summary className="connect-section-title">Advanced connections</summary>
        <p className="connect-sub">
          Manual tokens are for clients that cannot complete OAuth and for file
          sync integrations. Prefer the setup above when your client supports it.
        </p>

        <form className="connect-form" onSubmit={handleCreate}>
          <input
            className="ac-field"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Token name, e.g. automation on my Mac"
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
                onClick={() => void copy(fresh.token, "fresh")}
              >
                {copiedKey === "fresh" ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="connect-warn">Save it now. It is not shown again.</p>
          </div>
        )}

        {tokens.length > 0 && (
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
                  {confirming === `token:${token.id}` ? (
                    <>
                      <span className="connect-confirm-label">Revoke?</span>
                      <button
                        className="ac-btn ac-btn-plain ac-danger"
                        type="button"
                        onClick={() => void handleRevoke(token.id)}
                      >
                        Revoke
                      </button>
                      <button
                        className="ac-btn ac-btn-plain"
                        type="button"
                        onClick={() => setConfirming(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="ac-btn ac-btn-plain ac-danger"
                      type="button"
                      onClick={() => setConfirming(`token:${token.id}`)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <h3 className="connect-minor-title">Bearer configuration</h3>
        <CodeRecipe copyKey="token-config" value={tokenConfig} />
        <p className="connect-body">
          File sync lives at{" "}
          <code className="connect-inline-code">{remoteOrigin}/api/sync/v1</code>.
          See <a href="/docs/ai">the complete AI and agent guide</a> for tool,
          privacy, conflict, and automation details.
        </p>
      </details>
    </div>
  );
}
