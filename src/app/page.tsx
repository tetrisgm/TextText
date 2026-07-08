import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { LandingHeader } from "@/components/LandingHeader";
import { LandingFooter } from "@/components/LandingFooter";

const starterFolders = [
  {
    name: "Blog",
    meta: "Public",
    title: "Publish the clean work",
    body: "Articles, projects, and talks live here as portable Markdown files.",
  },
  {
    name: "Notes",
    meta: "Unlisted",
    title: "Keep the rough thinking",
    body: "Private notes stay out of the public blog and still sync as files.",
  },
  {
    name: "Bookmarks",
    meta: "Unlisted",
    title: "Save the source trail",
    body: "Capture links and excerpts beside the writing they support.",
  },
];

const trustPoints = [
  "Every post exports as Markdown.",
  "Notes and bookmarks stay unlisted.",
  "Agents use scoped tokens you can revoke.",
];

const previewFiles = [
  { label: "File", value: "field-notes/index.md" },
  { label: "Status", value: "Published" },
  { label: "Sync", value: "If-Match checked" },
];

const actionHref = "/start";
const demoHref = "/@demo";

function PrimaryAction({ signedIn }: { signedIn: boolean }) {
  return (
    <Link
      className="write-landing-primary"
      href={signedIn ? "/start?to=home" : actionHref}
    >
      {signedIn ? "Open your workspace" : "Get started"}
    </Link>
  );
}

function DemoAction() {
  return (
    <Link className="write-landing-secondary" href={demoHref}>
      See a live blog
    </Link>
  );
}

function ProductPreview() {
  return (
    <div className="write-landing-product" aria-label="Write product preview">
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
      <article className="write-landing-document">
        <div className="write-landing-editor-bar">
          <span>Blog</span>
          <span>Saved as Markdown</span>
        </div>
        <p className="write-landing-document-eyebrow">Published post</p>
        <h2>Field notes from a portable workspace</h2>
        <p>
          Start with a folder, write in Markdown, publish when it is ready, and
          keep the file when you leave.
        </p>
        <dl className="write-landing-file-list">
          {previewFiles.map((file) => (
            <div key={file.label}>
              <dt>{file.label}</dt>
              <dd>{file.value}</dd>
            </div>
          ))}
        </dl>
      </article>
    </div>
  );
}

function SectionHeading({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: string;
  body: string;
}) {
  return (
    <div className="write-section-heading">
      <p className="write-landing-kicker">{kicker}</p>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function TextLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="write-text-link" href={href}>
      {children}
    </Link>
  );
}

function TrustList() {
  return (
    <ul className="write-landing-proof-list">
      {trustPoints.map((point) => (
        <li key={point}>{point}</li>
      ))}
    </ul>
  );
}

function FolderCards() {
  return (
    <div className="write-landing-folders">
      {starterFolders.map((folder) => (
        <article key={folder.name} className="write-landing-folder-card">
          <span>{folder.meta}</span>
          <h3>{folder.name}</h3>
          <h4>{folder.title}</h4>
          <p>{folder.body}</p>
        </article>
      ))}
    </div>
  );
}

function LandingDownload() {
  return (
    <section className="write-landing-download" aria-label="Download Write">
      <div className="write-landing-download-copy">
        <p className="write-landing-kicker">The desktop app</p>
        <h2>Write on your Mac</h2>
        <p>
          The same workspace as the web, in a native window you open from the
          Dock or the menu bar, with a folder of Markdown files that sync both
          ways.
        </p>
      </div>
      <div className="write-landing-download-actions">
        <Link className="write-landing-primary" href="/download">
          Download for Mac
        </Link>
        <Link className="write-landing-secondary" href="/connect">
          Connect an agent
        </Link>
        <p className="write-landing-download-note">
          Windows and Linux are on the way.
        </p>
      </div>
    </section>
  );
}

function LandingSections() {
  return (
    <>
      <section
        className="write-landing-folder-section"
        aria-label="Starter folders"
      >
        <SectionHeading
          kicker="The workspace"
          title="Three folders, one source of truth"
          body="Blog is public when you publish. Notes and Bookmarks stay unlisted and keep their own file shape."
        />
        <FolderCards />
      </section>

      <section className="write-landing-portability" aria-label="Portability">
        <div className="write-landing-band-inner">
          <div>
            <p className="write-landing-kicker">Portability first</p>
            <h2>Leave with your files</h2>
          </div>
          <div className="write-landing-band-copy">
            <p>
              Write treats the Markdown file as the durable shape of your
              work. Sync, exports, public blog pages, and agent access all
              speak the same vocabulary.
            </p>
            <TrustList />
            <TextLink href="/security">Read security</TextLink>
          </div>
        </div>
      </section>

      <section className="write-landing-split" aria-label="Product paths">
        <article>
          <p className="write-landing-kicker">Live example</p>
          <h2>See the reader before you sign in</h2>
          <p>
            The demo is a real public blog, with the same Broadsheet reader
            your published work uses.
          </p>
          <TextLink href="/@demo">See a live blog</TextLink>
        </article>
        <article>
          <p className="write-landing-kicker">For agents</p>
          <h2>Connect tools without giving them your account</h2>
          <p>
            Use scoped <code>wsk_</code> tokens, the sync API, MCP, and
            <code> llms.txt</code> to read and update Markdown files.
          </p>
          <TextLink href="/docs/ai">Read the AI docs</TextLink>
        </article>
      </section>

      <LandingDownload />
    </>
  );
}

export default async function Home() {
  // The landing reflects the session: a signed-in writer gets straight back
  // into their workspace instead of being asked to sign in again.
  const user = await getCurrentUser();

  return (
    <main className="write-landing">
      <LandingHeader signedIn={Boolean(user)} />

      <section className="write-landing-hero">
        <div className="write-landing-copy">
          <p className="write-landing-kicker">Folders. Markdown. Publishing.</p>
          <h1>Publish from a folder, not a maze.</h1>
          <p>
            Write gives you Blog, Notes, and Bookmarks as portable Markdown
            files. Start on the web, keep the same workspace on your Mac, and
            publish the clean parts when they are ready.
          </p>
          <div className="write-landing-actions">
            <PrimaryAction signedIn={Boolean(user)} />
            <DemoAction />
          </div>
        </div>

        <ProductPreview />
      </section>

      <LandingSections />
      <LandingFooter />
    </main>
  );
}
