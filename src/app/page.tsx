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

      <nav className="write-landing-explore" aria-label="Explore Texttext">
        <p>Explore Texttext.</p>
        <div>
          <a href="#shapes">Shapes</a>
          <a href="#polls">Polls and invites</a>
          <a href="#together">Writing together</a>
          <a href="#agents">For agents</a>
          <a href="#mac">On your Mac</a>
        </div>
      </nav>

      <section id="shapes" className="write-chapter" aria-label="Templates">
        <header className="write-chapter-head">
          <p className="write-landing-kicker">Templates</p>
          <h2>
            Every document has a shape.
            <br />
            Yours to pick or invent.
          </h2>
          <p>
            Twenty-five built-in looks, from to-do lists and recipes to specs
            and postmortems. This one is a real to-do list, rendered by the
            same engine that publishes your pages.
          </p>
        </header>
        <DocumentDemo slug="todo" />
        <div className="write-chapter-claims">
          <article>
            <h3>Pick a look.</h3>
            <p>
              The content stays one document. The shape is a choice you can
              change any time.
            </p>
          </article>
          <article>
            <h3>Fill in real fields.</h3>
            <p>
              Dates, ratings, statuses, checklists, and repeating rows, edited
              right in the document.
            </p>
          </article>
          <article>
            <h3>Folders organize themselves.</h3>
            <p>
              A bookshelf sorts by rating. A project folder becomes a status
              board, column by column.
            </p>
          </article>
        </div>
        <TextLink href="/templates">Browse all the templates</TextLink>
      </section>

      <section id="polls" className="write-chapter" aria-label="Polls and invites">
        <header className="write-chapter-head">
          <p className="write-landing-kicker">Polls and invites</p>
          <h2>
            Documents that talk back.
          </h2>
          <p>
            Publish a question and the page collects answers. This is the poll
            template, ballot and all.
          </p>
        </header>
        <DocumentDemo slug="poll" />
        <div className="write-chapter-claims">
          <article>
            <h3>Ask the room.</h3>
            <p>
              Readers vote right on the published page and watch the results
              fill in live.
            </p>
          </article>
          <article>
            <h3>One tap to RSVP.</h3>
            <p>
              An invite carries when, where, and host, with a ballot that
              closes itself at showtime.
            </p>
          </article>
          <article>
            <h3>One response per reader.</h3>
            <p>
              Signed in or not, changing your vote updates it. Nothing counts
              twice.
            </p>
          </article>
        </div>
        <TextLink href="/templates/poll">See the poll template</TextLink>
      </section>

      <section id="together" className="write-chapter" aria-label="Writing together">
        <header className="write-chapter-head">
          <p className="write-landing-kicker">Collaboration</p>
          <h2>
            Write together.
            <br />
            Stay on the record.
          </h2>
          <p>
            Meetings are where shared writing earns its keep. This is the
            meeting template: discussion, decisions, and owned action items.
          </p>
        </header>
        <DocumentDemo slug="meeting" />
        <div className="write-chapter-claims">
          <article>
            <h3>Everyone edits at once.</h3>
            <p>
              Live cursors and presence on the whole document, with edits that
              survive bad networks.
            </p>
          </article>
          <article>
            <h3>Comments that point.</h3>
            <p>
              Anchored to the exact words, resolvable, and still attached
              after the text moves.
            </p>
          </article>
          <article>
            <h3>AI on the record.</h3>
            <p>
              Every change an assistant or agent makes is attributed and kept
              in the audit log.
            </p>
          </article>
        </div>
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

      <section id="agents" className="write-chapter" aria-label="For agents">
        <header className="write-chapter-head">
          <p className="write-landing-kicker">For agents</p>
          <h2>
            Your AI already knows
            <br />
            how to use it.
          </h2>
          <p>
            This decision record was written about Texttext, in Texttext, and
            agents read and write documents like it every day.
          </p>
        </header>
        <DocumentDemo slug="decision" />
        <div className="write-chapter-claims">
          <article>
            <h3>Connect in a click.</h3>
            <p>
              ChatGPT, Claude, Codex, and any MCP client, approved once with
              OAuth and scoped to your workspace.
            </p>
          </article>
          <article>
            <h3>A CLI for local agents.</h3>
            <p>
              Agents on your Mac edit documents as files, with presence and
              attribution built in.
            </p>
          </article>
          <article>
            <h3>Describe a brand-new look.</h3>
            <p>
              A wine log, a match diary: an agent composes the fields and
              layout, and it publishes like any page.
            </p>
          </article>
        </div>
        <TextLink href="/docs/ai">Read the AI docs</TextLink>
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
