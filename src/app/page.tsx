import Link from "next/link";

const signInHref = `/api/auth/signin?callbackUrl=${encodeURIComponent("/start")}`;

const starterFolders = [
  {
    name: "Blog",
    meta: "Posts",
    title: "Your public writing folder",
    body: "Articles, media posts, and videos live here as Markdown files.",
  },
  {
    name: "Bookmarks",
    meta: "Links",
    title: "Saved references",
    body: "Keep sources, excerpts, and links close to the writing they support.",
  },
  {
    name: "Notes",
    meta: "Drafts",
    title: "Private thinking",
    body: "Capture rough ideas first, then turn the useful ones into posts.",
  },
];

export default function Home() {
  return (
    <main className="write-landing applecms">
      <nav className="write-landing-nav" aria-label="Write">
        <Link className="write-landing-mark" href="/">
          Write
        </Link>
        <div className="write-landing-nav-actions">
          <a className="write-landing-link" href={signInHref}>
            Sign in
          </a>
          <Link className="write-landing-button" href="/start">
            Get started
          </Link>
        </div>
      </nav>

      <section className="write-landing-hero">
        <div className="write-landing-copy">
          <p className="write-landing-kicker">Folders. Markdown. Publishing.</p>
          <h1>A writing space that starts as files.</h1>
          <p>
            Open Write and you get a folder called Blog, plus Bookmarks and
            Notes. Start as a guest, then sign in when you want the same
            folders and content across devices.
          </p>
          <div className="write-landing-actions">
            <Link className="write-landing-primary" href="/start">
              Get started
            </Link>
            <a className="write-landing-secondary" href={signInHref}>
              Sign in
            </a>
          </div>
        </div>

        <div className="write-landing-product" aria-label="Write preview">
          <div className="write-landing-sidebar" aria-hidden="true">
            <div className="write-landing-sidebar-dot" />
            {starterFolders.map((folder) => (
              <div
                key={folder.name}
                className={`write-landing-folder${
                  folder.name === "Blog" ? " is-active" : ""
                }`}
              >
                <span>{folder.name}</span>
                <small>{folder.meta}</small>
              </div>
            ))}
          </div>
          <div className="write-landing-editor" aria-hidden="true">
            <div className="write-landing-editor-bar">
              <span>Blog</span>
              <span>Saved here</span>
            </div>
            <div className="write-landing-editor-title">Give it a title</div>
            <div className="write-landing-editor-line is-wide" />
            <div className="write-landing-editor-line" />
            <div className="write-landing-editor-line is-short" />
          </div>
        </div>
      </section>

      <section className="write-landing-folders" aria-label="Starter folders">
        {starterFolders.map((folder) => (
          <article key={folder.name} className="write-landing-folder-card">
            <span>{folder.meta}</span>
            <h2>{folder.name}</h2>
            <h3>{folder.title}</h3>
            <p>{folder.body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
