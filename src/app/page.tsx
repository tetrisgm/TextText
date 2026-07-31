import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { LandingHeader } from "@/components/LandingHeader";
import { LandingFooter } from "@/components/LandingFooter";
import {
  DocumentEngineStyles,
  DocumentRenderer,
} from "@/components/document/DocumentRenderer";
import { templateExample } from "./templates/shared";

const workspacePlaces = [
  {
    name: "Home",
    meta: "Create",
  },
  {
    name: "Writing",
    meta: "12",
  },
  {
    name: "Read later",
    meta: "8",
  },
];

const productSteps = [
  {
    name: "Create",
    meta: "Start instantly",
    title: "Begin with whatever you have",
    body: "Type a thought, paste a URL, or bring in a useful answer from ChatGPT, Claude, or Codex.",
  },
  {
    name: "Shape",
    meta: "Pick a look",
    title: "Make one item take any form",
    body: "Choose a template or ask the assistant to reshape the same content as a note, article, collection, or reader page.",
  },
  {
    name: "Share",
    meta: "Publish or collaborate",
    title: "Send a link when it is ready",
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
    <div className="write-landing-product" aria-label="Texttext product preview">
      <div className="write-landing-sidebar" aria-hidden="true">
        <div className="write-landing-sidebar-dot" />
        {workspacePlaces.map((folder) => (
          <div
            key={folder.name}
            className={`write-landing-folder${
              folder.name === "Home" ? " is-active" : ""
            }`}
          >
            <span>{folder.name}</span>
            <small>{folder.meta}</small>
          </div>
        ))}
      </div>
      <article className="write-landing-document">
        <div className="write-landing-editor-bar">
          <span>Create an item</span>
          <span>Saved locally</span>
        </div>
        <p className="write-landing-document-eyebrow">Your next item</p>
        <h2>Start with words, a URL, or a conversation</h2>
        <p>
          The item appears immediately. Pick a look, work with the assistant,
          and share only when you decide it is ready.
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
      {productSteps.map((folder) => (
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

function DocumentDemo({ slug }: { slug: string }) {
  const example = templateExample(slug);
  if (!example) return null;
  return (
    <div className="write-doc-demo" aria-hidden="true">
      <DocumentEngineStyles />
      <div className="write-doc-demo-inner">
        <DocumentRenderer
          document={example.document}
          template={example.template}
          documentId={`landing-${slug}`}
        />
      </div>
    </div>
  );
}

function LandingDownload() {
  return (
    <section id="mac" className="write-landing-download" aria-label="Download Texttext">
      <div className="write-landing-download-copy">
        <p className="write-landing-kicker">The desktop app</p>
        <h2>Texttext on your Mac</h2>
        <p>
          The same workspace as the web, in a native window you open from the
          Dock or the menu bar. Your documents sit in the Finder sidebar as
          real files, show up in Spotlight, answer to Shortcuts, and a saved
          link captures the whole page.
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
        aria-label="How Texttext works"
      >
        <SectionHeading
          kicker="One item, any shape"
          title="Create first. Decide the format later."
          body="Every item uses the same durable content model. Its template controls how it looks, while access controls who can see or change it."
        />
        <FolderCards />
      </section>

      <section className="write-chapter" aria-label="Familiar document looks">
        <header className="write-chapter-head">
          <p className="write-landing-kicker">Familiar looks</p>
          <h2>Make it feel like the right place to write.</h2>
          <p>
            Start with a proven reading experience, then change it without
            moving your content into another tool.
          </p>
        </header>
        <DocumentDemo slug="article" />
        <div className="write-chapter-claims">
          <article>
            <h3>Medium article</h3>
            <p>
              A focused reading column, clear type hierarchy, and an author
              line that stays out of the way.
            </p>
          </article>
          <article>
            <h3>Apple Notes</h3>
            <p>
              Immediate editing, quiet controls, and a compact place for ideas
              that do not need ceremony.
            </p>
          </article>
          <article>
            <h3>Instapaper reader</h3>
            <p>
              Saved articles with local images and a calm, durable reading
              view.
            </p>
          </article>
        </div>
        <TextLink href="/templates">Browse familiar looks</TextLink>
      </section>

      <section className="write-landing-portability" aria-label="Portability">
        <div className="write-landing-band-inner">
          <div>
            <p className="write-landing-kicker">Local, shared, durable</p>
            <h2>Your writing stays yours</h2>
          </div>
          <div className="write-landing-band-copy">
            <p>
              Texttext keeps your writing and assets in portable textpacks.
              The Mac app works from local files, sync keeps devices current,
              and live collaboration adds people without changing the source.
            </p>
            <TrustList />
            <TextLink href="/security">Read security</TextLink>
          </div>
        </div>
      </section>

      <section className="write-landing-split" aria-label="Sharing and agents">
        <article>
          <p className="write-landing-kicker">Work together</p>
          <h2>Share a document, not a new workflow</h2>
          <p>
            Invite people to edit or comment, publish openly, or keep a page
            reachable only by its link. Live cursors show who is working and
            where.
          </p>
        </article>
        <article>
          <p className="write-landing-kicker">Use your AI</p>
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
    <main className="write-landing">
      <LandingHeader signedIn={Boolean(user)} />

      <section className="write-landing-hero">
        <div className="write-landing-copy">
          <p className="write-landing-kicker">Write first. Shape it later.</p>
          <h1>Create the item. Make it yours.</h1>
          <p>
            Type a thought, paste a link or conversation, or choose a template.
            Then write, reshape it with AI, collaborate live, and publish it
            with a link.
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
