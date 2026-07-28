// /connect: where a signed-in owner mints API tokens and picks up the MCP
// and sync recipes. Signed out, it is a quiet sign-in prompt, not a wall.

import type { Metadata } from "next";
import Link from "next/link";
import {
  listApiTokensAction,
  listOAuthConnectionsAction,
} from "@/app/editor/token-actions";
import { ConnectPanel } from "@/components/ConnectPanel";
import {
  AGENT_INTEGRATIONS,
  CLAUDE_PLUGIN_INSTALL_COMMAND,
  CODEX_PLUGIN_INSTALL_COMMAND,
} from "@/lib/agent-integrations";
import type { ApiTokenSummary } from "@/lib/api-tokens";
import type { OAuthConnectionSummary } from "@/lib/oauth-connections";
import { getCurrentUser } from "@/lib/session";
import { rootDomainUrl } from "@/lib/site-url";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "Connect Claude, Codex, and ChatGPT",
  description:
    "Connect Claude, Codex, ChatGPT, and other agents to Texttext.",
};

export default async function ConnectPage() {
  const user = await getCurrentUser();
  const origin = rootDomainUrl().origin;

  if (!user) {
    return (
      <div className="applecms connect-shell">
        <main className="connect-main">
          <p className="connect-provider-kicker">Agents and integrations</p>
          <h1 className="connect-title">Add Texttext to your AI</h1>
          <p className="connect-lede">
            Install Texttext in Claude or Codex, connect it to ChatGPT, or use
            any MCP client. Your AI keeps its account and model while Texttext
            becomes its durable document workspace.
          </p>
          <div className="connect-integration-grid">
            {AGENT_INTEGRATIONS.map((integration) => (
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
              </article>
            ))}
          </div>
          <div className="connect-code-wrap">
            <p className="connect-code-label">Claude Code</p>
            <pre className="connect-code">{CLAUDE_PLUGIN_INSTALL_COMMAND}</pre>
          </div>
          <div className="connect-code-wrap">
            <p className="connect-code-label">Codex</p>
            <pre className="connect-code">{CODEX_PLUGIN_INSTALL_COMMAND}</pre>
          </div>
          <p>
            <a
              className="ac-btn ac-btn-filled"
              href="/api/auth/signin?callbackUrl=/connect"
            >
              Sign in to connect
            </a>
          </p>
          <p className="connect-sub" style={{ marginTop: 16 }}>
            Sign in here to manage connected apps and advanced access.{" "}
            <Link href="/docs/ai">Read the complete setup guide</Link>.
          </p>
        </main>
      </div>
    );
  }

  // A signed-in user without a users row yet (never opened the editor) has
  // no tokens; the list degrades to empty instead of failing the page.
  let tokens: ApiTokenSummary[] = [];
  let connections: OAuthConnectionSummary[] = [];
  const [tokenResult, connectionResult] = await Promise.allSettled([
    listApiTokensAction(),
    listOAuthConnectionsAction(),
  ]);
  if (tokenResult.status === "fulfilled") tokens = tokenResult.value;
  if (connectionResult.status === "fulfilled") {
    connections = connectionResult.value;
  }

  return (
    <div className="applecms connect-shell">
      <main className="connect-main">
        <h1 className="connect-title">Connect</h1>
        <p className="connect-lede">
          Use Claude, Codex, or ChatGPT to create, edit, organize, publish, and
          collaborate on Texttext documents.{" "}
          <Link href="/docs/ai">Open the complete setup guide</Link>.
        </p>
        <ConnectPanel
          initialConnections={connections}
          initialTokens={tokens}
          origin={origin}
        />
      </main>
    </div>
  );
}
