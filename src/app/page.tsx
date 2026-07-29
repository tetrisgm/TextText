import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { LandingHeader } from "@/components/LandingHeader";
import { LandingFooter } from "@/components/LandingFooter";

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

function LandingDownload() {
  return (
    <section className="write-landing-download" aria-label="Download Texttext">
      <div className="write-landing-download-copy">
        <p className="write-landing-kicker">The desktop app</p>
        <h2>Texttext on your Mac</h2>
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
        aria-label="How Texttext works"
      >
        <SectionHeading
          kicker="One item, any shape"
          title="Create first. Decide the format later."
          body="Every item uses the same durable content model. Its template controls how it looks, while access controls who can see or change it."
        />
        <FolderCards />
      </section>

      <section className="write-landing-split" aria-label="Templates">
        <article>
          <p className="write-landing-kicker">Twenty-five built-in looks</p>
          <h2>Every document has a shape</h2>
          <p>
            To-do lists, recipes, reading logs, changelogs, specs, postmortems,
            polls, and invites. Each is typed fields plus a layout, and the
            gallery shows every one as a real example you can open and read.
          </p>
          <TextLink href="/templates">Browse the templates</TextLink>
        </article>
        <article>
          <p className="write-landing-kicker">Made to order</p>
          <h2>Describe a new kind of document</h2>
          <p>
            Ask a connected AI for a wine log or a match diary and it composes
            the look itself: fields, layout, and folder sorting. The result
            publishes like any other page.
          </p>
          <TextLink href="/docs/ai">See how agents build looks</TextLink>
        </article>
      </section>

      <section className="write-landing-portability" aria-label="Portability">
        <div className="write-landing-band-inner">
          <div>
            <p className="write-landing-kicker">Local and collaborative</p>
            <h2>Your files stay yours</h2>
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

      <section className="write-landing-split" aria-label="Product paths">
        <article>
          <p className="write-landing-kicker">Live example</p>
          <h2>See what a shared item can become</h2>
          <p>
            The demo uses the same content engine and templates available in
            your workspace.
          </p>
          <TextLink href="/@demo">See a live blog</TextLink>
        </article>
        <article>
          <p className="write-landing-kicker">For agents</p>
          <h2>Bring your writing conversations with you</h2>
          <p>
            Paste useful answers directly, use the private on-device assistant,
            or connect ChatGPT, Claude, Codex, and other tools through MCP.
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
