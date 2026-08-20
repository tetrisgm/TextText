import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Start writing with an agent" };

export default function GettingStartedPage() {
  return (
    <div className="connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">Getting started</p>
        <h1 className="connect-title">Turn notes into grounded writing</h1>
        <p className="connect-lede">
          The fastest way to understand TextText is to give an agent real source
          notes and inspect the brief it builds. The result keeps its claims,
          evidence, sources, and writing rules visible.
        </p>
        <section className="connect-section">
          <h2 className="connect-section-title">
            1. Put two notes in one folder
          </h2>
          <p>
            Open Notes and create two short source notes about the same project.
            Concrete facts, decisions, quotes, and unresolved questions are more
            useful than polished prose. Keep the Notes folder open. The context
            chip above the assistant composer should say Notes.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">2. Open the agent</h2>
          <p>
            Open the right sidebar. If TextText Agent is already connected,
            start writing. Otherwise choose{" "}
            <strong>Set up the in-app assistant</strong>. Connection details
            stay out of the workflow after this step.
          </p>
          <p>
            <Link href="/docs/ai">Follow the connection guide</Link> if that
            path is not ready yet.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">
            3. Ask for a result you can inspect
          </h2>
          <blockquote className="docs-prompt">
            Read the notes in this folder and create a Living brief. State the
            audience and purpose. Give every source an ID and captured version,
            give every factual claim an ID and supporting evidence, and keep the
            source-to-claim relationship visible. Add three concise writing
            rules. Do not invent evidence or publish anything.
          </blockquote>
          <p>
            While it works, the rail names the operation: reading the source
            list, opening exact documents, and building the sourced brief. It
            does not fill the conversation with retry or provider narration.
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
          <h2 className="connect-section-title">4. Inspect the result</h2>
          <p>
            Open the new Living brief. Read the prose first, then inspect the
            Claims and Sources ledgers. Every factual claim should have a stable
            ID, one visible source ID, a support status, and an evidence
            passage. Unsupported claims should say Review or Unsupported, not
            pretend to be grounded.
          </p>
          <p>
            <Link href="/templates/brief">
              Open the complete Living brief example
            </Link>
            .
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">5. Change a source</h2>
          <p>
            Edit one source note, return to the brief, and choose{" "}
            <strong>Check what changed in my sources</strong>. TextText compares
            the captured source versions with the current documents and names
            the exact claim IDs that need review. Then choose{" "}
            <strong>Refresh affected claims</strong>. Unrelated claims stay
            untouched.
          </p>
        </section>
        <section className="connect-section">
          <h2 className="connect-section-title">Next, revise one passage</h2>
          <p>
            Select a sentence in any document and use the{" "}
            {"selection Rewrite action"}. It previews the exact replacement
            before Apply and keeps Undo beside the result. An{" "}
            {"ordinary freeform assistant request may update"}
            the document directly instead. That smaller loop is useful after the
            brief has the right structure and evidence.
          </p>
          <p>
            Continue with the <Link href="/docs/recipes">copyable recipes</Link>
            ,<Link href="/docs/how-it-works"> learn what the agent sees</Link>,
            or
            <Link href="/docs/features"> browse verified capabilities</Link>.
          </p>
        </section>
      </main>
    </div>
  );
}
