import Link from "next/link";
import Script from "next/script";
import { getCurrentUser } from "@/lib/session";
import { LandingHeader } from "@/components/LandingHeader";
import { LandingFooter } from "@/components/LandingFooter";
import {
  DocumentEngineStyles,
  DocumentRenderer,
} from "@/components/document/DocumentRenderer";
import { templateExample } from "./templates/shared";

// The real sidebar, so the preview promises the workspace people actually
// open rather than a different one invented for the picture.
const workspacePlaces = [
  { name: "Home", meta: "" },
  { name: "Starred", meta: "" },
  { name: "Blog", meta: "12" },
  { name: "Notes", meta: "8" },
  { name: "Bookmarks", meta: "5" },
];

const productSteps = [
  {
    name: "Capture",
    body: "Press C from Library. Type a thought, paste a link, or keep a useful AI answer. Press Enter and keep moving.",
  },
  {
    name: "Find",
    body: "Search one private workspace from TextText or a supported, authorized AI. The document stays the source of truth.",
  },
  {
    name: "Change",
    body: "Ask in plain language. TextText names the document and operation, keeps the change attributed, and guards conflicts.",
  },
];

const trustPoints = [
  "Export your content as portable textpacks.",
  "Private items fail closed.",
  "Collaboration merges edits without replacing your local work.",
];

const previewFiles = [
  { label: "Input", value: "Any text or link" },
  { label: "Access", value: "Private workspace" },
  { label: "Next", value: "Open or undo" },
];

const actionHref = "/start";
const githubHref = "https://github.com/tetrisgm/TextText";

function PrimaryAction({ signedIn }: { signedIn: boolean }) {
  return (
    <Link
      className="texttext-landing-primary"
      href={signedIn ? "/start?to=home" : actionHref}
    >
      {signedIn ? "Open your inbox" : "Get started"}
    </Link>
  );
}

function ProductPreview() {
  return (
    <div className="texttext-landing-product" aria-label="TextText product preview">
      <div className="texttext-landing-sidebar" aria-hidden="true">
        <div className="texttext-landing-sidebar-dot" />
        {workspacePlaces.map((folder) => (
          <div
            key={folder.name}
            className={`texttext-landing-folder${
              folder.name === "Home" ? " is-active" : ""
            }`}
          >
            <span>{folder.name}</span>
            {folder.meta ? <small>{folder.meta}</small> : null}
          </div>
        ))}
      </div>
      <article className="texttext-landing-document">
        <div className="texttext-landing-editor-bar">
          <span>Quick capture</span>
          <span>Saved to Notes</span>
        </div>
        <p className="texttext-landing-document-eyebrow">Inbox</p>
        <h2>Save a thought, link, or AI answer</h2>
        <p>
          Press Enter. Keep going. TextText can file it now or let you
          organize it later.
        </p>
        <dl className="texttext-landing-file-list">
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
    <div className="texttext-section-heading">
      <p className="texttext-landing-kicker">{kicker}</p>
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
    <Link className="texttext-text-link" href={href}>
      {children}
    </Link>
  );
}

function TrustList() {
  return (
    <ul className="texttext-landing-proof-list">
      {trustPoints.map((point) => (
        <li key={point}>{point}</li>
      ))}
    </ul>
  );
}

function FolderCards() {
  return (
    <div className="texttext-landing-folders">
      {productSteps.map((folder) => (
        <article key={folder.name} className="texttext-landing-folder-card">
          <h3>{folder.name}</h3>
          <p>{folder.body}</p>
        </article>
      ))}
    </div>
  );
}

function DocumentDemo({ slug }: { slug: string }) {
  const example = templateExample(slug);
  if (!example) return null;
  return (
    <div className="texttext-doc-demo" aria-hidden="true">
      <DocumentEngineStyles />
      <div className="texttext-doc-demo-inner">
        {/* preview, because this is one. A document that is the page paints
            its paper across the whole window with a fixed pseudo-element, and
            without this flag that sheet covered the landing page above it: the
            hero rendered, laid out and hit-tested correctly, and painted
            nothing. Any document embedded inside another page needs it. */}
        <DocumentRenderer
          document={example.document}
          template={example.template}
          documentId={`landing-${slug}`}
          preview
        />
      </div>
    </div>
  );
}

function LandingDownload() {
  return (
    <section id="mac" className="texttext-landing-download" aria-label="Download TextText">
      <div className="texttext-landing-download-copy">
        <p className="texttext-landing-kicker">The desktop app</p>
        <h2>TextText on your Mac</h2>
        <p>
          Open the same workspace in a native window, capture from the menu bar,
          or send text and links from the system Share menu. The standalone
          edition also gives supported Claude and Codex agents a signed-in local
          document connection.
        </p>
      </div>
      <div className="texttext-landing-download-actions">
        <Link className="texttext-landing-primary" href="/download">
          Download for Mac
        </Link>
        <p className="texttext-landing-download-note">
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
        className="texttext-landing-folder-section"
        aria-label="How TextText works"
      >
        <SectionHeading
          kicker="One fast loop"
          title="Capture now. Find it from anywhere."
          body="Save once, then keep working from TextText or a supported AI. Every channel reads and changes the same durable document."
        />
        <FolderCards />
      </section>

      <section className="texttext-chapter" aria-label="Familiar document looks">
        <header className="texttext-chapter-head">
          <p className="texttext-landing-kicker">Familiar looks</p>
          <h2>Every item can take a familiar shape.</h2>
          <p>
            Start from a proven reading layout and change it later, without
            moving your content into another tool.
          </p>
        </header>
        <DocumentDemo slug="article" />
        <p className="texttext-chapter-links">
          <TextLink href="/templates">Browse the looks</TextLink>
        </p>
      </section>

      <section className="texttext-landing-portability" aria-label="Portability">
        <div className="texttext-landing-band-inner">
          <div>
            <p className="texttext-landing-kicker">One document model</p>
            <h2>Save once. Use it everywhere.</h2>
          </div>
          <div className="texttext-landing-band-copy">
            <p>
              The app, in-app assistant, local agent connection, and hosted MCP
              all address the same validated document. Access stays scoped,
              mutations stay attributed, and your content can be exported as
              portable textpacks.
            </p>
            <TrustList />
            <TextLink href="/security">Read security</TextLink>
          </div>
        </div>
      </section>

      <section className="texttext-landing-split" aria-label="Sharing and agents">
        <article>
          <p className="texttext-landing-kicker">Work together</p>
          <h2>Share a document, not a new workflow</h2>
          <p>
            Live cursors show who is reading and where they are typing, and
            every change stays attributed to the person who made it.
          </p>
        </article>
        <article>
          <p className="texttext-landing-kicker">Bring your AI</p>
          <h2>Prove the connection in one note</h2>
          <p>
            The in-app assistant and supported Claude or Codex connections can
            create a private note, read it back, and report where it was saved.
            Local Mac agents use the signed-in TextText connection. Remote
            agents use scoped hosted access. Their changes stay attributed.
          </p>
          <TextLink href="/docs/ai">Connect an AI</TextLink>
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
    <main className="texttext-landing">
      <LandingHeader signedIn={Boolean(user)} />

      <section className="texttext-landing-hero">
        <div className="texttext-landing-copy">
          <h1>Save anything. Bring your AI.</h1>
          <p>
            Capture a thought, link, meeting note, or useful AI answer in one
            motion. TextText keeps it as a durable document that you and any
            compatible, authorized AI can find, change, and share.
          </p>
          <div className="texttext-landing-actions">
            <PrimaryAction signedIn={Boolean(user)} />
            <span className="texttext-github-button">
              <a
                className="github-button"
                href={githubHref}
                data-color-scheme=""
                data-icon="octicon-star"
                data-size="large"
                data-show-count="true"
                aria-label="Star TextText on GitHub"
              >
                Star
              </a>
            </span>
          </div>
        </div>

        <ProductPreview />
      </section>

      <LandingSections />
      <LandingFooter />
      <Script
        src="https://buttons.github.io/buttons.js"
        strategy="afterInteractive"
      />
    </main>
  );
}
