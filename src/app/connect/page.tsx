// /connect: where a signed-in owner mints API tokens and picks up the MCP
// and sync recipes. Signed out, it is a quiet sign-in prompt, not a wall.

import type { Metadata } from "next";
import Link from "next/link";
import {
  listApiTokensAction,
  listOAuthConnectionsAction,
} from "@/app/editor/token-actions";
import { ConnectPanel } from "@/components/ConnectPanel";
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
          <h1 className="connect-title">Connect</h1>
          <p className="connect-lede">
            Claude, Codex, and ChatGPT can work with your Texttext documents
            through MCP. Paste{" "}
            <code className="connect-inline-code">
              https://texttext.app/api/mcp
            </code>{" "}
            in the client and approve access when Texttext opens.
          </p>
          <p>
            <a
              className="ac-btn ac-btn-filled"
              href="/api/auth/signin?callbackUrl=/connect"
            >
              Sign in
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
