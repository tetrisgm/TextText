import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  oauthClients,
  oauthRefreshTokenFamilies,
} from "@/lib/db/schema";

export type OAuthConnectionSummary = {
  clientId: string;
  name: string;
  scope: string;
  connectedAt: string;
  lastUsedAt: string | null;
  grants: number;
};

type OAuthConnectionRow = {
  clientId: string;
  name: string;
  scope: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

const CONTROL_RE = /[\u0000-\u001F\u007F]/;

export function summarizeOAuthConnections(
  rows: OAuthConnectionRow[],
): OAuthConnectionSummary[] {
  const byClient = new Map<string, OAuthConnectionSummary>();

  for (const row of rows) {
    const connectedAt = row.createdAt.toISOString();
    const lastUsedAt = row.lastUsedAt?.toISOString() ?? null;
    const current = byClient.get(row.clientId);

    if (!current) {
      byClient.set(row.clientId, {
        clientId: row.clientId,
        name: row.name,
        scope: row.scope,
        connectedAt,
        lastUsedAt,
        grants: 1,
      });
      continue;
    }

    current.grants += 1;
    if (connectedAt < current.connectedAt) current.connectedAt = connectedAt;
    if (
      lastUsedAt &&
      (!current.lastUsedAt || lastUsedAt > current.lastUsedAt)
    ) {
      current.lastUsedAt = lastUsedAt;
    }
    if (row.scope === "sync") current.scope = "sync";
  }

  return [...byClient.values()].sort((left, right) => {
    const leftActivity = left.lastUsedAt ?? left.connectedAt;
    const rightActivity = right.lastUsedAt ?? right.connectedAt;
    return rightActivity.localeCompare(leftActivity);
  });
}

export async function listOAuthConnections(
  userId: string,
): Promise<OAuthConnectionSummary[]> {
  if (!db) return [];
  const now = new Date();
  const rows = await db
    .select({
      clientId: oauthRefreshTokenFamilies.clientId,
      name: oauthClients.clientName,
      scope: oauthRefreshTokenFamilies.scope,
      createdAt: oauthRefreshTokenFamilies.createdAt,
      lastUsedAt: oauthRefreshTokenFamilies.lastUsedAt,
    })
    .from(oauthRefreshTokenFamilies)
    .innerJoin(
      oauthClients,
      eq(oauthClients.clientId, oauthRefreshTokenFamilies.clientId),
    )
    .where(
      and(
        eq(oauthRefreshTokenFamilies.userId, userId),
        isNull(oauthRefreshTokenFamilies.revokedAt),
        isNull(oauthClients.revokedAt),
        gt(oauthRefreshTokenFamilies.absoluteExpiresAt, now),
        gt(oauthRefreshTokenFamilies.inactivityExpiresAt, now),
      ),
    );

  return summarizeOAuthConnections(rows);
}

function cleanClientId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 256 ||
    CONTROL_RE.test(value)
  ) {
    throw new Error("Connection not found");
  }
  return value;
}

export async function revokeOAuthConnection(
  userId: string,
  unsafeClientId: unknown,
): Promise<number> {
  if (!db) throw new Error("OAuth connections require DATABASE_URL");
  const clientId = cleanClientId(unsafeClientId);
  const result = await db.execute<{ revoked_count: number | string }>(sql`
    WITH families AS MATERIALIZED (
      SELECT id
        FROM oauth_refresh_token_families
       WHERE user_id = ${userId}
         AND client_id = ${clientId}
         AND revoked_at IS NULL
       FOR UPDATE
    ),
    revoked_access AS (
      UPDATE api_tokens AS token
         SET revoked_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        FROM oauth_access_tokens AS access
       WHERE access.api_token_id = token.id
         AND access.refresh_token_family_id IN (SELECT id FROM families)
         AND token.revoked_at IS NULL
      RETURNING token.id
    ),
    revoked_families AS (
      UPDATE oauth_refresh_token_families AS family
         SET revoked_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
       WHERE family.id IN (SELECT id FROM families)
      RETURNING family.id
    ),
    audit AS (
      INSERT INTO action_audit (
        actor_user_id,
        actor_type,
        action_name,
        target_type,
        target_id,
        input_summary,
        output_summary
      )
      SELECT
        ${userId},
        'human',
        'oauth.disconnect',
        'oauth_connection',
        ${clientId},
        'Disconnected an AI client',
        CONCAT('Revoked ', COUNT(*), ' OAuth grant(s)')
      FROM revoked_families
      HAVING COUNT(*) > 0
      RETURNING id
    )
    SELECT COUNT(*)::int AS revoked_count
      FROM revoked_families
  `);

  return Number(result.rows?.[0]?.revoked_count ?? 0);
}
