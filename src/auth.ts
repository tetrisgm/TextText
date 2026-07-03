import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Apple from "next-auth/providers/apple";
import Credentials from "next-auth/providers/credentials";

const appleClientId = process.env.AUTH_APPLE_ID;
const appleClientSecret = process.env.AUTH_APPLE_SECRET;
const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

export const hasAppleProvider = Boolean(appleClientId && appleClientSecret);

// A dev-only email login for exercising the authenticated flow without the
// Apple Developer portal. Double-guarded: inert unless AUTH_DEV_LOGIN=1 AND we
// are not in Vercel Production. That allows local dev and Vercel Preview (a
// shareable test setup) while it can never run on the production deployment.
export const devLoginEnabled =
  process.env.AUTH_DEV_LOGIN === "1" &&
  process.env.VERCEL_ENV !== "production";

export const isAuthConfigured =
  (hasAppleProvider || devLoginEnabled) && Boolean(authSecret);

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
  ...(devLoginEnabled ? [devProvider] : []),
];

export const authConfig = {
  providers,
  secret: authSecret,
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    async jwt({ token, profile }) {
      if (profile?.sub) {
        token.sub = profile.sub;
      }
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
