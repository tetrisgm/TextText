import type { Metadata } from "next";
import Link from "next/link";
import { LandingFooter } from "@/components/LandingFooter";
import { LandingHeader } from "@/components/LandingHeader";

export const metadata: Metadata = {
  title: "Support",
  description: "Help with TextText: sign-in, the Mac app, sync, publishing, and your account.",
};

/**
 * The support page. Reachable signed out, because someone who cannot sign in is
 * exactly who needs it, and because the App Store listing points here and a
 * reviewer arrives without an account.
 *
 * Everything here has to stay true. A support page that describes a product
 * that no longer behaves this way is worse than no page at all.
 */
export default function SupportPage() {
  return (
    <main className="texttext-landing texttext-legal-page">
      <LandingHeader signedIn={false} />
      <article className="texttext-legal-article">
        <p className="texttext-landing-kicker">Support</p>
        <h1>Getting help with TextText</h1>
        <p className="texttext-legal-updated">Updated August 10, 2026</p>

        <section>
          <h2>Write to a person</h2>
          <p>
            Email{" "}
            <a href="mailto:security@TextText.app">security@TextText.app</a> with
            what you were doing, what happened, and what you expected instead. If
            it involves the Mac app, the version from the TextText menu helps.
          </p>
        </section>

        <section>
          <h2>Signing in</h2>
          <p>
            TextText supports Sign in with Apple, Google, and an emailed link.
            There is no password to lose.
          </p>
          <p>
            An emailed link is single use and expires. If one stops working,
            request another rather than reusing the old message. Links open the
            most recent workspace you signed into.
          </p>
        </section>

        <section>
          <h2>The Mac app</h2>
          <p>
            The Mac app signs in with the same account and keeps your documents
            in Finder through a File Provider, so they behave like ordinary files.
            It updates itself; you can also check from the TextText menu.
          </p>
          <p>
            If documents are not appearing, open the app once and leave it open
            long enough to finish its first sync. Finder shows sync state in the
            file list. Signing out and back in re-registers the file provider.
          </p>
          <p>
            <Link href="/download">Download the Mac app</Link>.
          </p>
        </section>

        <section>
          <h2>Publishing</h2>
          <p>
            Published documents appear at your public address. Notes and
            bookmarks stay unlisted; publishing is something you choose per
            document, and a document that is not published is not reachable by
            anyone else.
          </p>
        </section>

        <section>
          <h2>Connecting an AI assistant</h2>
          <p>
            TextText does not sell AI usage or include it in the app. The
            assistant works once you connect your own Anthropic or OpenAI API
            key in Settings, billed by that provider to you. Document content is
            sent to the provider you connected, through TextText, when you use
            the assistant.
          </p>
          <p>
            External agents connect over MCP. See <Link href="/docs/ai">the AI
            docs</Link>.
          </p>
        </section>

        <section>
          <h2>Getting your writing out</h2>
          <p>
            Every document is Markdown and can be exported. The Mac app keeps
            them as real files, so a copy is already on your disk.
          </p>
        </section>

        <section>
          <h2>Deleting your account</h2>
          <p>
            Settings has a Delete account section. Deleting is immediate and
            permanent: it removes your account, your workspace, your documents,
            their images and files, your API tokens, and your app connections,
            and your published pages stop resolving. Nothing can be restored
            afterwards, by you or by us.
          </p>
          <p>
            <Link href="/privacy">The privacy page</Link> describes exactly what
            is removed and what is kept.
          </p>
        </section>
      </article>
      <LandingFooter />
    </main>
  );
}
