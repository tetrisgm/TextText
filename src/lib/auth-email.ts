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

import { createTransport } from "nodemailer";
import { and, eq, lt } from "drizzle-orm";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import type { NodemailerConfig } from "next-auth/providers/nodemailer";
import { db } from "@/lib/db/client";
import { users, verificationTokens } from "@/lib/db/schema";

const EMAIL_SUB_PREFIX = "email:";

/** The stable synthetic sub for a magic-link user. */
export function emailSub(email: string): string {
  return `${EMAIL_SUB_PREFIX}${email.trim().toLowerCase()}`;
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function verificationText(url: string): string {
  return [
    "Sign in to Write",
    "",
    "Use this secure link to finish signing in:",
    url,
    "",
    "This link works once and expires after 24 hours.",
    "If you did not request this email, you can ignore it.",
  ].join("\n");
}

export function verificationHtml(url: string): string {
  const safeUrl = htmlEscape(url);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>Sign in to Write</title>
    <style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }
      body { margin: 0; padding: 0; background: #f5f5f7; color: #1d1d1f; }
      a { color: #0057d9; }
      .wrap { width: 100%; background: #f5f5f7; padding: 40px 16px; }
      .panel { max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #d2d2d7; border-radius: 14px; padding: 32px; }
      .wordmark { margin: 0 0 28px; font: 700 24px/1.1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; color: #1d1d1f; }
      h1 { margin: 0 0 12px; font: 650 22px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; color: #1d1d1f; }
      p { margin: 0 0 18px; font: 400 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #424245; }
      .button { display: inline-block; background: #1d1d1f; color: #ffffff !important; border-radius: 8px; padding: 12px 18px; font: 600 15px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-decoration: none; }
      .link { overflow-wrap: anywhere; word-break: break-word; }
      .foot { margin-top: 24px; margin-bottom: 0; font-size: 13px; line-height: 1.5; color: #6e6e73; }
      @media (prefers-color-scheme: dark) {
        body, .wrap { background: #000000; color: #f5f5f7; }
        .panel { background: #1c1c1e; border-color: #38383a; }
        .wordmark, h1 { color: #f5f5f7; }
        p { color: #d1d1d6; }
        a { color: #8ab4ff; }
        .button { background: #f5f5f7; color: #1d1d1f !important; }
        .foot { color: #a1a1a6; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <main class="panel">
        <p class="wordmark">Write</p>
        <h1>Sign in to Write</h1>
        <p>Use this secure link to finish signing in. It works once and expires after 24 hours.</p>
        <p><a class="button" href="${safeUrl}">Sign in</a></p>
        <p class="link"><a href="${safeUrl}">${safeUrl}</a></p>
        <p class="foot">If you did not request this email, you can ignore it.</p>
      </main>
    </div>
  </body>
</html>`;
}

export async function sendWriteVerificationRequest({
  identifier,
  url,
  provider,
}: {
  identifier: string;
  url: string;
  provider: NodemailerConfig;
}): Promise<void> {
  const transport = createTransport(provider.server);
  const result = await transport.sendMail({
    to: identifier,
    from: provider.from,
    subject: "Sign in to Write",
    text: verificationText(url),
    html: verificationHtml(url),
  });
  const failed = [...(result.rejected ?? []), ...(result.pending ?? [])].filter(
    Boolean,
  );
  if (failed.length) {
    throw new Error(`Email (${failed.join(", ")}) could not be sent`);
  }
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
