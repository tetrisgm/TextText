"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import {
  createApiTokenAction,
  revokeApiTokenAction,
} from "@/app/editor/token-actions";
import {
  AGENT_CONNECTION_CHECK_PROMPT,
  AGENT_INTEGRATIONS,
  AGENT_WORKFLOWS,
  hostedMcpUrl,
} from "@/lib/agent-integrations";
import type { ApiTokenSummary } from "@/lib/api-tokens";
import { apiTokenKindLabel } from "@/lib/api-token-kinds";
import {
  nativeAssistantAvailable,
  nativeEmbeddedAssistantAvailable,
} from "@/lib/ai/native-client";

const LOCAL_AGENT_INTEGRATIONS = AGENT_INTEGRATIONS.filter(
  (integration) => integration.id !== "mcp",
);
const LOCAL_AGENT_WORKFLOWS = AGENT_WORKFLOWS.filter(
  (workflow) => workflow.id !== "publish-collaborate",
);

type FreshToken = { id: string; name: string; token: string };

type TextTextConnectionEdition =
  | "unknown"
  | "standalone"
  | "remote-only";

function subscribeNativeEdition() {
  return () => undefined;
}

export function connectionEditionSnapshot(): TextTextConnectionEdition {
  if (typeof window === "undefined") return "unknown";
  if (!nativeAssistantAvailable()) return "remote-only";
  return nativeEmbeddedAssistantAvailable() ? "standalone" : "remote-only";
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function CodeRecipe({
  copyKey,
  value,
  copiedKey,
  onCopy,
}: {
  copyKey: string;
  value: string;
  copiedKey: string | null;
  onCopy: (value: string, copyKey: string) => void;
}) {
  return (
    <div className="connect-code-wrap">
      <pre className="connect-code">{value}</pre>
      <button
        className="ac-btn ac-btn-gray connect-code-copy"
        type="button"
        onClick={() => onCopy(value, copyKey)}
      >
        {copiedKey === copyKey ? "Copied" : "Copy"}
      </button>
    </div>
  );
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
  const edition = useSyncExternalStore(
    subscribeNativeEdition,
    connectionEditionSnapshot,
    () => "unknown",
  );
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteOrigin =
    origin ||
    (typeof window === "undefined"
      ? "https://texttext.app"
      : window.location.origin);
  const remoteMcpUrl = hostedMcpUrl(remoteOrigin);

  const commands = {
    tokenPrompt: `read -rs "TEXTTEXT_WORKSPACE_TOKEN?Paste your TextText token: "; printf '\\n'; export TEXTTEXT_WORKSPACE_TOKEN`,
    claudeRemote: `claude mcp add --transport http --scope user texttext ${remoteMcpUrl} --header 'Authorization: Bearer \${TEXTTEXT_WORKSPACE_TOKEN}'`,
    cliCheck: "texttext ls",
    codexRemote: `codex mcp add texttext --url ${remoteMcpUrl} --bearer-token-env-var TEXTTEXT_WORKSPACE_TOKEN`,
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
      setError(
        "Clipboard access was denied. Select and copy the text instead.",
      );
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createApiTokenAction(name, "mcp");
      setFresh({ id: created.id, name: created.name, token: created.token });
      setTokens((previous) => [
        {
          id: created.id,
          name: created.name,
          kind: created.kind,
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

  return (
    <div>
      {error && (
        <p className="connect-error" role="alert">
          {error}
        </p>
      )}
      {edition === "standalone" && (
        <section className="connect-section" aria-labelledby="connect-primary">
          <h2 className="connect-section-title" id="connect-primary">
            Add TextText to your agents
          </h2>
          <p className="connect-sub">
            The standalone Mac edition can add TextText to Claude and Codex.
            Each agent keeps its own model, account, and billing while TextText
            stays the durable home for your documents.
          </p>

          <div className="connect-integration-grid">
            {LOCAL_AGENT_INTEGRATIONS.map((integration) => {
              const action = integration.action;
              const actionKey = `integration:${integration.id}`;
              const copied = copiedKey === actionKey;
              return (
                <article
                  className="connect-integration-card"
                  key={integration.id}
                >
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
                        {copied ? action.copiedLabel : action.label}
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
        </section>
      )}

      {edition === "standalone" && (
        <section
          className="connect-section"
          aria-labelledby="connect-workflows"
        >
          <h2 className="connect-section-title" id="connect-workflows">
            Ready-made workflows
          </h2>
          <p className="connect-sub">
            The local plugins teach Claude and Codex how to read, create,
            update, and append TextText documents safely.
          </p>
          <div className="connect-workflow-grid">
            {LOCAL_AGENT_WORKFLOWS.map((workflow) => (
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
      )}

      <section className="connect-section" aria-labelledby="connect-in-app">
        <h2 className="connect-section-title" id="connect-in-app">
          In-app assistant
        </h2>
        <p className="connect-body">
          Set up a workspace-owned Anthropic or OpenAI API key, then write with
          the assistant beside the current TextText document. Provider usage is
          billed separately.
        </p>
        <p>
          <a className="ac-btn ac-btn-filled" href="/docs/ai#embedded-agent">
            Set up the in-app assistant
          </a>
        </p>
      </section>

      <section
        className="connect-section connect-verification"
        aria-labelledby="connect-verification"
      >
        <div>
          <p className="connect-provider-kicker">One-minute check</p>
          <h2 className="connect-section-title" id="connect-verification">
            Prove the connection in TextText
          </h2>
          <p className="connect-sub">
            Paste this into the agent you connected. It works when the private
            note appears in Notes and the agent can read it back.
          </p>
        </div>
        <div className="connect-verification-prompt">
          <p>{AGENT_CONNECTION_CHECK_PROMPT}</p>
          <button
            className="ac-btn ac-btn-gray"
            type="button"
            onClick={() =>
              void copy(AGENT_CONNECTION_CHECK_PROMPT, "connection-check")
            }
          >
            {copiedKey === "connection-check" ? "Prompt copied" : "Copy prompt"}
          </button>
        </div>
      </section>

      <details className="connect-section connect-advanced">
        <summary className="connect-section-title">
          Advanced connections
        </summary>
        <p className="connect-sub">
          Reach for these only when a remote client supports a protected bearer
          token field and you want to wire the endpoint by hand.
        </p>

        {edition === "standalone" && (
          <>
            <h3 className="connect-minor-title">Agents on this Mac</h3>
            <p className="connect-body">
              The standalone Mac app includes a <code>texttext</code> command
              for Codex, Claude, and other local coding agents. Run{" "}
              <code>texttext install</code> once to add it to your PATH, then
              check it with the command below.
            </p>
            <CodeRecipe
              copyKey="cli-check"
              value={commands.cliCheck}
              copiedKey={copiedKey}
              onCopy={(value, key) => void copy(value, key)}
            />
          </>
        )}

        <h3 className="connect-minor-title">Direct hosted connection</h3>
        <p className="connect-body">
          Create a token below, set it with this hidden prompt, then add the
          connection from the same Terminal. The token stays out of shell
          history and the saved client configuration.
        </p>
        <CodeRecipe
          copyKey="token-prompt"
          value={commands.tokenPrompt}
          copiedKey={copiedKey}
          onCopy={(value, key) => void copy(value, key)}
        />
        <CodeRecipe
          copyKey="claude-remote"
          value={commands.claudeRemote}
          copiedKey={copiedKey}
          onCopy={(value, key) => void copy(value, key)}
        />
        <CodeRecipe
          copyKey="codex-remote"
          value={commands.codexRemote}
          copiedKey={copiedKey}
          onCopy={(value, key) => void copy(value, key)}
        />

        <h3 className="connect-minor-title">Hosted MCP tokens</h3>
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
                    {apiTokenKindLabel(token.kind)} · {" "}
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
        <CodeRecipe
          copyKey="token-config"
          value={tokenConfig}
          copiedKey={copiedKey}
          onCopy={(value, key) => void copy(value, key)}
        />
        <p className="connect-body">
          File sync lives at{" "}
          <code className="connect-inline-code">
            {remoteOrigin}/api/sync/v1
          </code>
          . See <a href="/docs/ai">the complete AI and agent guide</a> for tool,
          privacy, conflict, and automation details.
        </p>
      </details>
    </div>
  );
}
