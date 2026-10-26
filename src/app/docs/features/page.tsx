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
      "Remote MCP clients use the hosted endpoint. ChatGPT connects through TextText sign-in and consent; other supported clients use a revocable bearer token created at /connect.",
      "Hosted commands record the authenticated account and action in the audit log, stay inside that workspace, and make repeated create or append requests safe through idempotency keys. The local CLI route is documented separately and is not described here as a live cursor or sidebar proposal.",
    ],
  },
  {
    title: "Your assistant can use other apps",
    body: [
      "TextText speaks MCP in both directions. Other tools reach your documents, and your own assistant can use tools from servers you connect to it, so \u201cput this spec in Figma\u201d stays one sentence instead of a copy and a paste.",
      "A server you add is saved switched off. Turning on Allow is the consent, because connecting a URL and letting somebody else\u2019s tools into your assistant are different promises. When the assistant uses one, the conversation shows which server and which tool, and a server that did not answer is named rather than quietly missing.",
      "Every external MCP call waits for review of its exact arguments, even when the server labels the tool read-only. Use the exact @mcp shortcut shown in Settings; a bare name or unrelated prose does not contact the connection. Server descriptions and safety labels are untrusted, and TextText refuses a tool or destination configuration that changed after review. Local MCP execution is disabled; agents on this Mac use the signed-in TextText CLI, with no localhost server.",
    ],
  },
  {
    title: "Choose a look",
    body: [
      "Choose from the looks already available in your workspace. The gallery previews a document with each look before you apply it.",
      "A document keeps the look version it was given. You can also choose a look for a folder without changing the identity or content of its documents.",
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
            first capture, search, and guarded edit.{" "}
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
