import type { Metadata } from "next";
import { LandingFooter } from "@/components/LandingFooter";
import { LandingHeader } from "@/components/LandingHeader";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How TextText handles account, workspace, and sync data during beta.",
};

export default function PrivacyPage() {
  return (
    <main className="texttext-landing texttext-legal-page">
      <LandingHeader signedIn={false} />
      <article className="texttext-legal-article">
        <p className="texttext-landing-kicker">Privacy</p>
        <h1>Privacy during the TextText beta</h1>
        <p className="texttext-legal-updated">Effective August 10, 2026</p>

        <section>
          <h2>What TextText collects</h2>
          <p>
            TextText stores the information needed to run your workspace: account
            email, sign-in provider identifiers, blog names, folders, posts,
            notes, bookmarks, Markdown bodies, publish state, sync hashes, and
            app connection records.
          </p>
          <p>
            If you use bookmark capture or sync features, TextText may store the
            URL, title, excerpt, readable Markdown, screenshot, or source file
            needed to make that bookmark useful across devices.
          </p>
        </section>

        <section>
          <h2>Cookies and analytics</h2>
          <p>
            TextText uses first-party cookies only for product needs such as
            sign-in, guest workspaces, and preferences. TextText does not use
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
          <h2>How TextText uses data</h2>
          <p>
            TextText uses your data to provide editing, publishing, sync, app
            sign-in, security checks, abuse prevention, and support. TextText does
            not sell personal data.
          </p>
        </section>

        <section>
          <h2>Sharing</h2>
          <p>
            Public blog posts are visible to anyone with the public URL. Notes,
            bookmarks, drafts, account data, tokens, and private workspace data
            are not shared except with service providers that help operate
            TextText, or when required by law.
          </p>
        </section>

        <section>
          <h2>Export and deletion</h2>
          <p>
            Every post is a portable Markdown file you can export. You can delete
            your account at any time in Settings, inside the app.
          </p>
          <p>
            Deleting removes your account, your workspace, your documents, their
            images and files, your API tokens, and your app connections, and your
            published pages stop resolving. Comments other people left on your
            documents are removed with them.
          </p>
          <p>
            Your workspace address stays reserved so nobody else can publish at
            your old links, and TextText keeps a one way hash of your sign-in
            identifier so a signed-out device cannot recreate the account.
            Records of changes are kept in the action log with no link to you.
          </p>
          <p>
            For a data question, email{" "}
            <a href="mailto:security@TextText.app">security@TextText.app</a>.
          </p>
        </section>
      </article>
      <LandingFooter />
    </main>
  );
}
