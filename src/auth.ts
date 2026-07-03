import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Apple from "next-auth/providers/apple";

const appleClientId = process.env.AUTH_APPLE_ID;
const appleClientSecret = process.env.AUTH_APPLE_SECRET;
const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

export const hasAppleProvider = Boolean(appleClientId && appleClientSecret);
export const isAuthConfigured = hasAppleProvider && Boolean(authSecret);

const providers =
  appleClientId && appleClientSecret
    ? [
        Apple({
          clientId: appleClientId,
          clientSecret: appleClientSecret,
        }),
      ]
    : [];

export const authConfig = {
  providers,
  secret: authSecret,
  session: {
    strategy: "jwt",
  },
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
  return Response.json(
    { error: "Apple sign-in is not configured." },
    { status: 503 },
  );
}

export const handlers = isAuthConfigured
  ? nextAuth.handlers
  : {
      GET: unconfiguredAuthResponse,
      POST: unconfiguredAuthResponse,
    };

export const { GET, POST } = handlers;

export async function auth() {
  if (!isAuthConfigured) return null;

  return nextAuth.auth();
}

export const signIn = nextAuth.signIn;
export const signOut = nextAuth.signOut;
