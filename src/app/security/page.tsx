import type { Metadata } from "next";
import { LandingFooter } from "@/components/LandingFooter";
import { LandingHeader } from "@/components/LandingHeader";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How Write protects portable Markdown files, unlisted notes, tokens, and sync.",
};

const securityFacts = [
  "Every post is a portable Markdown file you can export.",
  "Notes and bookmarks are unlisted forever at the action, store, sync, and MCP layers.",
  "Every mutation writes an action_audit record.",
  "Agent and sync access uses scoped, revocable wsk_ tokens.",
  "Sync writes use If-Match conflict checks.",
];

export default function SecurityPage() {
  return (
    <main className="write-landing write-legal-page">
      <LandingHeader signedIn={false} />
      <article className="write-legal-article write-security-article">
        <p className="write-landing-kicker">Security</p>
        <h1>Your writing stays portable first</h1>
        <p className="write-legal-lede">
          Write starts with a simple security claim: every post is a portable
          Markdown file you can export. The product is built so you can leave
          with your work instead of trusting a closed database forever.
        </p>

        <ul className="write-security-facts">
          {securityFacts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>

        <section>
          <h2>Content boundaries</h2>
          <p>
            Blog posts can become public. Notes and bookmarks are unlisted
            forever. That rule is enforced in editor actions, the store layer,
            sync API writes, and MCP tools, so a client cannot publish those
            item types by changing Markdown frontmatter.
          </p>
        </section>

        <section>
          <h2>Audit and sync</h2>
          <p>
            Every mutation writes an <code>action_audit</code> record. Sync
            clients replace whole Markdown files and must send
            <code> If-Match</code> with the last known file hash, so stale
            writes can be rejected instead of silently overwriting newer work.
          </p>
        </section>

        <section>
          <h2>API access</h2>
          <p>
            API and MCP access uses bearer tokens beginning with
            <code> wsk_</code>. Tokens are scoped and revocable. Raw token
            secrets are shown once, then stored only in hashed form.
          </p>
        </section>

        <section>
          <h2>Infrastructure basics</h2>
          <p>
            Write uses TLS in transit. Production secrets are environment-only
            values, not committed files. The Mac app signs in through Write
            instead of asking you to paste account passwords into the app.
          </p>
        </section>

        <section>
          <h2>Compliance</h2>
          <p>
            Write is in beta and does not claim SOC 2, ISO 27001, HIPAA, or
            similar certifications.
          </p>
        </section>

        <section>
          <h2>Report a security issue</h2>
          <p>
            Send security reports to{" "}
            <a href="mailto:security@write.ramine.net">security@write.ramine.net</a>.
            Include the affected URL, steps to reproduce, and whether any data
            may have been exposed.
          </p>
        </section>
      </article>
      <LandingFooter />
    </main>
  );
}
