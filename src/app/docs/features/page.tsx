// /docs/features: what TextText does, feature by feature.
//
// House rule for this page: nothing is described here that has not been
// exercised in a running build. When a feature grows, this page grows only
// after the new behavior has been driven for real. That keeps the documentation
// an inventory of the product rather than of its intentions.

import type { Metadata } from "next";
import Link from "next/link";
import "@/styles/connect.css";

export const metadata: Metadata = {
  title: "TextText features",
  description:
    "Everything TextText does today: items, collections, the editor, publishing, collaboration, and the AI rail.",
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
      "Starred keeps the items you pin. Trash keeps what you delete until you decide; deleting is never the end of the story.",
    ],
  },
  {
    title: "Writing",
    body: [
      "The editor is a quiet page: your title in a display serif, your text under it, and nothing else asking for attention. Changes save as you type, and the save state is always visible in the corner beside the assistant.",
      "Select any passage while editing and Rewrite, Summarize, and Excerpt appear above the selection, ready to hand that text to your AI.",
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
    title: "Working together, including with your AI",
    body: [
      "Documents are live. People in the same document see each other as presence avatars at the top of the page, and every change stays attributed to whoever made it.",
      "A connected AI is a collaborator in the same sense: it has a name, a color, and an avatar, appears on documents it works in, and its edits are attributed like anyone else's.",
    ],
  },
  {
    title: "The AI rail",
    body: [
      "Everything AI lives in the rail on the right. Open, it greets you and offers starters for exactly where you are; the context chip in the composer always says what the AI is looking at. New chat starts over without leaving the page.",
      "Closed, the rail folds into a small round avatar at the bottom right, wearing your connected agent's face.",
      "Connecting is one action in the rail: continue with the AI you already use, connect another app, or bring an API key. TextText never resells AI usage; your account, your billing.",
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
          The features, as they work today. Every behavior on this page has
          been exercised in a running build before being written down here.
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
            first connection. <Link href="/docs/ai">The AI and agent guide</Link>{" "}
            covers providers, tools, and workflows.{" "}
            <Link href="/docs/security">Security and privacy</Link> explains
            what stays local and what crosses the network.
          </p>
        </section>
      </main>
    </div>
  );
}
