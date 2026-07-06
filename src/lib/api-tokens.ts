// Bearer tokens for the machine surface (sync API v1 today, MCP next). This is
// the one module that touches the api_tokens table. Only the SHA-256 hash of a
// token is stored; the raw "wsk_..." secret is returned once at creation and
// verified by exact hash lookup in SQL, so no secret is ever string-compared in
// application code.

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./db/client";
import { apiTokens, users } from "./db/schema";

/** "wsk_" + 43 base64url chars (32 random bytes, unpadded). */
const API_TOKEN_RE = /^wsk_[A-Za-z0-9_-]{43}$/;

// last_used_at is display-grade ("used 2 hours ago"), so it is written at most
// once per hour instead of on every sync request.
const LAST_USED_TOUCH_MS = 60 * 60 * 1000;

export type ApiTokenIdentity = {
  userId: string;
  /** the owning user's Apple sub, the key getOwnedBlog resolves blogs by */
  sub: string;
  /** space-separated scopes, e.g. "sync" */
  scopes: string;
};

export type ApiTokenSummary = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
};

function mapToken(row: typeof apiTokens.$inferSelect): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

export function generateApiToken(): string {
  return `wsk_${randomBytes(32).toString("base64url")}`;
}

export function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * The token from an Authorization header, or null unless it is a well-formed
 * "Bearer wsk_..." (scheme case-insensitive per RFC 9110, exactly one token).
 */
export function parseBearerApiToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  return API_TOKEN_RE.test(match[1]) ? match[1] : null;
}

/** Mint a token for a user. The raw secret is returned here and never again. */
export async function createApiToken(
  userId: string,
  name: string,
): Promise<{ raw: string; record: ApiTokenSummary }> {
  if (!db) throw new Error("createApiToken requires DATABASE_URL");
  const raw = generateApiToken();
  const inserted = await db
    .insert(apiTokens)
    .values({ userId, name, tokenHash: hashApiToken(raw) })
    .returning();
  if (!inserted[0]) throw new Error("failed to create the token");
  return { raw, record: mapToken(inserted[0]) };
}

export async function listApiTokens(userId: string): Promise<ApiTokenSummary[]> {
  if (!db) return [];
  const rows = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
  return rows.map(mapToken);
}

/** Revoke one of the user's tokens. True when a live token was revoked. */
export async function revokeApiToken(
  userId: string,
  id: string,
): Promise<boolean> {
  if (!db) throw new Error("revokeApiToken requires DATABASE_URL");
  const revoked = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiTokens.id, id),
        eq(apiTokens.userId, userId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ id: apiTokens.id });
  return Boolean(revoked[0]);
}

/**
 * The identity behind an Authorization header, or null when the header is
 * missing/malformed, the token is unknown or revoked, or there is no database.
 */
export async function resolveApiToken(
  header: string | null,
): Promise<ApiTokenIdentity | null> {
  const token = parseBearerApiToken(header);
  if (!token || !db) return null;

  const rows = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      scopes: apiTokens.scopes,
      lastUsedAt: apiTokens.lastUsedAt,
      sub: users.appleSub,
    })
    .from(apiTokens)
    .innerJoin(users, eq(apiTokens.userId, users.id))
    .where(
      and(
        eq(apiTokens.tokenHash, hashApiToken(token)),
        isNull(apiTokens.revokedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || !row.sub) return null;

  if (
    !row.lastUsedAt ||
    Date.now() - row.lastUsedAt.getTime() > LAST_USED_TOUCH_MS
  ) {
    try {
      await db
        .update(apiTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiTokens.id, row.id));
    } catch {
      // last_used_at is display-grade; a failed touch never fails the request.
    }
  }

  return { userId: row.userId, sub: row.sub, scopes: row.scopes };
}
