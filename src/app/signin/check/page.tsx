// The email flow's "verify request" state (pages.verifyRequest): where the
// browser lands right after a magic link is sent.

import type { Metadata } from "next";
import "@/styles/connect.css";
import "@/styles/signin.css";

export const metadata: Metadata = {
  title: "Check your email",
  description: "A sign-in link is on its way.",
};

export default function SignInCheckPage() {
  return (
    <div className="applecms connect-shell">
      <main className="connect-main signin-main">
        <h1 className="connect-title">Check your email</h1>
        <p className="connect-lede">
          A sign-in link is on its way to your inbox. Open it on this device
          to finish signing in.
        </p>
        <p className="connect-sub">
          The link works once and expires after 24 hours. Wrong address, or no
          email after a minute? <a href="/signin">Start over</a>.
        </p>
      </main>
    </div>
  );
}
