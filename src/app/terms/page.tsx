import type { Metadata } from "next";
import { LandingFooter } from "@/components/LandingFooter";
import { LandingHeader } from "@/components/LandingHeader";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms for using Write during beta.",
};

export default function TermsPage() {
  return (
    <main className="write-landing write-legal-page">
      <LandingHeader signedIn={false} />
      <article className="write-legal-article">
        <p className="write-landing-kicker">Terms</p>
        <h1>Terms for using Write</h1>
        <p className="write-legal-updated">Effective July 8, 2026</p>

        <section>
          <h2>Your account</h2>
          <p>
            You are responsible for the activity in your Write account, guest
            workspace, Mac app session, and API tokens. Keep sign-in links,
            sessions, and tokens private.
          </p>
        </section>

        <section>
          <h2>Your content</h2>
          <p>
            You keep ownership of the writing, bookmarks, files, and metadata
            you create in Write. You give Write permission to store, process,
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
            Write is beta software. Features, limits, pricing, and availability
            may change. The goal is to preserve your content and keep export
            paths available, but beta software can have bugs and downtime.
          </p>
        </section>

        <section>
          <h2>Acceptable use</h2>
          <p>
            Do not use Write to attack systems, send spam, host malware,
            infringe rights, harass people, or publish illegal content. Write
            may remove content or restrict access when needed to protect the
            service, users, or legal obligations.
          </p>
        </section>

        <section>
          <h2>Tokens and app access</h2>
          <p>
            API tokens beginning with <code>wsk_</code> are credentials. You
            may revoke them from Write. If you believe a token or account was
            exposed, rotate it and contact Write.
          </p>
        </section>

        <section>
          <h2>Liability</h2>
          <p>
            Write is provided without a service-level guarantee during beta. To
            the maximum extent allowed by law, Write is not liable for indirect
            damages, lost profits, or losses caused by using beta software.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Questions about these terms can be sent to{" "}
            <a href="mailto:security@write.ramine.net">security@write.ramine.net</a>.
          </p>
        </section>
      </article>
      <LandingFooter />
    </main>
  );
}
