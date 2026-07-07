import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { createApiToken } from "@/lib/api-tokens";
import { db } from "@/lib/db/client";
import { oauthAuthorizationCodes } from "@/lib/db/schema";

export { oauthAuthorizationCodes } from "@/lib/db/schema";
export type {
  NewOAuthAuthorizationCode,
  OAuthAuthorizationCode,
} from "@/lib/db/schema";

export const OAUTH_SCOPE = "sync";
export const OAUTH_CODE_TTL_SECONDS = 60;
export const OAUTH_CODE_BYTES = 32;
export const OAUTH_CODE_PREFIX = "woc_";

const CLIENT_ID_RE = /^[A-Za-z0-9._~-]{1,128}$/;
const CODE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const CONTROL_RE = /[\u0000-\u001F\u007F]/;

export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_scope"
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
  dev?: boolean;
};

export type OAuthAuthorizationRequest = {
  client: OAuthClient;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: typeof OAUTH_SCOPE;
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
  scope: typeof OAUTH_SCOPE;
};

export type OAuthAuthorizationCodeStore = {
  insert(input: {
    codeHash: string;
    userId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    scope: typeof OAUTH_SCOPE;
    expiresAt: Date;
  }): Promise<void>;
  consume(input: {
    codeHash: string;
    clientId: string;
    redirectUri: string;
    now: Date;
  }): Promise<OAuthAuthorizationCodeRecord | null>;
};

export type OAuthTokenMinter = (
  userId: string,
  name: string,
) => Promise<{ raw: string }>;

export type OAuthTokenResponse = {
  access_token: string;
  token_type: "Bearer";
  scope: typeof OAUTH_SCOPE;
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
    if (!row || row.scope !== OAUTH_SCOPE) return null;
    return {
      userId: row.userId,
      clientId: row.clientId,
      redirectUri: row.redirectUri,
      codeChallenge: row.codeChallenge,
      scope: OAUTH_SCOPE,
    };
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
  options: { allowInsecureLocalhost?: boolean } = {},
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

  const allowLocalhost =
    client.dev === true &&
    options.allowInsecureLocalhost === true &&
    parsed.protocol === "http:" &&
    isLocalhostUrl(parsed);
  if (allowLocalhost) return { ok: true };

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
): typeof OAUTH_SCOPE {
  if (rawScope === undefined || rawScope.trim() === "") return OAUTH_SCOPE;
  const scopes = rawScope.trim().split(/\s+/);
  if (scopes.length === 1 && scopes[0] === OAUTH_SCOPE) return OAUTH_SCOPE;
  throw new OAuthRequestError(
    "invalid_scope",
    "only the sync scope is supported",
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

    const scope = parseOAuthScope(singleParam(params, "scope", false));

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

export function authorizationSuccessRedirect(
  redirectUri: string,
  code: string,
  state?: string,
): string {
  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  if (state !== undefined) target.searchParams.set("state", state);
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

export async function issueOAuthAuthorizationCode(
  input: {
    userId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    scope?: typeof OAUTH_SCOPE;
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
    mintToken?: OAuthTokenMinter;
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

  const store = options.store ?? databaseAuthorizationCodeStore;
  const record = await store.consume({
    codeHash: hashOAuthAuthorizationCode(input.code),
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    now: input.now ?? new Date(),
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

  const mintToken = options.mintToken ?? createApiToken;
  const { raw } = await mintToken(record.userId, `OAuth: ${client.name}`);
  return {
    access_token: raw,
    token_type: "Bearer",
    scope: record.scope,
  };
}

export function oauthAuthorizationServerMetadata(issuer: string) {
  const base = issuer.replace(/\/+$/, "");
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [OAUTH_SCOPE],
  };
}
