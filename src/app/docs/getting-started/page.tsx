import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Save and find your first note" };

export default function GettingStartedPage() {
  return (
    <div className="connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">Getting started</p>
        <h1 className="connect-title">Save it now. Find it from any agent.</h1>
        <p className="connect-lede">
          The first TextText loop takes about a minute. Save one useful thing,
          find it from the words you remember instead of its location, and open
          the exact document. You can organize it later.
        </p>

        <section className="connect-section">
          <h2 className="connect-section-title">1. Capture without filing</h2>
          <p>
            Open Library and press <strong>C</strong>. Paste a thought, meeting
            note, useful AI answer, or URL, then press Enter. TextText keeps you
            in Library, sends text to Notes and links to Bookmarks, and returns
            a receipt with the saved title, destination, Open, and Undo. Use
            Shift+Enter for a newline.
          </p>
          <blockquote className="docs-prompt">
            The launch brief should explain who this is for, the one problem it
            solves, and the evidence we still need.
          </blockquote>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">2. Find the saved note</h2>
          <p>
            Open Search and type <strong>launch brief evidence</strong>. Open
            the matching result. Search works across titles and document
            content. The words can be separated or reordered, so you do not
            need to remember the exact sentence or where the note was filed.
          </p>
          <p>
            In the standalone Mac edition, a connected Claude or Codex agent can
            do the same thing directly:
          </p>
          <blockquote className="docs-prompt">
            Find my note about the launch brief evidence and tell me its exact
            TextText path. Do not change it.
          </blockquote>
          <p>
            A remote agent connected through hosted MCP uses the same search and
            document command surface. It should return the exact item, not crawl
            every folder or narrate that it is waiting.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">3. Make one visible change</h2>
          <p>
            Open the note and select the sentence. Choose the selection Rewrite
            action. TextText previews the exact replacement before Apply and
            keeps Undo beside the result. The assistant receipt names the item,
            operation, and stored path, with Open when the item is available.
          </p>
          <blockquote className="docs-prompt">
            Make this concrete and concise without adding facts.
          </blockquote>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">
            Save from an AI conversation
          </h2>
          <p>
            In a connected local agent, ask{" "}
            <strong>save this in TextText</strong>. The plugin uses the
            signed-in TextText capture command, routes text to Notes or a URL to
            Bookmarks, and reports the durable document path. It does not need a
            folder inventory first. Remote agents can perform the same capture
            through hosted MCP with revocable workspace access.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">You are done when</h2>
          <ul>
            <li>The capture receipt names the saved item and destination.</li>
            <li>Search opens the same private document.</li>
            <li>The agent names what it read or changed.</li>
            <li>A guarded rewrite can be applied and undone.</li>
          </ul>
          <p>
            Continue with the <Link href="/docs/recipes">writing recipes</Link>,
            including a sourced Living brief, or
            <Link href="/docs/ai"> connect another supported agent</Link>.
          </p>
        </section>
      </main>
    </div>
  );
}
