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
          The fastest way to understand TextText is to rewrite one selected
          sentence in a real document. This takes about two minutes and keeps
          the original within reach.
        </p>
        <section className="connect-section">
          <h2 className="connect-section-title">1. Open a scratch note</h2>
          <p>
            Open Notes and create a note with one sentence you can safely
            change. Keep the note open, select that sentence, and leave the
            selection active. The context chip above the assistant composer
            names the document and selected passage.
          </p>
          <p>For a predictable test, type and select this sentence:</p>
          <blockquote className="docs-prompt">
            The machines are important to the work, but they should not get in
            the way of the work.
          </blockquote>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">2. Open the agent</h2>
          <p>
            Open the right sidebar. If TextText Agent is already connected,
            start writing. Otherwise choose{" "}
            <strong>Set up the in-app assistant</strong>. This two-minute loop
            uses the selection Rewrite action so its proposal, Apply, and Undo
            controls all stay visible together.
          </p>
          <p>
            <Link href="/docs/ai">Follow the connection guide</Link> if that
            path is not ready yet.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">
            3. Ask for a change you can see
          </h2>
          <p>
            With the sentence still selected, choose <strong>Rewrite</strong>
            from the selection toolbar. The quick action asks the connected
            in-app provider for a clearer replacement without changing the rest
            of the note.
          </p>
          <p>
            TextText shows the selected source and proposed replacement before
            anything changes. This preview belongs to the selection quick
            action; an ordinary freeform assistant request may update the
            document directly instead.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">
            Using the standalone Mac edition with Claude or Codex?
          </h2>
          <p>
            The standalone Mac edition includes the local TextText plugin.
            Install it, then name the exact document path in Claude or Codex.
            Local plugin edits appear in TextText and follow the same
            validation, permissions, audit, and conflict rules. Review or
            correct them in the document rather than expecting the sidebar
            proposal and Undo controls.
          </p>
          <p>
            <Link href="/docs/ai#external-agent">Connect the local plugin</Link>
            .
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">4. Review, keep, or undo</h2>
          <p>
            Read the replacement, choose Apply, and confirm it appears in the
            note. Keep it if it is useful, or choose Undo beside that quick
            action result. That is the complete selection loop: passage,
            proposal, visible change, control.
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
            Next, try the{" "}
            <Link href="/docs/recipes">copyable writing recipes</Link>,
            <Link href="/docs/how-it-works"> learn what the agent sees</Link>,
            or
            <Link href="/docs/features"> browse verified capabilities</Link>.
          </p>
        </section>
      </main>
    </div>
  );
}
