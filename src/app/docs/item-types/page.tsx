import type { Metadata } from "next";
import Link from "next/link";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "Build item types with AI",
  description:
    "Design reusable TextText item and folder layouts from a prompt, a starter, or a connected agent.",
};

export default function ItemTypesDocsPage() {
  return (
    <div className="applecms connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">Item types</p>
        <h1 className="connect-title">Describe how your work should feel</h1>
        <p className="connect-lede">
          An item type combines the fields in one item with the layout of the
          folder around it. Build both together, preview both, then reuse the
          result across your workspace.
        </p>

        <section className="connect-section">
          <h2 className="connect-section-title">The shortest path</h2>
          <ol className="connect-steps">
            <li>Open Home and choose <strong>Build an item type</strong>.</li>
            <li>Describe a publication, project board, notes system, or your own idea.</li>
            <li>Choose a visual direction, fields, and a destination folder.</li>
            <li>Switch between Item and Folder until both previews feel right.</li>
            <li>Choose Done once. New items in that folder inherit the type.</li>
          </ol>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Start without connecting AI</h2>
          <p className="connect-body">
            Editorial publication, Project board, and Quick notes are complete
            starters. They work immediately and remain fully editable. A
            connected agent is used when you ask TextText to invent or refine a
            custom type from a prompt. An API key is only a fallback.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Prompts that work well</h2>
          <ul className="connect-feature-list">
            <li>“A Medium-like publication with headline, subtitle, hero image, author, and date.”</li>
            <li>“A calm Notion-like project board grouped by status, with priority and due dates.”</li>
            <li>“Fast Apple Notes-like notes with a title, body, tags, and modified date.”</li>
          </ul>
          <p className="connect-body">
            Name the information you need, the reference you like, and how the
            folder should organize its items. You can rename, add, or remove
            fields before saving.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Build through your agent</h2>
          <p className="connect-body">
            Codex with ChatGPT can design the preview inside the focused builder
            using the subscription you already connected. Claude, Codex,
            ChatGPT, and other connected agents can also create the same
            complete item types through TextText tools. Tell the agent the
            destination folder and whether existing items should change. The
            saved type appears in the Look gallery like one made in the app.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Keep control</h2>
          <p className="connect-body">
            The preview is real, the fields are validated, and Done is the only
            save action. Updating existing items is optional. Saved types are
            versioned, so later changes never silently rewrite earlier work.
          </p>
          <p className="connect-body">
            Next, <Link href="/docs/ai">connect an agent</Link> or review the{" "}
            <Link href="/docs/features">exercised feature inventory</Link>.
          </p>
        </section>
      </main>
    </div>
  );
}
