import Link from "next/link";
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
    name: "Create",
    body: "Type a thought, paste a link, or bring in an answer from ChatGPT, Claude, or Codex. The item appears right away.",
  },
  {
    name: "Shape",
    body: "Choose a template, or ask the assistant to reshape the same content as a note, an article, or a collection.",
  },
  {
    name: "Share",
    body: "Publish openly, keep it reachable only by link, or invite people to edit and comment with you.",
  },
];

const trustPoints = [
  "Your content stays in portable textpacks.",
  "Private items fail closed.",
  "Collaboration merges edits without replacing your local work.",
];

const previewFiles = [
  { label: "Input", value: "Text, link, or conversation" },
  { label: "Look", value: "Article" },
  { label: "Access", value: "Only me" },
];

const actionHref = "/start";

function PrimaryAction({ signedIn }: { signedIn: boolean }) {
  return (
    <Link
      className="texttext-landing-primary"
      href={signedIn ? "/start?to=home" : actionHref}
    >
      {signedIn ? "Open your workspace" : "Get started"}
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
          <span>Create an item</span>
          <span>Saved locally</span>
        </div>
        <p className="texttext-landing-document-eyebrow">New item</p>
        <h2>Start with a title, some text, or a link</h2>
        <p>
          It saves as you type. Choose a look and decide who can see it
          whenever you are ready.
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
          The same workspace as the web, in a native window you open from the
          Dock or the menu bar. Your documents sit in the Finder sidebar as
          real files, show up in Spotlight, answer to Shortcuts, and a saved
          link captures the whole page.
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
          kicker="One item, any shape"
          title="Create first. Choose the look later."
          body="Every item uses the same durable content model. Its look controls how it reads, while access controls who can see or change it."
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
            <p className="texttext-landing-kicker">Local, shared, durable</p>
            <h2>Your writing stays yours</h2>
          </div>
          <div className="texttext-landing-band-copy">
            <p>
              TextText keeps your writing and assets in portable textpacks.
              The Mac app works from local files, sync keeps devices current,
              and live collaboration adds people without changing the source.
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
          <p className="texttext-landing-kicker">Use your AI</p>
          <h2>Keep the document at the center</h2>
          <p>
            Claude, ChatGPT, Codex, and other MCP clients can create, find, and
            update the same documents you work on. Their changes stay visible
            and attributed.
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
          <h1>Everything you write, in one place.</h1>
          <p>
            Notes, articles, and the links you save. Create an item, give it a
            look, work on it with other people or your AI, and publish it with
            a link when it is ready.
          </p>
          <div className="texttext-landing-actions">
            <PrimaryAction signedIn={Boolean(user)} />
          </div>
        </div>

        <ProductPreview />
      </section>

      <LandingSections />
      <LandingFooter />
    </main>
  );
}
