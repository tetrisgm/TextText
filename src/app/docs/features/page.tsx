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
      "How Home lays out is the one layout choice the workspace stores: list, one column, or cards. It is saved on the workspace rather than in the browser you set it from, so it is the same on your Mac and on the web.",
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
    title: "Agents do real document work",
    body: [
      "A connected agent works with the same tools the app uses. It can create an item with real content in the right folder, rewrite an entire document while you watch it happen, change an item's look, retitle it, set its excerpt and tags, and find items by title or by words inside their bodies.",
      "An agent authenticates with a workspace token you create at /connect and paste into the client. One token, one workspace, revocable from the same page; there is no consent screen to click through and no OAuth server to keep alive.",
      "Repeated automation is safe: an agent that retries a create or an append with the same idempotency key gets the original result back instead of a duplicate. Every agent action is recorded in the audit log under the agent's own identity, agents cannot see into workspaces they were not granted, and their comments carry their name.",
      "While an agent edits a document you have open, you see it as a collaborator: its avatar in the page header and its named cursor at the text it is writing.",
    ],
  },
  {
    title: "Your assistant can use other apps",
    body: [
      "TextText speaks MCP in both directions. Other tools reach your documents, and your own assistant can use tools from servers you connect to it, so \u201cput this spec in Figma\u201d stays one sentence instead of a copy and a paste.",
      "A server you add is saved switched off. Turning on Allow is the consent, because connecting a URL and letting somebody else\u2019s tools into your assistant are different promises. When the assistant uses one, the conversation shows which server and which tool, and a server that did not answer is named rather than quietly missing.",
      "Design tools run on your own machine: Paper and pen.dev listen on a local address that nothing on the internet can reach. Those work in the Mac app, which makes the request natively and refuses any address that is not your own machine.",
    ],
  },
  {
    title: "Looks, and who can change them",
    body: [
      "A look controls how a document reads when opened and how its folder\u2019s index renders. Choosing one is a gallery of real previews, each drawn with the look it is offering rather than a thumbnail of it.",
      "Every folder page is governed by the look on its folder, the published blog page included. There is no second layout control on a page that already has a look; the only stored layout choice besides looks is Home\u2019s own.",
      "Folders have looks too, and the folder menu changes them: applying one restyles what is already in the folder, because a folder whose index changed while every item kept the old look reads as nothing having happened.",
      "Looks are immutable versions and documents pin the exact one they use, so a newer version never restyles work behind its author. Retiring a look stops it being offered and changes nothing already wearing it.",
      "A look you want again is saved from the document that already reads that way: Save as look in the editor takes the document\u2019s own presentation, names it, and adds it to the gallery. There is no form of fields to fill in, because a look worth keeping is one you can already see.",
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
