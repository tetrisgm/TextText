"use client";

import { useRef, useState } from "react";
import {
  createApiTokenAction,
  revokeApiTokenAction,
} from "@/app/editor/token-actions";
import {
  AGENT_INTEGRATIONS,
  AGENT_WORKFLOWS,
  hostedMcpUrl,
} from "@/lib/agent-integrations";
import type { ApiTokenSummary } from "@/lib/api-tokens";
import { WORKSPACE_TOOL_DEFINITIONS } from "@/lib/ai/tools";

const WORKSPACE_TOOL_COUNT = Object.keys(WORKSPACE_TOOL_DEFINITIONS).length;

type FreshToken = { id: string; name: string; token: string };

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
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteOrigin =
    origin ||
    (typeof window === "undefined"
      ? "https://texttext.app"
      : window.location.origin);
  const remoteMcpUrl = hostedMcpUrl(remoteOrigin);

  const commands = {
    claudeRemote: `claude mcp add --transport http --scope user texttext ${remoteMcpUrl}`,
    cliCheck: "texttext ls",
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
          Add TextText to your agents
        </h2>
        <p className="connect-sub">
          Install TextText once in the AI products you already use. Each agent
          keeps its own model, account, and billing while TextText stays the
          durable home for your documents.
        </p>

        <div className="connect-integration-grid">
          {AGENT_INTEGRATIONS.map((integration) => {
            const action = integration.action;
            const actionKey = `integration:${integration.id}`;
            const copied = copiedKey === actionKey;
            return (
              <article className="connect-integration-card" key={integration.id}>
                <div className="connect-integration-heading">
                  <span
                    className={`connect-integration-mark is-${integration.id}`}
                    aria-hidden="true"
                  >
                    {integration.monogram}
                  </span>
                  <div>
                    <p className="connect-provider-kicker">
                      {integration.company}
                    </p>
                    <h3>{integration.name}</h3>
                  </div>
                </div>
                <p className="connect-integration-description">
                  {integration.description}
                </p>
                <p className="connect-integration-environment">
                  {integration.environment}
                </p>
                <div className="connect-integration-actions">
                  {action.kind === "copy" ? (
                    <button
                      className="ac-btn ac-btn-filled"
                      type="button"
                      onClick={() => void copy(action.value, actionKey)}
                    >
                      {copied
                        ? action.copiedLabel
                        : action.label}
                    </button>
                  ) : (
                    <a
                      className="ac-btn ac-btn-filled"
                      href={action.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {action.label}
                    </a>
                  )}
                  {integration.secondaryAction && (
                    <a
                      className="ac-btn ac-btn-plain"
                      href={integration.secondaryAction.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {integration.secondaryAction.label}
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {/* Counted, not typed. The strip claimed 29 tools while the workspace
            surface had grown to 33, and it advertised OAuth for months after
            OAuth was deleted. Both were hand-written promises about a moving
            product. */}
        <div className="connect-capability-strip" aria-label="Connection features">
          <span>{WORKSPACE_TOOL_COUNT} document tools</span>
          <span>One workspace token</span>
          <span>Read, write, publish, and collaborate</span>
        </div>
      </section>

      <section className="connect-section" aria-labelledby="connect-workflows">
        <h2 className="connect-section-title" id="connect-workflows">
          Ready-made workflows
        </h2>
        <p className="connect-sub">
          The plugins teach Claude and Codex how to use TextText safely. These
          same workflows work in ChatGPT and other MCP clients.
        </p>
        <div className="connect-workflow-grid">
          {AGENT_WORKFLOWS.map((workflow) => (
            <article className="connect-workflow" key={workflow.id}>
              <h3>{workflow.title}</h3>
              <p>{workflow.description}</p>
              <button
                className="ac-btn ac-btn-gray"
                type="button"
                onClick={() =>
                  void copy(workflow.prompt, `workflow:${workflow.id}`)
                }
              >
                {copiedKey === `workflow:${workflow.id}`
                  ? "Prompt copied"
                  : "Copy prompt"}
              </button>
            </article>
          ))}
        </div>
      </section>


      <section className="connect-section" aria-labelledby="connect-in-app">
        <h2 className="connect-section-title" id="connect-in-app">
          In-app assistant
        </h2>
        <p className="connect-body">
          To use the TextText assistant sidebar, add a workspace-owned Anthropic
          or OpenAI API key in Workspace Settings and choose a model. Provider
          API billing is separate from Claude.ai and ChatGPT subscriptions.
        </p>
      </section>

      <details className="connect-section connect-advanced">
        <summary className="connect-section-title">Advanced connections</summary>
        <p className="connect-sub">
          The plugins above set this up for you. Reach for these when a client
          cannot install one and you want to wire the endpoint and the token by
          hand.
        </p>

        <h3 className="connect-minor-title">Agents on this Mac</h3>
        <p className="connect-body">
          Nothing to connect. The Mac app installs a <code>texttext</code>
          {" "}command, and Codex, Claude, and other coding agents use it to work
          in your documents directly. Check it is there with:
        </p>
        <CodeRecipe copyKey="cli-check" value={commands.cliCheck} />

        <h3 className="connect-minor-title">Direct hosted connection</h3>
        <CodeRecipe copyKey="claude-remote" value={commands.claudeRemote} />
        <CodeRecipe copyKey="codex-remote" value={commands.codexRemote} />

        <h3 className="connect-minor-title">Manual access tokens</h3>
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
