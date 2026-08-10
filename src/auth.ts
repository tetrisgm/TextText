import NextAuth from "next-auth";
import type { NextAuthConfig, Profile } from "next-auth";
import { cookies } from "next/headers";
import Apple from "next-auth/providers/apple";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import { eq } from "drizzle-orm";
import { createAuthAdapter, sendTextTextVerificationRequest } from "@/lib/auth-email";
import { db } from "@/lib/db/client";
import { isLoopbackHost } from "@/lib/loopback-host";
import { users } from "@/lib/db/schema";

import { resolveAppleClientSecret } from "@/lib/apple-secret";

const appleClientId = process.env.AUTH_APPLE_ID;
// Static AUTH_APPLE_SECRET wins; otherwise signed at boot from the .p8 key
// material (AUTH_APPLE_TEAM_ID / AUTH_APPLE_KEY_ID / AUTH_APPLE_PRIVATE_KEY),
// so the six-month Apple cap can never strand a running deployment.
const appleClientSecret = resolveAppleClientSecret();
const googleClientId = process.env.AUTH_GOOGLE_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET;
// Email magic links send over plain SMTP (MXroute): a full submission URL
// like smtps://user:pass@host:465 or smtp://user:pass@host:587 (STARTTLS).
const emailServer = process.env.AUTH_EMAIL_SERVER;
const emailFrom =
  process.env.AUTH_EMAIL_FROM ?? "TextText <noreply@TextText.app>";
const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
export const LAST_USED_PROVIDER_COOKIE = "wr_last_signin_provider";
export const SIGNIN_EMAIL_COOKIE = "wr_signin_email";
export const SIGNIN_CALLBACK_COOKIE = "wr_signin_callback";
const PROVIDER_HINT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export const hasAppleProvider = Boolean(appleClientId && appleClientSecret);
export const hasGoogleProvider = Boolean(googleClientId && googleClientSecret);

// Email magic links need verification-token storage, so the adapter (and
// with it the email provider) only exists when the sender is configured too.
// The adapter is otherwise absent on purpose: attaching one reroutes the
// OAuth callback through it (see src/lib/auth-email.ts), and the plain
// Apple-only setup should stay byte-for-byte on the adapterless path.
const adapter =
  emailServer && emailFrom ? createAuthAdapter() : undefined;
export const hasEmailProvider = Boolean(adapter);

/**
 * A dev-only email login for exercising the authenticated flow without the
 * Apple Developer portal.
 *
 * The real ways in are Apple, Google and an emailed link. This is not one of
 * them and must never appear beside them, so it is guarded three ways: it is
 * inert unless AUTH_DEV_LOGIN=1, it is off in Vercel Production, and it is
 * refused for any request that did not arrive on a loopback host.
 *
 * The last guard is the one that does not depend on where this is deployed.
 * The first two are configuration, and configuration is a habit; a dev login
 * is for local development, so serving anything other than localhost is
 * enough on its own to disqualify it.
 */
export { isLoopbackHost };

export const devLoginEnabled =
  process.env.AUTH_DEV_LOGIN === "1" &&
  process.env.VERCEL_ENV !== "production";


export const isAuthConfigured =
  (hasAppleProvider || hasGoogleProvider || hasEmailProvider ||
    devLoginEnabled) &&
  Boolean(authSecret);

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const devProvider = Credentials({
  id: "dev-login",
  name: "Developer login",
  credentials: { email: {}, name: {} },
  authorize: (credentials, request) => {
    // Refuse anywhere that is not the developer's own machine, whatever the
    // environment variables say.
    const host =
      request?.headers?.get?.("x-forwarded-host") ??
      request?.headers?.get?.("host") ??
      (request?.url ? safeHost(request.url) : null);
    if (!isLoopbackHost(host)) return null;
    const email =
      typeof credentials?.email === "string"
        ? credentials.email.trim().toLowerCase()
        : "";
    if (!email) return null;
    const name =
      typeof credentials?.name === "string" && credentials.name.trim()
        ? credentials.name.trim()
        : email.split("@")[0];
    // The id becomes the session sub, standing in for the Apple sub, so each
    // dev email maps to its own user and blog.
    return { id: `dev:${email}`, email, name };
  },
});

const providers = [
  ...(appleClientId && appleClientSecret
    ? [Apple({ clientId: appleClientId, clientSecret: appleClientSecret })]
    : []),
  ...(googleClientId && googleClientSecret
    ? [Google({ clientId: googleClientId, clientSecret: googleClientSecret })]
    : []),
  ...(hasEmailProvider
    ? [
        Nodemailer({
          server: emailServer,
          from: emailFrom,
          sendVerificationRequest: sendTextTextVerificationRequest,
        }),
      ]
    : []),
  ...(devLoginEnabled ? [devProvider] : []),
];

// The display name from a raw OAuth profile. Google carries a `name` claim;
// Apple sends the name only once, on first authorization, as a nested `user`
// object, and its own provider mapping falls back to the address so the
// account always has a display name. Mirror that here.
function profileDisplayName(
  profile: Profile,
  provider: string,
): string | undefined {
  if (typeof profile.name === "string" && profile.name) return profile.name;
  const appleUser = (
    profile as {
      user?: { name?: { firstName?: string; lastName?: string } };
    }
  ).user;
  const parts = [
    appleUser?.name?.firstName,
    appleUser?.name?.lastName,
  ].filter((part): part is string => Boolean(part));
  if (parts.length) return parts.join(" ");
  if (provider === "apple" && typeof profile.email === "string") {
    return profile.email;
  }
  return undefined;
}

async function userIdForSessionSub(sub: string): Promise<string | null> {
  if (!db) return null;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.appleSub, sub))
    .limit(1);
  return rows[0]?.id ?? null;
}

export function lastUsedProviderLabel(provider: string | undefined): string | null {
  switch (provider) {
    case "apple":
      return "Apple";
    case "google":
      return "Google";
    case "nodemailer":
      return "email";
    case "dev-login":
      return "developer login";
    default:
      return null;
  }
}

async function rememberLastUsedProvider(provider: string): Promise<void> {
  if (!lastUsedProviderLabel(provider)) return;
  try {
    const cookieStore = await cookies();
    cookieStore.set({
      name: LAST_USED_PROVIDER_COOKIE,
      value: provider,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: PROVIDER_HINT_MAX_AGE_SECONDS,
    });
  } catch (error) {
    console.warn("provider hint cookie write failed", error);
  }
}

export const authConfig = {
  providers,
  adapter,
  secret: authSecret,
  session: { strategy: "jwt" },
  trustHost: true,
  // Our /signin owns every sign-in surface; Auth.js never renders its own
  // pages. Errors also land on /signin (?error=), and the email flow's
  // "check your inbox" state lands on /signin/check.
  pages: {
    signIn: "/signin",
    error: "/signin",
    verifyRequest: "/signin/check",
  },
  callbacks: {
    // One stable token.sub per identity, across all providers:
    //   apple  -> raw Apple sub (unchanged, existing users are keyed by it)
    //   google -> "google:<sub>"
    //   email  -> "email:<lowercased address>" (the adapter user id)
    //   dev    -> "dev:<email>" (default token sub from authorize())
    async jwt({ token, user, account, profile }) {
      if (account?.type === "email") {
        if (user?.id) token.sub = user.id;
      } else if (account?.provider === "google") {
        if (profile?.sub) token.sub = `google:${profile.sub}`;
      } else if (profile?.sub) {
        token.sub = profile.sub;
      }
      if (account) {
        await rememberLastUsedProvider(account.provider);
      }
      if (account && profile && account.type !== "email") {
        // With the adapter attached, OAuth tokens seed from adapter rows or
        // stubs; restore the provider profile's identity bits so the token
        // matches what the adapterless flow always produced.
        if (typeof profile.email === "string" && profile.email) {
          token.email = profile.email;
        }
        const name = profileDisplayName(profile, account.provider);
        if (name) token.name = name;
      }
      if (account && token.sub) {
        const userId = await userIdForSessionSub(token.sub);
        if (userId) {
          token.userId = userId;
        } else {
          delete token.userId;
        }
      }
      if (token.email === "") delete token.email;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.sub = token.sub;
      }
      if (session.user && typeof token.userId === "string") {
        session.user.userId = token.userId;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

const nextAuth = NextAuth(authConfig);

function unconfiguredAuthResponse() {
  return Response.json({ error: "Sign-in is not configured." }, { status: 503 });
}

export const handlers = isAuthConfigured
  ? nextAuth.handlers
  : { GET: unconfiguredAuthResponse, POST: unconfiguredAuthResponse };

export const { GET, POST } = handlers;

export async function auth() {
  if (!isAuthConfigured) return null;
  return nextAuth.auth();
}

export const signIn = nextAuth.signIn;
export const signOut = nextAuth.signOut;
