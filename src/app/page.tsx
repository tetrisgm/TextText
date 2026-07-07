import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { LandingHeader } from "@/components/LandingHeader";

// The classic service shape: signing in IS getting started. Trying without
// an account is the demo, deliberately on the side.
const signInHref = `/signin?callbackUrl=${encodeURIComponent("/start")}`;

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

export default async function Home() {
  // The landing reflects the session: a signed-in writer gets straight back
  // into their workspace instead of being asked to sign in again.
  const user = await getCurrentUser();

  return (
    <main className="write-landing applecms">
      <LandingHeader signedIn={Boolean(user)} />

      <section className="write-landing-hero">
        <div className="write-landing-copy">
          <p className="write-landing-kicker">Folders. Markdown. Publishing.</p>
          <h1>A writing space that starts as files.</h1>
          <p>
            Sign in and you get a folder called Blog, plus Bookmarks and
            Notes: the same folders and content on the web and on your Mac.
            Curious first? Try the demo; anything you write there comes with
            you when you sign in.
          </p>
          <div className="write-landing-actions">
            {user ? (
              <Link className="write-landing-primary" href="/start?to=home">
                Open your workspace
              </Link>
            ) : (
              <>
                <a className="write-landing-primary" href={signInHref}>
                  Sign in
                </a>
                <Link className="write-landing-secondary" href="/try">
                  Try the demo
                </Link>
              </>
            )}
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

      <section className="write-landing-download" aria-label="Download Write">
        <div className="write-landing-download-copy">
          <p className="write-landing-kicker">The desktop app</p>
          <h2>Write on your Mac</h2>
          <p>
            The same workspace as the web, in a native window you open from the
            Dock or the menu bar, with a folder of real Markdown files that
            sync both ways.
          </p>
        </div>
        <div className="write-landing-download-actions">
          <a className="write-landing-primary" href="/download/Write.zip">
            Download for Mac
          </a>
          <Link className="write-landing-secondary" href="/download">
            All downloads
          </Link>
          <p className="write-landing-download-note">
            Windows and Linux are on the way.
          </p>
        </div>
      </section>
    </main>
  );
}
