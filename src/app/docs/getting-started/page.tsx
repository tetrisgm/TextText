import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Start writing with an agent" };

export default function GettingStartedPage() {
  return (
    <div className="connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">Getting started</p>
        <h1 className="connect-title">Make one visible edit</h1>
        <p className="connect-lede">
          The fastest way to understand TextText is to work with an agent in a
          real document. This takes about two minutes and is safe to undo.
        </p>
        <section className="connect-section">
          <h2 className="connect-section-title">1. Open a scratch note</h2>
          <p>
            Open Notes and create a blank note. Keep it open. The document you
            are looking at becomes the agent&apos;s working context, and its name
            appears above the assistant composer.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">2. Open the agent</h2>
          <p>
            Open the right sidebar. If TextText Agent is already connected,
            start writing. Otherwise choose <strong>Set up TextText Agent</strong>
            for an assistant inside the app, or <strong>Connect your AI app</strong>
            to use Claude, Codex, ChatGPT, or another MCP client.
          </p>
          <p>
            <Link href="/docs/ai">Follow the connection guide</Link> if neither
            option is ready yet.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">3. Ask for a change you can see</h2>
          <p>Send this exact request:</p>
          <blockquote className="docs-prompt">
            Add a heading called Connection verified and one sentence beneath
            it about why this document exists. Do not change anything else.
          </blockquote>
          <p>
            A connected agent edits the same document. Its name and activity
            stay visible, and TextText shows the proposed result before a
            guarded change is applied.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">4. Review, keep, or undo</h2>
          <p>
            Read the change in the document. Keep it if it is useful, or choose
            Undo to return to the previous version. That is the complete TextText
            loop: document, request, visible change, control.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">Try a real writing task</h2>
          <ul>
            <li>Tighten this paragraph without changing its point.</li>
            <li>Challenge the claims on this page and add three questions.</li>
            <li>Find related notes and draft an outline from them.</li>
          </ul>
          <p>
            Next, <Link href="/docs/how-it-works">learn what the agent sees</Link>
            or <Link href="/docs/features"> browse verified capabilities</Link>.
          </p>
        </section>
      </main>
    </div>
  );
}
