// /connect: where a signed-in owner mints API tokens and picks up the MCP
// and sync recipes. Signed out, it is a quiet sign-in prompt, not a wall.

import type { Metadata } from "next";
import Link from "next/link";
import { listApiTokensAction } from "@/app/editor/token-actions";
import { ConnectPanel } from "@/components/ConnectPanel";
import type { ApiTokenSummary } from "@/lib/api-tokens";
import { getCurrentUser } from "@/lib/session";
import { rootDomainUrl } from "@/lib/site-url";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "Connect Claude and Codex",
  description:
    "Connect Claude, Codex, and supported remote agents to TextText.",
};

export default async function ConnectPage() {
  const user = await getCurrentUser();
  const origin = rootDomainUrl().origin;

  if (!user) {
    return (
      <div className="applecms connect-shell">
        <main className="connect-main">
          <p className="connect-provider-kicker">Agents and integrations</p>
          <h1 className="connect-title">Choose how AI works with TextText</h1>
          <p className="connect-lede">
            Sign in to see the connection paths supported by this edition.
            TextText can host an assistant beside your document or give a
            supported AI client guarded access to the same workspace.
          </p>
          <form action="/api/auth/signin" method="get">
            <input type="hidden" name="callbackUrl" value="/connect" />
            <button className="ac-btn ac-btn-filled" type="submit">
              Sign in to connect
            </button>
          </form>
          <p className="connect-sub" style={{ marginTop: 16 }}>
            The setup guide explains the in-app assistant, standalone Mac
            plugins, and hosted MCP separately.{" "}
            <Link href="/docs/ai">Read the complete setup guide</Link>.
          </p>
        </main>
      </div>
    );
  }

  // A signed-in user without a users row yet (never opened the editor) has
  // no tokens; the list degrades to empty instead of failing the page.
  let tokens: ApiTokenSummary[] = [];
  const [tokenResult] = await Promise.allSettled([listApiTokensAction()]);
  if (tokenResult.status === "fulfilled") tokens = tokenResult.value;

  return (
    <div className="applecms connect-shell">
      <main className="connect-main">
        <h1 className="connect-title">Connect</h1>
        <p className="connect-lede">
          Choose a connection supported by this edition. TextText keeps the
          document and its permissions in one workspace while your chosen AI
          handles the conversation.{" "}
          <Link href="/docs/ai">Open the complete setup guide</Link>.
        </p>
        <ConnectPanel initialTokens={tokens} origin={origin} />
      </main>
    </div>
  );
}
