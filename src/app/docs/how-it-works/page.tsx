import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How agents work in TextText" };

export default function HowItWorksPage() {
  return (
    <div className="connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">The working model</p>
        <h1 className="connect-title">The document is the canvas</h1>
        <p className="connect-lede">
          TextText does for writing what agentic design tools do for a canvas:
          the work stays visible while you and the agent act on the same source.
        </p>
        <section className="connect-section">
          <h2 className="connect-section-title">
            Open context, not hidden context
          </h2>
          <p>
            The context chip above the composer names the document, folder, or
            workspace the agent is working with. Open a document to make it the
            focus. Select text to give the agent a precise passage.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">
            One document model, consistent rules
          </h2>
          <p>
            TextText Agent, the app UI, and hosted MCP agents share the
            workspace command surface. In the standalone Mac edition, the local
            Claude and Codex plugins use the bundled CLI adapter. Both paths use
            the same document model, permissions, validation, audit records, and
            conflict checks.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">Changes remain legible</h2>
          <ul>
            <li>
              The in-app assistant appears as a collaborator while it works.
            </li>
            <li>Writing happens in the document, not in a second copy.</li>
            <li>
              Rewrite and Summarize selection quick actions show the replacement
              before Apply and keep Undo beside the result. Freeform assistant
              turns may change the document directly.
            </li>
            <li>
              Local plugin edits appear in the document. Read the updated text,
              then correct it directly or ask for a smaller follow-up change.
            </li>
          </ul>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">Two ways to bring an agent</h2>
          <h3>TextText Agent</h3>
          <p>
            The assistant lives inside the right sidebar. App Store and browser
            builds use a workspace OpenAI or Anthropic API key. The standalone
            Mac edition can also use an eligible local ChatGPT or Codex account.
            The API-key path handles tools without confirmation gates; the
            standalone native path can also ask before guarded comments,
            publishing, and access changes.
          </p>
          <h3>Your AI app</h3>
          <p>
            In the standalone Mac edition, Claude and Codex can use the local
            TextText plugin and bundled CLI. Remote MCP clients that accept
            bearer credentials can connect to the hosted TextText tool surface
            with a revocable workspace token. The conversation stays in that AI
            app while the document stays in TextText.
          </p>
          <p>
            <Link href="/docs/ai">Choose a connection path</Link>.
          </p>
        </section>
        <section className="connect-section" id="billing">
          <h2 className="connect-section-title">
            Accounts and billing stay honest
          </h2>
          <p>
            Consumer subscriptions and provider API accounts are different.
            TextText does not turn a ChatGPT or Claude subscription into API
            credits, and it never asks for a provider password. The setup page
            tells you which account supplies each connection.
          </p>
        </section>
      </main>
    </div>
  );
}
