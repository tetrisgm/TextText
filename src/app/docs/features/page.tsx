// /docs/features: what TextText does, feature by feature.
//
// House rule for this page: claims covered by the product eval are exercised in
// a running build. Connection-specific behavior names its channel explicitly,
// so local CLI and hosted MCP are not presented as one transport.

import type { Metadata } from "next";
import Link from "next/link";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "TextText features",
  description:
    "TextText notes, collections, editing, publishing, collaboration, and agent connections.",
};

const sections = [
  {
    title: "One content model, many looks",
    body: [
      "Everything you make in TextText is an item. Type a thought, a title, or paste a link into the box at the top of your Library and it becomes an item immediately, saved as you go.",
      "An item is not locked to a shape. The same content can read as a note, an article, a bookmark, or a gallery; the Look control in the editor changes how it reads without moving your words anywhere.",
    ],
  },
  {
    title: "The Library and collections",
    body: [
      "The Library lists everything, newest first, with filters for articles, notes, and bookmarks and a sort control. Collections in the left sidebar (Blog, Notes, Bookmarks) file items by kind, and each shows its count.",
      "How Home lays out is the one layout choice the workspace stores: list, one column, or cards. It is saved on the workspace rather than in the browser you set it from, so it is the same on your Mac and on the web.",
      "Starred keeps the items you pin. Trash keeps what you delete until you decide; deleting is never the end of the story.",
    ],
  },
  {
    title: "Writing",
    body: [
      "The editor keeps the title and text together. Changes save as you type, with the save state visible beside the document.",
      "You can edit the same document in TextText or through its local TextPack file. External file changes join an open document through the same collaboration model.",
    ],
  },
  {
    title: "Reading and publishing",
    body: [
      "Done editing, an item reads as a finished page: byline, reading time, and date under the title. Edit brings you straight back to the text.",
      "Items stay private by default. Notes and bookmarks are never listed publicly; publishing is a deliberate act, and a published item gets a link of its own.",
    ],
  },
  {
    title: "Working together",
    body: [
      "Documents are live. People in the same document see each other as presence avatars at the top of the page. Connected changes keep the authenticated account attribution; a supplied agent label is display metadata rather than a separate account.",
      "In the standalone Mac edition, local Claude and Codex plugins write through the signed-in TextText CLI. Their changes follow the same document model, permissions, validation, audit, and conflict rules. Read the updated document, then correct the text directly or ask the agent for a smaller follow-up change.",
    ],
  },
  {
    title: "Agents do real document work",
    body: [
      "An agent on your computer can edit TextPack files with ordinary file tools, or use the installed TextText CLI. File edits are validated and merged as document changes; a file write by itself does not prove which agent made it.",
      "In the standalone Mac edition, Claude and Codex can also use the installed TextText plugin and CLI. Local CLI work uses your signed-in session, without a workspace token or loopback server.",
      "Remote MCP clients use the hosted endpoint. ChatGPT connects through TextText sign-in and consent; other supported clients use a revocable bearer token created at /connect.",
      "Hosted commands record the authenticated account and action in the audit log, stay inside that workspace, and make repeated create or append requests safe through idempotency keys. The local CLI route is documented separately and is not described here as a live cursor or sidebar proposal.",
    ],
  },
  {
    title: "Choose a look",
    body: [
      "Choose from the looks already available in your workspace. The gallery previews a document with each look before you apply it.",
      "A document keeps the look version it was given. You can also choose a look for a folder without changing the identity or content of its documents.",
    ],
  },
] as const;

export default function FeaturesPage() {
  return (
    <div className="applecms connect-shell">
      <main className="connect-main connect-doc">
        <p className="connect-provider-kicker">TextText documentation</p>
        <h1 className="connect-title">What TextText does</h1>
        <p className="connect-lede">
          The features, as they work today. Claims covered by the product eval
          are driven in a running build. Connection-specific behavior is named
          by channel so local CLI and hosted MCP are not presented as the same
          experience.
        </p>
        {sections.map((section) => (
          <section className="connect-section" key={section.title}>
            <h2 className="connect-section-title">{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph.slice(0, 24)}>{paragraph}</p>
            ))}
          </section>
        ))}
        <section className="connect-section">
          <h2 className="connect-section-title">Go deeper</h2>
          <p>
            <Link href="/docs/getting-started">Getting started</Link> walks the
            first capture, search, and guarded edit.{" "}
            <Link href="/docs/ai">The agent guide</Link> covers
            files, CLI, and hosted MCP.{" "}
            <Link href="/docs/item-types">Item looks</Link> explains the
            presentations already available in TextText.{" "}
            <Link href="/docs/security">Security and privacy</Link> explains
            what stays local and what crosses the network.
          </p>
        </section>
      </main>
    </div>
  );
}
