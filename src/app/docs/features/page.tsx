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
      "Documents are live. People in the same document see each other as presence avatars at the top of the page. Connected changes keep the authenticated account attribution; a supplied agent label is display metadata rather than a separate account.",
      "The in-app assistant keeps its provider identity and current document context visible in the right rail. Rewrite and Summarize selection quick actions show the exact replacement before Apply and keep Undo close after the change. An ordinary freeform turn may update the document directly.",
      "In the standalone Mac edition, local Claude and Codex plugins write through the signed-in TextText CLI. Their changes follow the same document model, permissions, validation, audit, and conflict rules. Read the updated document, then correct the text directly or ask the agent for a smaller follow-up change.",
    ],
  },
  {
    title: "Agents do real document work",
    body: [
      "The API-key in-app assistant uses the workspace-command surface for tools that need no confirmation. It can find and create items, rewrite text, organize documents, and change presentation.",
      "The standalone native assistant and hosted MCP use the broader guarded surface for comments, publishing, and collaborator management. They ask before actions that affect an audience or access.",
      "In the standalone Mac edition, Claude and Codex on this Mac use the installed TextText plugin and bundled CLI. They use your existing signed-in session, so local work needs no workspace token and no loopback server.",
      "Remote MCP clients use the hosted endpoint with a revocable bearer token created at /connect. This path is for clients that expose a bearer-token field; OAuth-only clients are not compatible with it.",
      "Hosted commands record the authenticated account and action in the audit log, stay inside that workspace, and make repeated create or append requests safe through idempotency keys. The local CLI route is documented separately and is not described here as a live cursor or sidebar proposal.",
    ],
  },
  {
    title: "Your assistant can use other apps",
    body: [
      "TextText speaks MCP in both directions. Other tools reach your documents, and your own assistant can use tools from servers you connect to it, so \u201cput this spec in Figma\u201d stays one sentence instead of a copy and a paste.",
      "A server you add is saved switched off. Turning on Allow is the consent, because connecting a URL and letting somebody else\u2019s tools into your assistant are different promises. When the assistant uses one, the conversation shows which server and which tool, and a server that did not answer is named rather than quietly missing.",
      "Paper and pen.dev can expose local MCP servers tied to the app's current file or selection. A loopback address is reachable only from that Mac, not from TextText's servers. Outbound TextText MCP connections use public https addresses in this release, so Workspace Settings does not offer a loopback preset.",
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
      "The Look library is searchable and separates Mine, Workspace, and TextText. Its preview shows item and folder impact before applying. Remix creates an independent copy; Export and validated Import move a look safely; version history restores an earlier design by copying it forward instead of rewriting history.",
    ],
  },
  {
    title: "Build your own item types",
    body: [
      "Build an item type opens one focused studio from Home, any folder menu, or the Assistant. Describe what you want or start with Editorial publication, Project board, or Quick notes without connecting a provider.",
      "Every type defines both sides of the work together: the fields and reading layout of one item, plus the list, cards, board, calendar, timeline, or index that renders its folder. Item and Folder tabs preview the real result before anything is saved.",
      "Each refinement becomes a complete design version. Undo, Redo, the history menu, and before/current comparison let you explore without losing a direction. The preview can use sample content, the selected folder's documents, an empty state, or long stress-test content in wide, tablet, and phone frames. A quality preflight blocks Done only when the type would be structurally incomplete.",
      "Types can model people and document relations, recurrence, guarded status workflows, field validation, conditional fields, and read-only computed facts. A folder can expose several named views over the same items, each with its own layout, filters, grouping, columns, and sort.",
      "Done saves one reusable, versioned type to the Look gallery and can make it the default for a destination folder. New items inherit it. Updating existing folder items stays an explicit choice.",
      "The in-app assistant and hosted MCP agents use the same create item type operation as the app, so a request for a Medium-like publication or a Notion-like project board produces the same reusable result.",
    ],
  },
  {
    title: "The AI rail",
    body: [
      "The right rail keeps the in-app assistant beside the document. Its heading names the provider, the context chip states what it can read or change, and New chat starts over without leaving the page.",
      "Before setup, the rail presents one recommended action: Set up the in-app assistant. In the standalone Mac edition, local Claude and Codex plugin instructions stay in a quiet secondary path. Remote MCP instructions remain secondary in every edition.",
      "Progress stays short and specific. A failed request shows one useful reason with Try again and Settings rather than an indefinite working state or a transcript of internal retries.",
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
            first connection.{" "}
            <Link href="/docs/ai">The AI and agent guide</Link> covers
            providers, tools, and workflows.{" "}
            <Link href="/docs/item-types">Build item types</Link> covers the
            complete builder and prompt patterns.{" "}
            <Link href="/docs/security">Security and privacy</Link> explains
            what stays local and what crosses the network.
          </p>
        </section>
      </main>
    </div>
  );
}
