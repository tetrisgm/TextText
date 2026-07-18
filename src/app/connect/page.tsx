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
  title: "Connect",
  description: "API tokens and endpoints for agents and sync clients.",
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
            Connect at <code className="connect-inline-code">https://write.ramine.net/api/mcp</code>.{" "}
            <code className="connect-inline-code">read</code> inspects and{" "}
            <code className="connect-inline-code">sync</code> writes. Sign in to
            create a token.
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
            <Link href="/docs/ai">Setup for Claude, Cursor, VS Code, and Codex</Link>.
          </p>
        </main>
      </div>
    );
  }

  // A signed-in user without a users row yet (never opened the editor) has
  // no tokens; the list degrades to empty instead of failing the page.
  let tokens: ApiTokenSummary[] = [];
  try {
    tokens = await listApiTokensAction();
  } catch {
    tokens = [];
  }

  return (
    <div className="applecms connect-shell">
      <main className="connect-main">
        <h1 className="connect-title">Connect</h1>
        <p className="connect-lede">
          Connect at <code className="connect-inline-code">https://write.ramine.net/api/mcp</code>.{" "}
          <code className="connect-inline-code">read</code> inspects and{" "}
          <code className="connect-inline-code">sync</code> writes.{" "}
          <Link href="/docs/ai">Setup for Claude, Cursor, VS Code, and Codex</Link>.
        </p>
        <ConnectPanel initialTokens={tokens} origin={origin} />
      </main>
    </div>
  );
}
