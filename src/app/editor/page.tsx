import Link from "next/link";
import { getPosts } from "@/lib/store";
import { formatArticleDate } from "@/lib/content";

// Editor shell: the Apple Notes 3-column chrome (folders | list | editor),
// carried over from the ramine.net CMS via the .applecms token system in
// src/styles/apple.css. This page is the static shell; editing, auth (Sign in
// with Apple), and saving land next. Lists the demo blog's posts for now.

function FolderGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 4.5c0-1.1.9-2 2-2h2.8c.5 0 1 .2 1.4.6l.8.8h4c1.1 0 2 .9 2 2v5.6c0 1.1-.9 2-2 2h-9c-1.1 0-2-.9-2-2V4.5z"
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
}

export default async function EditorShell() {
  const posts = await getPosts("demo");
  return (
    <div
      className="applecms"
      style={{ height: "100dvh", display: "flex", flexDirection: "column" }}
    >
      <div className="ac-toolbar">
        <Link href="/" className="ac-btn ac-btn-plain">
          &#8249; Write
        </Link>
        <div className="ac-toolbar-title">Editor</div>
        <span className="ac-btn ac-btn-gray" aria-disabled="true">
          Preview
        </span>
        <span className="ac-btn ac-btn-filled" aria-disabled="true">
          Publish
        </span>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside
          className="ac-sidebar ac-chrome"
          style={{ width: 260, flex: "0 0 260px" }}
        >
          <div className="ac-list" style={{ paddingTop: 10 }}>
            <button className="ac-folder ac-folder-on" type="button">
              <span className="ac-folder-icon">
                <FolderGlyph />
              </span>
              <span className="ac-folder-name">Posts</span>
              <span className="ac-badge">{posts.length}</span>
            </button>
            <button className="ac-folder" type="button">
              <span className="ac-folder-icon">
                <FolderGlyph />
              </span>
              <span className="ac-folder-name">Drafts</span>
              <span className="ac-badge">0</span>
            </button>
            <button className="ac-folder" type="button">
              <span className="ac-folder-icon">
                <FolderGlyph />
              </span>
              <span className="ac-folder-name">About page</span>
            </button>
          </div>
          <div className="ac-account">
            <span
              className="ac-avatar"
              aria-hidden="true"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--ac-accent, #0a84ff)",
                color: "#fff",
                font: "600 12px/1 var(--ac-font-text)",
              }}
            >
              W
            </span>
            <span className="ac-account-name">Sign in with Apple: soon</span>
          </div>
        </aside>
        <main
          className="ac-listview"
          style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          <div className="ac-listview-head">
            <div className="ac-listview-title">Posts</div>
            <div className="ac-listview-count">
              {posts.length} {posts.length === 1 ? "item" : "items"}
            </div>
          </div>
          <div className="ac-notelist">
            {posts.map((p) => (
              <button key={p.slug} className="ac-noterow" type="button">
                <div className="ac-noterow-title">{p.title}</div>
                <div className="ac-noterow-sub">{formatArticleDate(p.date)}</div>
              </button>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
