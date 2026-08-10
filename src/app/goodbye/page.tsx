import type { Metadata } from "next";
import Link from "next/link";
import { LandingFooter } from "@/components/LandingFooter";
import { LandingHeader } from "@/components/LandingHeader";

export const metadata: Metadata = {
  title: "Account deleted",
  description: "Your TextText account and workspace have been deleted.",
};

/**
 * Where a deletion lands. This is the confirmation that it actually completed,
 * so it MUST render for a signed-out visitor: by the time anyone arrives here
 * their session is already cleared. It is a normal page, so the Mac app shows
 * it in its own window with no Swift work.
 */
export default function GoodbyePage() {
  return (
    <main className="texttext-landing texttext-legal-page">
      <LandingHeader signedIn={false} />
      <article className="texttext-legal-article">
        <p className="texttext-landing-kicker">Account</p>
        <h1>Your account is deleted</h1>
        <p>
          Your workspace, documents, images, tokens, and app connections are gone
          from TextText. Your published links no longer resolve.
        </p>
        <p>
          Your old address stays reserved so nobody else can publish there. There
          is nothing left to restore.
        </p>
        <p>You can start again at any time with a new account.</p>
        <p>
          <Link href="/signin">Start again</Link>
          {" or "}
          <Link href="/">go home</Link>.
        </p>
      </article>
      <LandingFooter />
    </main>
  );
}
