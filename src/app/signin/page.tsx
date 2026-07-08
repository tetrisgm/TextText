// The one sign-in page. Server-rendered, plain HTML forms posting server
// actions, so it works before (or without) hydration. Shows only the
// providers that are actually configured; Auth.js's own pages never render
// (pages.signIn points here).

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  auth,
  devLoginEnabled,
  hasAppleProvider,
  hasEmailProvider,
  hasGoogleProvider,
  isAuthConfigured,
  LAST_USED_PROVIDER_COOKIE,
  lastUsedProviderLabel,
} from "@/auth";
import { getActiveGuestBlogFromCookie } from "@/lib/blog-edit-auth";
import {
  signInWithApple,
  signInWithDevLogin,
  signInWithEmail,
  signInWithGoogle,
} from "./actions";
import { sanitizeCallbackUrl } from "./callback-url";
import { authRequestHost } from "./request-host";
import { SignInSubmitButton } from "./submit-button";
import "@/styles/connect.css";
import "@/styles/signin.css";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your workspace.",
};

export const dynamic = "force-dynamic";

interface Props {
  searchParams?: Promise<{
    callbackUrl?: string | string[];
    error?: string | string[];
  }>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Human copy for Auth.js error codes (?error= on this page).
const ERROR_COPY: Record<string, string> = {
  CredentialsSignin: "That sign-in did not work. Try again.",
  Verification:
    "That sign-in link has expired or was already used. Request a fresh one.",
  OAuthAccountNotLinked:
    "That account could not be linked. Try the way you first signed in.",
  AccessDenied: "That account is not allowed to sign in.",
  Configuration:
    "Sign-in hit a server configuration problem. Try again in a moment.",
  EmailRequired: "Enter your email address first.",
  EmailSignInError: "The sign-in email could not be sent. Try again.",
};

const GENERIC_ERROR = "Something went wrong while signing you in. Try again.";
const SWALLOWED_ERROR_CODES = new Set(["OAuthCallbackError"]);

function errorCopy(errorCode: string | undefined): string | undefined {
  if (!errorCode || SWALLOWED_ERROR_CODES.has(errorCode)) return undefined;
  return ERROR_COPY[errorCode] ?? GENERIC_ERROR;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="applecms connect-shell">
      <main className="connect-main signin-main">
        <div className="signin-topline">
          <a className="signin-wordmark" href="/">
            Write
          </a>
          <a className="signin-back" href="/">
            Back
          </a>
        </div>
        {children}
      </main>
    </div>
  );
}

export default async function SignInPage({ searchParams }: Props) {
  const query = (await searchParams) ?? {};
  const callbackUrl = sanitizeCallbackUrl(
    query.callbackUrl,
    await authRequestHost(),
  );
  const errorCode = first(query.error);
  const errorMessage = errorCopy(errorCode);

  if (!isAuthConfigured) {
    return (
      <Shell>
        <h1 className="connect-title">Sign in</h1>
        <p className="connect-lede">
          Sign-in is not set up on this deployment yet.
        </p>
      </Shell>
    );
  }

  // Already signed in and nothing went wrong: continue to the destination
  // (the device-link approval page relies on this hand-off).
  if (!errorCode) {
    const session = await auth();
    if (session?.user) redirect(callbackUrl);
  }

  const hasOAuth = hasAppleProvider || hasGoogleProvider;
  const cookieStore = await cookies();
  const providerLabel = lastUsedProviderLabel(
    cookieStore.get(LAST_USED_PROVIDER_COOKIE)?.value,
  );
  const guest = await getActiveGuestBlogFromCookie();

  return (
    <Shell>
      <h1 className="connect-title">Sign in</h1>
      <p className="connect-lede">Pick up your writing where you left it.</p>

      {guest && (
        <p className="signin-notice">
          You have unsaved demo work here. Signing in will add it to your
          workspace.
        </p>
      )}

      {providerLabel && (
        <p className="signin-hint">
          You last used {providerLabel}. Use the same option to find your
          existing workspace, even if another provider uses the same email.
        </p>
      )}

      {errorMessage && (
        <p className="signin-error" role="alert">
          {errorMessage}
        </p>
      )}

      {hasOAuth && (
        <div className="signin-stack">
          {hasAppleProvider && (
            <form action={signInWithApple}>
              <input type="hidden" name="callbackUrl" value={callbackUrl} />
              <SignInSubmitButton
                className="ac-btn ac-btn-filled signin-btn"
                idleLabel="Continue with Apple"
                pendingLabel="Continuing with Apple"
                mark="apple"
              />
            </form>
          )}
          {hasGoogleProvider && (
            <form action={signInWithGoogle}>
              <input type="hidden" name="callbackUrl" value={callbackUrl} />
              <SignInSubmitButton
                className={`ac-btn signin-btn ${hasAppleProvider ? "ac-btn-gray" : "ac-btn-filled"}`}
                idleLabel="Continue with Google"
                pendingLabel="Continuing with Google"
                mark="google"
              />
            </form>
          )}
        </div>
      )}

      {hasEmailProvider && (
        <form
          className={hasOAuth ? "signin-section" : "signin-stack"}
          action={signInWithEmail}
        >
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <label className="signin-label" htmlFor="signin-email">
            {hasOAuth ? "Or use your email" : "Use your email"}
          </label>
          <input
            id="signin-email"
            className="ac-field"
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            autoComplete="email"
          />
          <SignInSubmitButton
            className={`ac-btn signin-btn ${hasOAuth ? "ac-btn-gray" : "ac-btn-filled"}`}
            idleLabel="Email me a sign-in link"
            pendingLabel="Sending link"
          />
        </form>
      )}

      {devLoginEnabled && (
        <form className="signin-section" action={signInWithDevLogin}>
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <p className="signin-label">Developer login (dev only)</p>
          <input
            className="ac-field"
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            aria-label="Email"
          />
          <input
            className="ac-field"
            name="name"
            placeholder="Name (optional)"
            aria-label="Name"
          />
          <SignInSubmitButton
            className="ac-btn ac-btn-gray signin-btn"
            idleLabel="Sign in (dev)"
            pendingLabel="Signing in"
          />
        </form>
      )}

      <p className="signin-terms">
        By continuing, you agree to Write's terms and privacy policy.
      </p>
    </Shell>
  );
}
