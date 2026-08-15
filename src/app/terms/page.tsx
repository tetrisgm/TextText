import type { Metadata } from "next";
import { LandingFooter } from "@/components/LandingFooter";
import { LandingHeader } from "@/components/LandingHeader";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms for using TextText during beta.",
};

export default function TermsPage() {
  return (
    <main className="texttext-landing texttext-legal-page">
      <LandingHeader signedIn={false} />
      <article className="texttext-legal-article">
        <p className="texttext-landing-kicker">Terms</p>
        <h1>Terms for using TextText</h1>
        <p className="texttext-legal-updated">Effective July 8, 2026</p>

        <section>
          <h2>Your account</h2>
          <p>
            You are responsible for the activity in your TextText account,
            Mac app session, and API tokens. Keep sign-in links,
            sessions, and tokens private.
          </p>
        </section>

        <section>
          <h2>Your content</h2>
          <p>
            You keep ownership of the writing, bookmarks, files, and metadata
            you create in TextText. You give TextText permission to store, process,
            sync, and display that content so the product can work.
          </p>
          <p>
            Public posts are your responsibility. Do not publish content you do
            not have rights to publish.
          </p>
        </section>

        <section>
          <h2>Beta service</h2>
          <p>
            TextText is beta software. Features, limits, pricing, and availability
            may change. The goal is to preserve your content and keep export
            paths available, but beta software can have bugs and downtime.
          </p>
        </section>

        <section>
          <h2>Acceptable use</h2>
          <p>
            Do not use TextText to attack systems, send spam, host malware,
            infringe rights, harass people, or publish illegal content. TextText
            may remove content or restrict access when needed to protect the
            service, users, or legal obligations.
          </p>
          <p>
            Every published page carries a Report link, and reports go to a
            person. Content that crosses these rules is removed once a report
            is confirmed, and repeat publication of it can end the account.
          </p>
        </section>

        <section>
          <h2>Tokens and app access</h2>
          <p>
            API tokens beginning with <code>wsk_</code> are credentials. You
            may revoke them from TextText. If you believe a token or account was
            exposed, rotate it and contact TextText.
          </p>
        </section>

        <section>
          <h2>Liability</h2>
          <p>
            TextText is provided without a service-level guarantee during beta. To
            the maximum extent allowed by law, TextText is not liable for indirect
            damages, lost profits, or losses caused by using beta software.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Questions about these terms can be sent to{" "}
            <a href="mailto:security@texttext.app">security@texttext.app</a>.
          </p>
        </section>
      </article>
      <LandingFooter />
    </main>
  );
}
