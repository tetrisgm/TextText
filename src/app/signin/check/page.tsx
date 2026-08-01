// The email flow's "verify request" state (pages.verifyRequest): where the
// browser lands right after a magic link is sent.

import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  SIGNIN_CALLBACK_COOKIE,
  SIGNIN_EMAIL_COOKIE,
} from "@/auth";
import { signInWithEmail } from "../actions";
import { sanitizeCallbackUrl } from "../callback-url";
import { authRequestHost } from "../request-host";
import { SignInSubmitButton } from "../submit-button";
import "@/styles/connect.css";
import "@/styles/signin.css";

export const metadata: Metadata = {
  title: "Check your email",
  description: "A sign-in link is on its way.",
};

export const dynamic = "force-dynamic";

export default async function SignInCheckPage() {
  const cookieStore = await cookies();
  const email = cookieStore.get(SIGNIN_EMAIL_COOKIE)?.value;
  const callbackUrl = sanitizeCallbackUrl(
    cookieStore.get(SIGNIN_CALLBACK_COOKIE)?.value,
    await authRequestHost(),
  );

  return (
    <div className="applecms connect-shell">
      <main className="connect-main signin-main">
        <div className="signin-topline">
          <a className="signin-wordmark" href="/">
            TextText
          </a>
          <a className="signin-back" href="/signin">
            Back
          </a>
        </div>
        <h1 className="connect-title">Check your email</h1>
        <p className="connect-lede">
          A sign-in link is on its way
          {email ? (
            <>
              {" "}
              to <strong>{email}</strong>
            </>
          ) : (
            " to your inbox"
          )}
          . Open it on this device to finish signing in.
        </p>
        <p className="connect-sub">
          The link works once and expires after 24 hours.
        </p>
        {email ? (
          <form className="signin-section" action={signInWithEmail}>
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <SignInSubmitButton
              className="ac-btn ac-btn-gray signin-btn"
              idleLabel="Resend link"
              pendingLabel="Sending link"
            />
            <p className="signin-small">
              Wrong address? <a href="/signin">Use a different email</a>.
            </p>
          </form>
        ) : (
          <p className="connect-sub">
            Wrong address, or no email after a minute?{" "}
            <a href="/signin">Start over</a>.
          </p>
        )}
        <p className="signin-terms">
          By continuing, you agree to TextText's terms and privacy policy.
        </p>
      </main>
    </div>
  );
}
