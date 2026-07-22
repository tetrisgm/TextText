import type { Metadata } from "next";
import { LandingFooter } from "@/components/LandingFooter";
import { LandingHeader } from "@/components/LandingHeader";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How Texttext handles account, workspace, and sync data during beta.",
};

export default function PrivacyPage() {
  return (
    <main className="write-landing write-legal-page">
      <LandingHeader signedIn={false} />
      <article className="write-legal-article">
        <p className="write-landing-kicker">Privacy</p>
        <h1>Privacy during the Texttext beta</h1>
        <p className="write-legal-updated">Effective July 8, 2026</p>

        <section>
          <h2>What Texttext collects</h2>
          <p>
            Texttext stores the information needed to run your workspace: account
            email, sign-in provider identifiers, blog names, folders, posts,
            notes, bookmarks, Markdown bodies, publish state, sync hashes, and
            app connection records.
          </p>
          <p>
            If you use bookmark capture or sync features, Texttext may store the
            URL, title, excerpt, readable Markdown, screenshot, or source file
            needed to make that bookmark useful across devices.
          </p>
        </section>

        <section>
          <h2>Cookies and analytics</h2>
          <p>
            Texttext uses first-party cookies only for product needs such as
            sign-in, guest workspaces, and preferences. Texttext does not use
            third-party advertising cookies, cross-site tracking, or a consent
            banner analytics stack.
          </p>
          <p>
            Operational logs may include request metadata such as route, time,
            browser, IP address, and error details so the beta can be debugged
            and kept reliable.
          </p>
        </section>

        <section>
          <h2>How Texttext uses data</h2>
          <p>
            Texttext uses your data to provide editing, publishing, sync, app
            sign-in, security checks, abuse prevention, and support. Texttext does
            not sell personal data.
          </p>
        </section>

        <section>
          <h2>Sharing</h2>
          <p>
            Public blog posts are visible to anyone with the public URL. Notes,
            bookmarks, drafts, account data, tokens, and private workspace data
            are not shared except with service providers that help operate
            Texttext, or when required by law.
          </p>
        </section>

        <section>
          <h2>Export and deletion</h2>
          <p>
            Every post is a portable Markdown file you can export. To request
            account deletion or a data question during beta, email{" "}
            <a href="mailto:security@texttext.app">security@texttext.app</a>.
          </p>
        </section>
      </article>
      <LandingFooter />
    </main>
  );
}
