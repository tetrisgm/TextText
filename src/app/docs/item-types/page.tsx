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
            <li>Refine the result in conversation or adjust its visual direction, properties, and folder view.</li>
            <li>Inspect the Item and Folder previews with real, sample, empty, or stress-test content.</li>
            <li>Choose Done once. New items in that folder inherit the type.</li>
          </ol>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Refine without losing a direction</h2>
          <p className="connect-body">
            Every starter, agent refinement, and manual edit becomes a design
            version. Undo and Redo move between complete versions, the history
            menu jumps to any earlier direction, and Compare places the current
            design beside the previous one. Nothing is saved to the workspace
            until you choose Done.
          </p>
          <p className="connect-body">
            The preview uses the same renderer as finished documents. Check a
            selected folder&apos;s existing items, built-in sample content, a blank
            state, or deliberately long stress-test content. Wide, tablet, and
            phone frames make narrow-layout problems visible before saving. A
            deterministic preflight names important structural issues and
            prevents an incomplete type from being saved.
          </p>
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
          <h2 className="connect-section-title">Model the information, not just the page</h2>
          <p className="connect-body">
            Item types can declare text, rich text, images, dates, URLs,
            selects, numbers, checkboxes, relations, people records,
            recurrence, and repeating rows. People are ordinary linked
            TextText records, not workspace accounts. Status fields can define
            allowed transitions, and recurrence uses safe named presets.
          </p>
          <p className="connect-body">
            Computed values are read-only. They can count rows, sum a numeric
            row property, show completed rows, or compare current and target
            numbers. Text and number properties can carry validation limits,
            while secondary properties can appear conditionally after a
            checkbox or single-select choice is set.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Give one folder several useful views</h2>
          <p className="connect-body">
            A type can include named folder views such as All work, My tasks,
            Due soon, Board, or Calendar. Each view can change the safe filters,
            grouping, sort, columns, and layout while keeping the same items,
            fields, and renderer. The folder&apos;s View menu switches between the
            declared views without duplicating or rewriting any document.
          </p>
        </section>

        <section className="connect-section">
          <h2 className="connect-section-title">Keep and share the looks that work</h2>
          <p className="connect-body">
            The Look library can be searched and filtered across your own,
            workspace, and built-in looks. A preview shows how many items and
            folders use a look before you apply it. Remix creates an independent
            personal copy, and Export writes a validated TextText look file.
          </p>
          <p className="connect-body">
            Import can keep that file as a new look or, when its identifier
            matches a workspace look, create the next immutable version. Version
            history remains available, and restoring an earlier design copies
            it forward as a new version instead of rewriting history. Documents
            already using an older version keep their exact appearance.
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
            The preview is real, fields and views are validated, and Done is the
            only save action. Updating existing items is optional. Saved types
            are versioned, so later changes never silently rewrite earlier work.
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
