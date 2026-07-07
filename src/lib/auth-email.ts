// The minimal Auth.js adapter that email magic links require with JWT
// sessions. Read before editing: this adapter deliberately does LESS than a
// full Auth.js adapter, because identity in this app is not adapter-managed.
//
// How identity works here: session.user.sub is the key for everything
// (store.ts upsertUser/ensureOwnerBlog key users rows by users.apple_sub).
// Apple subs are stored raw; every other provider gets a prefix:
//   apple  -> "<raw apple sub>"
//   google -> "google:<google sub>"
//   email  -> "email:<lowercased address>"
//   dev    -> "dev:<email>" (Credentials, never touches this adapter)
// The jwt callback in src/auth.ts stamps token.sub with these values, and
// users rows are created lazily by upsertUser when a workspace is touched.
//
// What the adapter therefore has to do:
// - The email flow (@auth/core lib/actions/signin/send-token.js and
//   lib/actions/callback/index.js + handle-login.js) calls, with JWT
//   sessions: createVerificationToken, useVerificationToken, getUserByEmail,
//   createUser (first sign-in), updateUser (returning sign-in), getUser
//   (only when a session cookie is already present).
// - Merely ATTACHING an adapter also reroutes the Apple/Google OAuth
//   callback through it (getUserByAccount, then potentially the
//   create/link path in handle-login.js). getUserByAccount below always
//   returns a user, mapped onto our sub scheme, so OAuth sign-ins never
//   enter the adapter's create/link path and behave exactly as they did
//   before the adapter existed.

import { and, eq, lt } from "drizzle-orm";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { db } from "@/lib/db/client";
import { users, verificationTokens } from "@/lib/db/schema";

const EMAIL_SUB_PREFIX = "email:";

/** The stable synthetic sub for a magic-link user. */
export function emailSub(email: string): string {
  return `${EMAIL_SUB_PREFIX}${email.trim().toLowerCase()}`;
}

// providerAccountId is the provider profile's subject (Auth.js sets it from
// the mapped profile id). Apple stays raw because existing users are keyed
// that way; everything else is namespaced so subs can never collide.
function subForAccount(provider: string, providerAccountId: string): string {
  if (provider === "apple") return providerAccountId;
  return `${provider}:${providerAccountId}`;
}

type UserRow = {
  appleSub: string | null;
  email: string | null;
  name: string | null;
};

// Adapter ids ARE the synthetic subs (never the users.id uuid), so the JWT
// default token (sub = user.id) is correct without extra lookups.
function toAdapterUser(row: UserRow, fallbackSub: string): AdapterUser {
  return {
    id: row.appleSub ?? fallbackSub,
    email: row.email ?? "",
    emailVerified: null,
    name: row.name,
  };
}

async function userRowBySub(sub: string): Promise<UserRow | null> {
  const rows = await db!
    .select({ appleSub: users.appleSub, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.appleSub, sub))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Returns the adapter, or undefined when there is no database (email
 * sign-in needs token storage, so src/auth.ts only enables the email
 * provider when this returns a real adapter).
 */
export function createAuthAdapter(): Adapter | undefined {
  if (!db) return undefined;

  return {
    async createVerificationToken(token) {
      // Opportunistic cleanup: never-clicked links would otherwise pile up.
      await db!
        .delete(verificationTokens)
        .where(lt(verificationTokens.expires, new Date()));
      await db!.insert(verificationTokens).values(token);
      return token;
    },

    async useVerificationToken({ identifier, token }) {
      // Single-use by construction: consume via delete ... returning.
      const rows = await db!
        .delete(verificationTokens)
        .where(
          and(
            eq(verificationTokens.identifier, identifier),
            eq(verificationTokens.token, token),
          ),
        )
        .returning();
      return rows[0] ?? null;
    },

    // Scoped to magic-link users on purpose: an Apple/Google/dev user with
    // the same address is a different identity in this app (one sub, one
    // user, one blog), and must neither block nor be hijacked by an email
    // sign-in for that address.
    async getUserByEmail(email) {
      const sub = emailSub(email);
      const row = await userRowBySub(sub);
      return row ? toAdapterUser(row, sub) : null;
    },

    // Reached only by the email flow (getUserByAccount never returns null,
    // so the OAuth path cannot get here). Mirrors store.ts upsertUser.
    async createUser(user) {
      const email = user.email?.trim().toLowerCase();
      if (!email) throw new Error("Email sign-in requires an email address.");
      const sub = emailSub(email);
      await db!
        .insert(users)
        .values({ appleSub: sub, email, name: user.name ?? null })
        .onConflictDoNothing({ target: users.appleSub });
      return {
        id: sub,
        email,
        emailVerified: user.emailVerified ?? new Date(),
        name: user.name ?? null,
      };
    },

    // Called on every returning email sign-in to stamp emailVerified, which
    // JWT sessions do not persist; nothing to write, echo the stored row.
    async updateUser(user) {
      const row = await userRowBySub(user.id);
      return {
        id: user.id,
        email: user.email ?? row?.email ?? "",
        emailVerified: user.emailVerified ?? null,
        name: user.name ?? row?.name ?? null,
      };
    },

    // JWT sessions have no database-backed user. Returning null makes a
    // fresh sign-in simply replace the current session (exactly the
    // adapterless behavior) instead of tripping Auth.js account-linking
    // rules when someone switches providers mid-session.
    async getUser() {
      return null;
    },

    // Always non-null: a stored row when the user has touched a workspace
    // before, a stub otherwise. Either way the OAuth callback takes the
    // "existing account" path, does no adapter writes, and the jwt callback
    // in src/auth.ts restores name/email from the provider profile.
    async getUserByAccount({ provider, providerAccountId }) {
      const sub = subForAccount(provider, providerAccountId);
      const row = await userRowBySub(sub);
      if (row) return toAdapterUser(row, sub);
      return { id: sub, email: "", emailVerified: null };
    },
  } satisfies Adapter;
}
