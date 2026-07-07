import NextAuth from "next-auth";
import type { NextAuthConfig, Profile } from "next-auth";
import Apple from "next-auth/providers/apple";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { createAuthAdapter } from "@/lib/auth-email";

import { resolveAppleClientSecret } from "@/lib/apple-secret";

const appleClientId = process.env.AUTH_APPLE_ID;
// Static AUTH_APPLE_SECRET wins; otherwise signed at boot from the .p8 key
// material (AUTH_APPLE_TEAM_ID / AUTH_APPLE_KEY_ID / AUTH_APPLE_PRIVATE_KEY),
// so the six-month Apple cap can never strand a running deployment.
const appleClientSecret = resolveAppleClientSecret();
const googleClientId = process.env.AUTH_GOOGLE_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET;
const resendKey = process.env.AUTH_RESEND_KEY;
const emailFrom = process.env.AUTH_EMAIL_FROM;
const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

export const hasAppleProvider = Boolean(appleClientId && appleClientSecret);
export const hasGoogleProvider = Boolean(googleClientId && googleClientSecret);

// Email magic links need verification-token storage, so the adapter (and
// with it the Resend provider) only exists when the database is wired too.
// The adapter is otherwise absent on purpose: attaching one reroutes the
// OAuth callback through it (see src/lib/auth-email.ts), and the plain
// Apple-only setup should stay byte-for-byte on the adapterless path.
const adapter =
  resendKey && emailFrom ? createAuthAdapter() : undefined;
export const hasEmailProvider = Boolean(adapter);

// A dev-only email login for exercising the authenticated flow without the
// Apple Developer portal. Double-guarded: inert unless AUTH_DEV_LOGIN=1 AND we
// are not in Vercel Production. That allows local dev and Vercel Preview (a
// shareable test setup) while it can never run on the production deployment.
export const devLoginEnabled =
  process.env.AUTH_DEV_LOGIN === "1" &&
  process.env.VERCEL_ENV !== "production";

export const isAuthConfigured =
  (hasAppleProvider || hasGoogleProvider || hasEmailProvider ||
    devLoginEnabled) &&
  Boolean(authSecret);

const devProvider = Credentials({
  id: "dev-login",
  name: "Developer login",
  credentials: { email: {}, name: {} },
  authorize: (credentials) => {
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
    ? [Resend({ apiKey: resendKey, from: emailFrom })]
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
      if (token.email === "") delete token.email;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.sub = token.sub;
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
