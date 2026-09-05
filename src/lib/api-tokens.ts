// Bearer tokens for the machine surface (sync API and hosted MCP). This is
// the one module that touches the api_tokens table. Only the SHA-256 hash of a
// token is stored; the raw "wsk_..." secret is returned once at creation and
// verified by exact hash lookup in SQL, so no secret is ever string-compared in
// application code.

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { auditInsertQuery, auditCteFrom, type AuditEntry } from "./audit";
import { sql } from "drizzle-orm";
import { db, executeAtomicBatch } from "./db/client";
import { apiTokens, users } from "./db/schema";
import {
  API_TOKEN_KINDS,
  type ApiTokenKind,
} from "./api-token-kinds";

export { API_TOKEN_KINDS, apiTokenKindLabel } from "./api-token-kinds";
export type { ApiTokenKind } from "./api-token-kinds";

/** "wsk_" + 43 base64url chars (32 random bytes, unpadded). */
const API_TOKEN_RE = /^wsk_[A-Za-z0-9_-]{43}$/;

// last_used_at is display-grade ("used 2 hours ago"), so it is written at most
// once per hour instead of on every sync request.
const LAST_USED_TOUCH_MS = 60 * 60 * 1000;

export type ApiTokenIdentity = {
  id: string;
  userId: string;
  /** user-visible connection name supplied when the capability is created */
  name: string;
  kind: ApiTokenKind;
  /** the owning user's Apple sub, the key getOwnedBlog resolves blogs by */
  sub: string;
  /** space-separated scopes, e.g. "sync" */
  scopes: string;
  /** null for non-expiring manually-created tokens */
  expiresAt: Date | null;
};

export type ApiTokenSummary = {
  id: string;
  name: string;
  kind: ApiTokenKind;
  createdAt: string;
  lastUsedAt: string | null;
  scopes?: string;
  expiresAt?: string | null;
};

function mapToken(row: typeof apiTokens.$inferSelect): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    kind: normalizeTokenKind(row.kind),
    scopes: row.scopes,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

function normalizeTokenKind(value: string | null | undefined): ApiTokenKind {
  return (API_TOKEN_KINDS as readonly string[]).includes(value ?? "")
    ? (value as ApiTokenKind)
    : "manual";
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
  options: {
    kind?: ApiTokenKind;
    scopes?: string;
    expiresAt?: Date;
    audit?: AuditEntry;
  } = {},
): Promise<{ raw: string; record: ApiTokenSummary }> {
  if (!db) throw new Error("createApiToken requires DATABASE_URL");
  const raw = generateApiToken();
  const insert = (executor: NonNullable<typeof db>) => executor
    .insert(apiTokens)
    .values({
      userId,
      name,
      kind: options.kind ?? "manual",
      tokenHash: hashApiToken(raw),
      scopes: options.scopes,
      expiresAt: options.expiresAt,
    })
    .returning();
  const audit = options.audit ?? { actorUserId: userId, actorType: "human" as const,
    actionName: "token.create", targetType: "workspace" as const, inputSummary: name };
  const inserted = (await executeAtomicBatch((executor) => [insert(executor), auditInsertQuery(audit, executor)] as const))[0];
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
  audit?: AuditEntry,
): Promise<boolean> {
  if (!db) throw new Error("revokeApiToken requires DATABASE_URL");
  const entry: AuditEntry = audit ?? { actorUserId: userId, actorType: "human" as const,
    actionName: "token.revoke", targetType: "workspace" as const, inputSummary: id };
  const result = await db.execute(sql`WITH changed AS (
    UPDATE ${apiTokens} SET revoked_at = now()
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND revoked_at IS NULL
    RETURNING id
  ), audit AS (${auditCteFrom(entry, "changed", sql`${entry.targetId ?? id}::text`)})
  SELECT id FROM changed`);
  return result.rows.length > 0;
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
  const now = new Date();

  const rows = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      name: apiTokens.name,
      kind: apiTokens.kind,
      scopes: apiTokens.scopes,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
      sub: users.appleSub,
    })
    .from(apiTokens)
    .innerJoin(users, eq(apiTokens.userId, users.id))
    .where(
      and(
        eq(apiTokens.tokenHash, hashApiToken(token)),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
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

  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    kind: normalizeTokenKind(row.kind),
    sub: row.sub,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
  };
}
