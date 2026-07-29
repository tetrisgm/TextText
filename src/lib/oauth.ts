import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import {
  createApiToken,
  generateApiToken,
  hashApiToken,
  revokeApiToken,
} from "@/lib/api-tokens";
import { db, executeAtomicBatch } from "@/lib/db/client";
import {
  oauthAccessTokens,
  oauthAuthorizationCodes,
  oauthRefreshTokenFamilies,
  oauthRefreshTokens,
} from "@/lib/db/schema";

export {
  oauthAccessTokens,
  oauthAuthorizationCodes,
  oauthRefreshTokenFamilies,
  oauthRefreshTokens,
} from "@/lib/db/schema";
export type {
  NewOAuthAuthorizationCode,
  NewOAuthRefreshToken,
  NewOAuthRefreshTokenFamily,
  OAuthAccessToken,
  OAuthAuthorizationCode,
  OAuthRefreshToken,
  OAuthRefreshTokenFamily,
} from "@/lib/db/schema";

export const OAUTH_SCOPE = "sync";
export const OAUTH_READ_SCOPE = "read";
export const OAUTH_SCOPES = [OAUTH_READ_SCOPE, OAUTH_SCOPE] as const;
export const OAUTH_CODE_TTL_SECONDS = 60;
export const OAUTH_CODE_BYTES = 32;
export const OAUTH_CODE_PREFIX = "woc_";
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const OAUTH_REFRESH_ABSOLUTE_TTL_SECONDS = 180 * 24 * 60 * 60;
export const OAUTH_REFRESH_INACTIVITY_TTL_SECONDS = 30 * 24 * 60 * 60;
export const OAUTH_REFRESH_TOKEN_BYTES = 32;
export const OAUTH_REFRESH_TOKEN_PREFIX = "wrt_";

const CLIENT_ID_RE = /^[A-Za-z0-9._~-]{1,128}$/;
const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const REFRESH_TOKEN_RE = /^wrt_[A-Za-z0-9_-]{43}$/;
const CONTROL_RE = /[\u0000-\u001F\u007F]/;

export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export function isOAuthScope(value: string): value is OAuthScope {
  return OAUTH_SCOPES.some((scope) => scope === value);
}

export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_scope"
  | "invalid_target"
  | "unsupported_grant_type"
  | "unsupported_response_type"
  | "access_denied"
  | "server_error"
  | "temporarily_unavailable";

export class OAuthRequestError extends Error {
  readonly code: OAuthErrorCode;
  readonly status: number;

  constructor(code: OAuthErrorCode, description: string, status = 400) {
    super(description);
    this.name = "OAuthRequestError";
    this.code = code;
    this.status = status;
  }
}

export type OAuthClient = {
  clientId: string;
  name: string;
  redirectUris: string[];
  defaultScope?: OAuthScope;
  dev?: boolean;
};

export type OAuthAuthorizationRequest = {
  client: OAuthClient;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: OAuthScope;
  state?: string;
};

export type OAuthRedirectValidation =
  | { ok: true }
  | { ok: false; error: OAuthErrorCode; description: string };

export type OAuthAuthorizeValidation =
  | { ok: true; request: OAuthAuthorizationRequest }
  | {
      ok: false;
      error: OAuthRequestError;
      redirectUri?: string;
      state?: string;
    };

export type OAuthAuthorizationCodeRecord = {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: OAuthScope;
};

export type OAuthAuthorizationCodeStore = {
  insert(input: {
    codeHash: string;
    userId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    scope: OAuthScope;
    expiresAt: Date;
  }): Promise<void>;
  consume(input: {
    codeHash: string;
    clientId: string;
    redirectUri: string;
    now: Date;
  }): Promise<OAuthAuthorizationCodeRecord | null>;
};

export type OAuthTokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: typeof OAUTH_ACCESS_TOKEN_TTL_SECONDS;
  refresh_token: string;
  scope: OAuthScope;
};

export type OAuthTokenStore = {
  issue(input: {
    familyId: string;
    refreshTokenId: string;
    refreshTokenHash: string;
    userId: string;
    clientId: string;
    clientName: string;
    scope: OAuthScope;
    now: Date;
    accessTokenExpiresAt: Date;
    absoluteExpiresAt: Date;
    inactivityExpiresAt: Date;
  }): Promise<{ accessToken: string }>;
  rotate(input: {
    presentedRefreshTokenHash: string;
    clientId: string;
    clientName: string;
    requestedScope?: OAuthScope;
    newAccessTokenId: string;
    newAccessTokenHash: string;
    newAccessTokenExpiresAt: Date;
    newRefreshTokenId: string;
    newRefreshTokenHash: string;
    newInactivityExpiresAt: Date;
    now: Date;
  }): Promise<
    | { status: "rotated"; scope: OAuthScope }
    | { status: "invalid" | "replayed" | "scope_mismatch" }
  >;
};

export const databaseAuthorizationCodeStore: OAuthAuthorizationCodeStore = {
  async insert(input) {
    if (!db) throw new Error("OAuth authorization codes require DATABASE_URL");

    const now = new Date();
    await db
      .delete(oauthAuthorizationCodes)
      .where(lt(oauthAuthorizationCodes.expiresAt, now));

    await db.insert(oauthAuthorizationCodes).values(input);
  },

  async consume(input) {
    if (!db) throw new Error("OAuth authorization codes require DATABASE_URL");

    const rows = await db
      .update(oauthAuthorizationCodes)
      .set({ consumedAt: input.now })
      .where(
        and(
          eq(oauthAuthorizationCodes.codeHash, input.codeHash),
          eq(oauthAuthorizationCodes.clientId, input.clientId),
          eq(oauthAuthorizationCodes.redirectUri, input.redirectUri),
          isNull(oauthAuthorizationCodes.consumedAt),
          gt(oauthAuthorizationCodes.expiresAt, input.now),
        ),
      )
      .returning({
        userId: oauthAuthorizationCodes.userId,
        clientId: oauthAuthorizationCodes.clientId,
        redirectUri: oauthAuthorizationCodes.redirectUri,
        codeChallenge: oauthAuthorizationCodes.codeChallenge,
        scope: oauthAuthorizationCodes.scope,
      });
    const row = rows[0];
    if (!row || !isOAuthScope(row.scope)) return null;
    return {
      userId: row.userId,
      clientId: row.clientId,
      redirectUri: row.redirectUri,
      codeChallenge: row.codeChallenge,
      scope: row.scope,
    };
  },
};

type DatabaseRotationRow = {
  status: "rotated" | "invalid" | "replayed" | "scope_mismatch";
  scope: string | null;
};

// Raw SQL parameters do not receive Drizzle's timestamp column encoder. Cast
// ISO instants explicitly so timestamp-without-time-zone columns retain UTC.
function utcSqlTimestamp(value: Date) {
  return sql`(CAST(${value.toISOString()} AS timestamptz) AT TIME ZONE 'UTC')`;
}

export const databaseOAuthTokenStore: OAuthTokenStore = {
  async issue(input) {
    if (!db) throw new Error("OAuth tokens require DATABASE_URL");

    const access = await createApiToken(
      input.userId,
      `OAuth: ${input.clientName}`,
      {
        scopes: input.scope,
        expiresAt: input.accessTokenExpiresAt,
      },
    );

    try {
      await executeAtomicBatch((database) => [
        database.insert(oauthRefreshTokenFamilies).values({
          id: input.familyId,
          userId: input.userId,
          clientId: input.clientId,
          scope: input.scope,
          createdAt: input.now,
          lastUsedAt: input.now,
          absoluteExpiresAt: input.absoluteExpiresAt,
          inactivityExpiresAt: input.inactivityExpiresAt,
        }),
        database.insert(oauthAccessTokens).values({
          apiTokenId: access.record.id,
          refreshTokenFamilyId: input.familyId,
          createdAt: input.now,
        }),
        database.insert(oauthRefreshTokens).values({
          id: input.refreshTokenId,
          refreshTokenFamilyId: input.familyId,
          tokenHash: input.refreshTokenHash,
          accessTokenId: access.record.id,
          createdAt: input.now,
        }),
      ] as const);
    } catch (cause) {
      try {
        await revokeApiToken(input.userId, access.record.id);
      } catch {
        // The raw access token is never returned after a lifecycle write fails.
      }
      throw cause;
    }

    return { accessToken: access.raw };
  },

  async rotate(input) {
    if (!db) throw new Error("OAuth tokens require DATABASE_URL");
    const requestedScope = input.requestedScope ?? null;
    const result = await db.execute<DatabaseRotationRow>(sql`
      WITH matched AS MATERIALIZED (
        SELECT
          refresh.id AS refresh_token_id,
          refresh.refresh_token_family_id AS family_id,
          refresh.consumed_at,
          refresh.access_token_id,
          family.user_id,
          family.scope,
          family.revoked_at AS family_revoked_at,
          family.absolute_expires_at,
          family.inactivity_expires_at,
          access_token.revoked_at AS access_revoked_at
        FROM oauth_refresh_tokens AS refresh
        INNER JOIN oauth_refresh_token_families AS family
          ON family.id = refresh.refresh_token_family_id
        LEFT JOIN api_tokens AS access_token
          ON access_token.id = refresh.access_token_id
        WHERE refresh.token_hash = ${input.presentedRefreshTokenHash}
          AND family.client_id = ${input.clientId}
        FOR UPDATE OF refresh, family
      ),
      replayed AS (
        UPDATE oauth_refresh_token_families AS family
        SET
          revoked_at = COALESCE(
            family.revoked_at,
            ${utcSqlTimestamp(input.now)}
          ),
          replay_detected_at = COALESCE(
            family.replay_detected_at,
            ${utcSqlTimestamp(input.now)}
          )
        FROM matched
        WHERE family.id = matched.family_id
          AND matched.consumed_at IS NOT NULL
        RETURNING family.id
      ),
      revoked_access AS (
        UPDATE api_tokens AS access_token
        SET revoked_at = ${utcSqlTimestamp(input.now)}
        FROM oauth_access_tokens AS access, replayed
        WHERE access.api_token_id = access_token.id
          AND access.refresh_token_family_id = replayed.id
          AND access_token.revoked_at IS NULL
        RETURNING access_token.id
      ),
      eligible AS MATERIALIZED (
        SELECT matched.*
        FROM matched
        WHERE matched.consumed_at IS NULL
          AND matched.family_revoked_at IS NULL
          AND matched.absolute_expires_at > ${utcSqlTimestamp(input.now)}
          AND matched.inactivity_expires_at > ${utcSqlTimestamp(input.now)}
          AND matched.access_token_id IS NOT NULL
          AND matched.access_revoked_at IS NULL
          AND matched.scope IN (${OAUTH_READ_SCOPE}, ${OAUTH_SCOPE})
          AND NOT EXISTS (SELECT 1 FROM replayed)
      ),
      consumed AS (
        UPDATE oauth_refresh_tokens AS refresh
        SET consumed_at = ${utcSqlTimestamp(input.now)}
        FROM eligible
        WHERE refresh.id = eligible.refresh_token_id
          AND (
            CAST(${requestedScope} AS text) IS NULL
            OR eligible.scope = CAST(${requestedScope} AS text)
          )
        RETURNING refresh.id, refresh.refresh_token_family_id
      ),
      touched AS (
        UPDATE oauth_refresh_token_families AS family
        SET
          last_used_at = ${utcSqlTimestamp(input.now)},
          inactivity_expires_at = LEAST(
            family.absolute_expires_at,
            ${utcSqlTimestamp(input.newInactivityExpiresAt)}
          )
        FROM consumed, eligible
        WHERE family.id = consumed.refresh_token_family_id
          AND eligible.family_id = family.id
        RETURNING family.id, family.user_id, family.scope
      ),
      inserted_api AS (
        INSERT INTO api_tokens (
          id,
          user_id,
          name,
          token_hash,
          scopes,
          created_at,
          expires_at
        )
        SELECT
          ${input.newAccessTokenId},
          touched.user_id,
          ${`OAuth: ${input.clientName}`},
          ${input.newAccessTokenHash},
          touched.scope,
          ${utcSqlTimestamp(input.now)},
          ${utcSqlTimestamp(input.newAccessTokenExpiresAt)}
        FROM touched
        RETURNING id
      ),
      inserted_access AS (
        INSERT INTO oauth_access_tokens (
          api_token_id,
          refresh_token_family_id,
          created_at
        )
        SELECT
          inserted_api.id,
          touched.id,
          ${utcSqlTimestamp(input.now)}
        FROM inserted_api
        CROSS JOIN touched
        RETURNING api_token_id, refresh_token_family_id
      ),
      inserted_refresh AS (
        INSERT INTO oauth_refresh_tokens (
          id,
          refresh_token_family_id,
          token_hash,
          access_token_id,
          created_at
        )
        SELECT
          ${input.newRefreshTokenId},
          inserted_access.refresh_token_family_id,
          ${input.newRefreshTokenHash},
          inserted_access.api_token_id,
          ${utcSqlTimestamp(input.now)}
        FROM inserted_access
        RETURNING refresh_token_family_id
      )
      SELECT
        CASE
          WHEN EXISTS (SELECT 1 FROM replayed) THEN 'replayed'
          WHEN EXISTS (SELECT 1 FROM inserted_refresh) THEN 'rotated'
          WHEN EXISTS (
            SELECT 1
            FROM eligible
            WHERE CAST(${requestedScope} AS text) IS NOT NULL
              AND eligible.scope <> CAST(${requestedScope} AS text)
          ) THEN 'scope_mismatch'
          ELSE 'invalid'
        END AS status,
        (SELECT scope FROM touched LIMIT 1) AS scope,
        (SELECT count(*) FROM revoked_access) AS revoked_access_count
    `);
    const row = result.rows[0];
    if (!row) return { status: "invalid" };
    if (row.status === "rotated") {
      if (!row.scope || !isOAuthScope(row.scope)) {
        throw new Error("OAuth refresh family has an invalid scope");
      }
      return { status: "rotated", scope: row.scope };
    }
    return { status: row.status };
  },
};

export function cleanOAuthClientName(value: unknown): string {
  if (typeof value !== "string") return "OAuth client";
  const name = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return name || "OAuth client";
}

function rawClientsFromEnv(): unknown[] {
  const raw = process.env.OAUTH_CLIENTS?.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function loadOAuthClientsFromEnv(): OAuthClient[] {
  const clients: OAuthClient[] = [];
  const seen = new Set<string>();

  for (const rawClient of rawClientsFromEnv()) {
    if (!rawClient || typeof rawClient !== "object") continue;
    const record = rawClient as Record<string, unknown>;
    const clientId =
      typeof record.client_id === "string"
        ? record.client_id
        : typeof record.clientId === "string"
          ? record.clientId
          : "";
    if (!CLIENT_ID_RE.test(clientId) || seen.has(clientId)) continue;

    const redirectUris = stringArray(
      record.redirect_uris ?? record.redirectUris,
    )
      .map((uri) => uri.trim())
      .filter((uri) => uri && !CONTROL_RE.test(uri))
      .slice(0, 20);
    if (redirectUris.length === 0) continue;

    seen.add(clientId);
    clients.push({
      clientId,
      name: cleanOAuthClientName(record.name),
      redirectUris: [...new Set(redirectUris)],
      defaultScope:
        typeof record.scope === "string" && isOAuthScope(record.scope)
          ? record.scope
          : OAUTH_SCOPE,
      dev: record.dev === true,
    });
  }

  return clients;
}

export function findOAuthClient(
  clientId: string,
  clients = loadOAuthClientsFromEnv(),
): OAuthClient | null {
  if (!CLIENT_ID_RE.test(clientId)) return null;
  return clients.find((client) => client.clientId === clientId) ?? null;
}

export function allowInsecureLocalhostOAuthRedirects(): boolean {
  const flag = process.env.OAUTH_ALLOW_INSECURE_LOCALHOST_REDIRECTS;
  return (
    process.env.NODE_ENV !== "production" &&
    (flag === "1" || flag?.toLowerCase() === "true")
  );
}

function isLocalhostUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}

export function validateOAuthRedirectUri(
  client: OAuthClient,
  redirectUri: string,
  _options: { allowInsecureLocalhost?: boolean } = {},
): OAuthRedirectValidation {
  if (
    !redirectUri ||
    CONTROL_RE.test(redirectUri) ||
    redirectUri.includes("\\")
  ) {
    return {
      ok: false,
      error: "invalid_request",
      description: "redirect_uri is required",
    };
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return {
      ok: false,
      error: "invalid_request",
      description: "redirect_uri is not registered for this client",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return {
      ok: false,
      error: "invalid_request",
      description: "redirect_uri must be an absolute URL",
    };
  }

  if (parsed.hash) {
    return {
      ok: false,
      error: "invalid_request",
      description: "redirect_uri must not include a fragment",
    };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      error: "invalid_request",
      description: "redirect_uri must not include userinfo",
    };
  }
  if (parsed.protocol === "https:") return { ok: true };

  // Native OAuth clients use an ephemeral loopback listener for the callback.
  // Exact URI registration still binds the request to the originating client.
  const allowLoopback =
    parsed.protocol === "http:" && isLocalhostUrl(parsed);
  if (allowLoopback) return { ok: true };

  return {
    ok: false,
    error: "invalid_request",
    description: "redirect_uri must use https",
  };
}

function singleParam(params: URLSearchParams, name: string): string;
function singleParam(
  params: URLSearchParams,
  name: string,
  required: false,
): string | undefined;
function singleParam(
  params: URLSearchParams,
  name: string,
  required = true,
): string | undefined {
  const values = params.getAll(name);
  if (values.length === 0) {
    if (!required) return undefined;
    throw new OAuthRequestError("invalid_request", `${name} is required`);
  }
  if (values.length > 1) {
    throw new OAuthRequestError("invalid_request", `${name} must appear once`);
  }
  const value = values[0];
  if (CONTROL_RE.test(value)) {
    throw new OAuthRequestError("invalid_request", `${name} is invalid`);
  }
  return value;
}

export function parseOAuthScope(
  rawScope: string | undefined,
  defaultScope: OAuthScope = OAUTH_SCOPE,
): OAuthScope {
  if (rawScope === undefined || rawScope.trim() === "") return defaultScope;
  const scopes = new Set(rawScope.trim().split(/\s+/));
  if ([...scopes].some((scope) => !isOAuthScope(scope))) {
    throw new OAuthRequestError(
      "invalid_scope",
      `supported scopes are: ${OAUTH_SCOPES.join(", ")}`,
    );
  }
  if (scopes.has(OAUTH_SCOPE)) return OAUTH_SCOPE;
  if (scopes.has(OAUTH_READ_SCOPE)) return OAUTH_READ_SCOPE;
  throw new OAuthRequestError(
    "invalid_scope",
    `supported scopes are: ${OAUTH_SCOPES.join(", ")}`,
  );
}

export function validateOAuthAuthorizationParams(
  params: URLSearchParams,
  options: {
    clients?: OAuthClient[];
    allowInsecureLocalhost?: boolean;
  } = {},
): OAuthAuthorizeValidation {
  let redirectUriForError: string | undefined;
  let stateForError: string | undefined;

  try {
    const clientId = singleParam(params, "client_id");
    const client = findOAuthClient(clientId, options.clients);
    if (!client) {
      throw new OAuthRequestError(
        "invalid_client",
        "client_id is not registered",
      );
    }

    const redirectUri = singleParam(params, "redirect_uri");
    const redirectValidation = validateOAuthRedirectUri(client, redirectUri, {
      allowInsecureLocalhost: options.allowInsecureLocalhost,
    });
    if (!redirectValidation.ok) {
      throw new OAuthRequestError(
        redirectValidation.error,
        redirectValidation.description,
      );
    }
    redirectUriForError = redirectUri;

    const state = singleParam(params, "state", false);
    if (state !== undefined) {
      if (state.length > 1024) {
        throw new OAuthRequestError("invalid_request", "state is too long");
      }
      stateForError = state;
    }

    const responseType = singleParam(params, "response_type");
    if (responseType !== "code") {
      throw new OAuthRequestError(
        "unsupported_response_type",
        "response_type must be code",
      );
    }

    const method = singleParam(params, "code_challenge_method");
    if (method !== "S256") {
      throw new OAuthRequestError(
        "invalid_request",
        "code_challenge_method must be S256",
      );
    }

    const codeChallenge = singleParam(params, "code_challenge");
    if (!CODE_CHALLENGE_RE.test(codeChallenge)) {
      throw new OAuthRequestError("invalid_request", "code_challenge is invalid");
    }

    const scope = parseOAuthScope(
      singleParam(params, "scope", false),
      client.defaultScope ?? OAUTH_SCOPE,
    );

    return {
      ok: true,
      request: {
        client,
        clientId,
        redirectUri,
        codeChallenge,
        scope,
        state,
      },
    };
  } catch (cause) {
    const error =
      cause instanceof OAuthRequestError
        ? cause
        : new OAuthRequestError(
            "invalid_request",
            "invalid authorization request",
          );
    return {
      ok: false,
      error,
      redirectUri: redirectUriForError,
      state: stateForError,
    };
  }
}

export function authorizationErrorRedirect(
  redirectUri: string,
  error: OAuthRequestError,
  state?: string,
): string {
  const target = new URL(redirectUri);
  target.searchParams.set("error", error.code);
  target.searchParams.set("error_description", error.message);
  if (state !== undefined) target.searchParams.set("state", state);
  return target.toString();
}

/**
 * MCP 2026-07-28 asks authorization servers to return `iss` on the
 * authorization response (RFC 9207) and requires clients to check it against
 * the issuer they recorded before redeeming the code. Without it a client that
 * talks to several authorization servers cannot tell which one answered, which
 * is the mix-up attack RFC 9207 exists to close.
 */
export function authorizationSuccessRedirect(
  redirectUri: string,
  code: string,
  state?: string,
  issuer?: string,
): string {
  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  if (state !== undefined) target.searchParams.set("state", state);
  if (issuer) target.searchParams.set("iss", issuer);
  return target.toString();
}

export function generateOAuthAuthorizationCode(): string {
  return `${OAUTH_CODE_PREFIX}${randomBytes(OAUTH_CODE_BYTES).toString(
    "base64url",
  )}`;
}

export function hashOAuthAuthorizationCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function pkceS256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function safeAsciiEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "ascii");
  const rightBuffer = Buffer.from(right, "ascii");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function verifyPkceS256(
  codeVerifier: string,
  expectedChallenge: string,
): boolean {
  if (!CODE_VERIFIER_RE.test(codeVerifier)) return false;
  if (!CODE_CHALLENGE_RE.test(expectedChallenge)) return false;
  return safeAsciiEqual(pkceS256Challenge(codeVerifier), expectedChallenge);
}

export function generateOAuthRefreshToken(): string {
  return `${OAUTH_REFRESH_TOKEN_PREFIX}${randomBytes(
    OAUTH_REFRESH_TOKEN_BYTES,
  ).toString("base64url")}`;
}

export function hashOAuthRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function afterSeconds(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
}

export async function issueOAuthTokenSet(
  input: {
    userId: string;
    clientId: string;
    clientName: string;
    scope: OAuthScope;
    now?: Date;
  },
  store: OAuthTokenStore = databaseOAuthTokenStore,
): Promise<OAuthTokenResponse> {
  const now = input.now ?? new Date();
  const refreshToken = generateOAuthRefreshToken();
  const issued = await store.issue({
    familyId: randomUUID(),
    refreshTokenId: randomUUID(),
    refreshTokenHash: hashOAuthRefreshToken(refreshToken),
    userId: input.userId,
    clientId: input.clientId,
    clientName: input.clientName,
    scope: input.scope,
    now,
    accessTokenExpiresAt: afterSeconds(now, OAUTH_ACCESS_TOKEN_TTL_SECONDS),
    absoluteExpiresAt: afterSeconds(
      now,
      OAUTH_REFRESH_ABSOLUTE_TTL_SECONDS,
    ),
    inactivityExpiresAt: afterSeconds(
      now,
      OAUTH_REFRESH_INACTIVITY_TTL_SECONDS,
    ),
  });

  return {
    access_token: issued.accessToken,
    token_type: "Bearer",
    expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: input.scope,
  };
}

export async function refreshOAuthAccessToken(
  input: {
    refreshToken: string;
    clientId: string;
    scope?: string;
    now?: Date;
  },
  options: {
    clients?: OAuthClient[];
    store?: OAuthTokenStore;
  } = {},
): Promise<OAuthTokenResponse> {
  if (!REFRESH_TOKEN_RE.test(input.refreshToken)) {
    throw new OAuthRequestError("invalid_grant", "refresh token is invalid");
  }

  const client = findOAuthClient(input.clientId, options.clients);
  if (!client) {
    throw new OAuthRequestError("invalid_client", "client_id is not registered");
  }

  let requestedScope: OAuthScope | undefined;
  if (input.scope !== undefined) {
    if (!input.scope.trim()) {
      throw new OAuthRequestError("invalid_scope", "scope must not be empty");
    }
    requestedScope = parseOAuthScope(input.scope);
  }

  const now = input.now ?? new Date();
  const accessToken = generateApiToken();
  const refreshToken = generateOAuthRefreshToken();
  const store = options.store ?? databaseOAuthTokenStore;
  const rotated = await store.rotate({
    presentedRefreshTokenHash: hashOAuthRefreshToken(input.refreshToken),
    clientId: input.clientId,
    clientName: client.name,
    requestedScope,
    newAccessTokenId: randomUUID(),
    newAccessTokenHash: hashApiToken(accessToken),
    newAccessTokenExpiresAt: afterSeconds(now, OAUTH_ACCESS_TOKEN_TTL_SECONDS),
    newRefreshTokenId: randomUUID(),
    newRefreshTokenHash: hashOAuthRefreshToken(refreshToken),
    newInactivityExpiresAt: afterSeconds(
      now,
      OAUTH_REFRESH_INACTIVITY_TTL_SECONDS,
    ),
    now,
  });

  if (rotated.status === "scope_mismatch") {
    throw new OAuthRequestError(
      "invalid_scope",
      "scope must match the original authorization grant",
    );
  }
  if (rotated.status !== "rotated") {
    throw new OAuthRequestError(
      "invalid_grant",
      "refresh token is expired, revoked, used, or invalid",
    );
  }

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: rotated.scope,
  };
}

export async function issueOAuthAuthorizationCode(
  input: {
    userId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    scope?: OAuthScope;
    now?: Date;
  },
  store: OAuthAuthorizationCodeStore = databaseAuthorizationCodeStore,
): Promise<{ code: string; expiresAt: Date }> {
  if (!CODE_CHALLENGE_RE.test(input.codeChallenge)) {
    throw new OAuthRequestError("invalid_request", "code_challenge is invalid");
  }

  const code = generateOAuthAuthorizationCode();
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + OAUTH_CODE_TTL_SECONDS * 1000);
  await store.insert({
    codeHash: hashOAuthAuthorizationCode(code),
    userId: input.userId,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope: input.scope ?? OAUTH_SCOPE,
    expiresAt,
  });
  return { code, expiresAt };
}

export async function exchangeOAuthAuthorizationCode(
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    now?: Date;
  },
  options: {
    clients?: OAuthClient[];
    allowInsecureLocalhost?: boolean;
    store?: OAuthAuthorizationCodeStore;
    tokenStore?: OAuthTokenStore;
  } = {},
): Promise<OAuthTokenResponse> {
  if (!input.code || input.code.length > 256 || CONTROL_RE.test(input.code)) {
    throw new OAuthRequestError(
      "invalid_grant",
      "authorization code is invalid",
    );
  }

  const client = findOAuthClient(input.clientId, options.clients);
  if (!client) {
    throw new OAuthRequestError("invalid_client", "client_id is not registered");
  }

  const redirectValidation = validateOAuthRedirectUri(client, input.redirectUri, {
    allowInsecureLocalhost: options.allowInsecureLocalhost,
  });
  if (!redirectValidation.ok) {
    throw new OAuthRequestError(
      redirectValidation.error,
      redirectValidation.description,
    );
  }

  const now = input.now ?? new Date();
  const codeStore = options.store ?? databaseAuthorizationCodeStore;
  const record = await codeStore.consume({
    codeHash: hashOAuthAuthorizationCode(input.code),
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    now,
  });
  if (!record) {
    throw new OAuthRequestError(
      "invalid_grant",
      "authorization code is expired, used, or invalid",
    );
  }

  if (!verifyPkceS256(input.codeVerifier, record.codeChallenge)) {
    throw new OAuthRequestError("invalid_grant", "PKCE verification failed");
  }

  return issueOAuthTokenSet(
    {
      userId: record.userId,
      clientId: record.clientId,
      clientName: client.name,
      scope: record.scope,
      now,
    },
    options.tokenStore,
  );
}

export function oauthAuthorizationServerMetadata(issuer: string) {
  const base = issuer.replace(/\/+$/, "");
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...OAUTH_SCOPES],
  };
}
