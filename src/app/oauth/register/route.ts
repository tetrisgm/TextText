import {
  cleanOAuthClientName,
  parseOAuthScope,
  type OAuthScope,
  validateOAuthRedirectUri,
} from "@/lib/oauth";
import {
  OAuthClientRegistrationError,
  createRegisteredOAuthClient,
} from "../clients";

export const dynamic = "force-dynamic";

type RegistrationErrorCode =
  | "invalid_redirect_uri"
  | "invalid_client_metadata"
  | "server_error"
  | "temporarily_unavailable";

const REGISTER_WINDOW_MS = 60 * 1000;
const REGISTER_MAX_ATTEMPTS = 20;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_REDIRECT_URIS = 20;
const MAX_REDIRECT_URI_LENGTH = 2048;

const attempts = new Map<string, { count: number; resetAt: number }>();

class RegistrationRequestError extends Error {
  readonly code: RegistrationErrorCode;
  readonly status: number;

  constructor(code: RegistrationErrorCode, description: string, status = 400) {
    super(description);
    this.name = "RegistrationRequestError";
    this.code = code;
    this.status = status;
  }
}

function registrationJson(
  body: Record<string, unknown>,
  init: ResponseInit = {},
): Response {
  return Response.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...init.headers,
    },
  });
}

function registrationErrorResponse(cause: unknown): Response {
  if (cause instanceof RegistrationRequestError) {
    return registrationJson(
      { error: cause.code, error_description: cause.message },
      { status: cause.status },
    );
  }

  if (cause instanceof OAuthClientRegistrationError) {
    return registrationJson(
      {
        error:
          cause.status === 503 ? "temporarily_unavailable" : "server_error",
        error_description: cause.message,
      },
      { status: cause.status },
    );
  }

  return registrationJson(
    {
      error: "server_error",
      error_description: "client registration failed",
    },
    { status: 500 },
  );
}

function firstForwardedIp(header: string | null): string {
  return header?.split(",")[0]?.trim() || "unknown";
}

function rateLimitKey(request: Request): string {
  return [
    firstForwardedIp(request.headers.get("x-forwarded-for")),
    request.headers.get("x-real-ip") ?? "",
    new URL(request.url).origin,
  ].join("|");
}

function checkRegistrationRateLimit(request: Request): boolean {
  const now = Date.now();
  const key = rateLimitKey(request);
  const current = attempts.get(key);

  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + REGISTER_WINDOW_MS });
    if (attempts.size > 1000) {
      for (const [entryKey, entry] of attempts) {
        if (entry.resetAt <= now) attempts.delete(entryKey);
      }
    }
    return true;
  }

  current.count += 1;
  return current.count <= REGISTER_MAX_ATTEMPTS;
}

function assertRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RegistrationRequestError(
      "invalid_client_metadata",
      "registration request must be a JSON object",
    );
  }
  return value as Record<string, unknown>;
}

async function readMetadata(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new RegistrationRequestError(
      "invalid_client_metadata",
      "registration request is too large",
      413,
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new RegistrationRequestError(
      "invalid_client_metadata",
      "registration request must be application/json",
    );
  }

  try {
    return assertRecord(await request.json());
  } catch (cause) {
    if (cause instanceof RegistrationRequestError) throw cause;
    throw new RegistrationRequestError(
      "invalid_client_metadata",
      "registration request body is invalid JSON",
    );
  }
}

function optionalString(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new RegistrationRequestError(
      "invalid_client_metadata",
      `${key} must be a string`,
    );
  }
  return value;
}

function validateStringArray(
  value: unknown,
  key: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new RegistrationRequestError(
      "invalid_client_metadata",
      `${key} must be an array of strings`,
    );
  }
  return value;
}

function validateSingletonArray(
  metadata: Record<string, unknown>,
  key: string,
  expected: string,
): void {
  const values = validateStringArray(metadata[key], key);
  if (!values) return;
  if (values.length !== 1 || values[0] !== expected) {
    throw new RegistrationRequestError(
      "invalid_client_metadata",
      `${key} must be ${expected}`,
    );
  }
}

function validateTokenEndpointAuthMethod(
  metadata: Record<string, unknown>,
): void {
  const method = optionalString(metadata, "token_endpoint_auth_method");
  if (method !== undefined && method !== "none") {
    throw new RegistrationRequestError(
      "invalid_client_metadata",
      "token_endpoint_auth_method must be none",
    );
  }
}

function validateScope(metadata: Record<string, unknown>): OAuthScope {
  try {
    return parseOAuthScope(optionalString(metadata, "scope"));
  } catch (cause) {
    throw new RegistrationRequestError(
      "invalid_client_metadata",
      cause instanceof Error ? cause.message : "scope is invalid",
    );
  }
}

function validateGrantTypes(metadata: Record<string, unknown>): string[] {
  const values = validateStringArray(metadata.grant_types, "grant_types");
  if (!values) return ["authorization_code"];
  const supported = new Set(["authorization_code", "refresh_token"]);
  if (
    !values.includes("authorization_code") ||
    values.some((value) => !supported.has(value)) ||
    new Set(values).size !== values.length
  ) {
    throw new RegistrationRequestError(
      "invalid_client_metadata",
      "grant_types must contain authorization_code and may contain refresh_token",
    );
  }
  return values;
}

function validateRedirectUris(metadata: Record<string, unknown>): string[] {
  const rawRedirectUris = metadata.redirect_uris;
  if (!Array.isArray(rawRedirectUris) || rawRedirectUris.length === 0) {
    throw new RegistrationRequestError(
      "invalid_redirect_uri",
      "redirect_uris must be a non-empty array",
    );
  }
  if (rawRedirectUris.length > MAX_REDIRECT_URIS) {
    throw new RegistrationRequestError(
      "invalid_redirect_uri",
      `redirect_uris is limited to ${MAX_REDIRECT_URIS} values`,
    );
  }

  const seen = new Set<string>();
  const redirectUris: string[] = [];
  for (const value of rawRedirectUris) {
    if (typeof value !== "string") {
      throw new RegistrationRequestError(
        "invalid_redirect_uri",
        "redirect_uris values must be strings",
      );
    }
    if (!value || value.trim() !== value) {
      throw new RegistrationRequestError(
        "invalid_redirect_uri",
        "redirect_uris values must be exact non-empty strings",
      );
    }
    if (value.length > MAX_REDIRECT_URI_LENGTH) {
      throw new RegistrationRequestError(
        "invalid_redirect_uri",
        "redirect_uri is too long",
      );
    }
    if (seen.has(value)) {
      throw new RegistrationRequestError(
        "invalid_redirect_uri",
        "redirect_uris must not contain duplicates",
      );
    }

    const validation = validateOAuthRedirectUri(
      { clientId: "registration", name: "OAuth client", redirectUris: [value] },
      value,
    );
    if (!validation.ok) {
      throw new RegistrationRequestError(
        "invalid_redirect_uri",
        validation.description,
      );
    }

    redirectUris.push(value);
    seen.add(value);
  }

  return redirectUris;
}

export async function POST(request: Request) {
  if (!checkRegistrationRateLimit(request)) {
    return registrationJson(
      {
        error: "temporarily_unavailable",
        error_description: "too many registration requests; retry later",
      },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  try {
    const metadata = await readMetadata(request);
    const grantTypes = validateGrantTypes(metadata);
    validateSingletonArray(metadata, "response_types", "code");
    validateTokenEndpointAuthMethod(metadata);
    const scope = validateScope(metadata);
    const redirectUris = validateRedirectUris(metadata);
    const clientName = cleanOAuthClientName(
      optionalString(metadata, "client_name"),
    );

    const client = await createRegisteredOAuthClient({
      clientName,
      redirectUris,
      scope,
    });

    return registrationJson(
      {
        client_id: client.clientId,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: grantTypes,
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope,
      },
      { status: 201 },
    );
  } catch (cause) {
    return registrationErrorResponse(cause);
  }
}

function methodNotAllowed(): Response {
  return registrationJson(
    {
      error: "invalid_client_metadata",
      error_description: "client registration requires POST",
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
