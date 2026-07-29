import {
  OAuthRequestError,
  allowInsecureLocalhostOAuthRedirects,
  exchangeOAuthAuthorizationCode,
  refreshOAuthAccessToken,
} from "@/lib/oauth";
import { publicOrigin as getPublicOrigin } from "@/lib/mcp/origin";
import { loadOAuthClients } from "../clients";

export const dynamic = "force-dynamic";

const TOKEN_WINDOW_MS = 60 * 1000;
const TOKEN_MAX_ATTEMPTS = 30;
const TOKEN_FORM_KEYS = new Set([
  "grant_type",
  "code",
  "redirect_uri",
  "client_id",
  "code_verifier",
  "refresh_token",
  "scope",
  "resource",
]);

const attempts = new Map<string, { count: number; resetAt: number }>();

function oauthJson(
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

function oauthErrorResponse(cause: unknown): Response {
  const error =
    cause instanceof OAuthRequestError
      ? cause
      : new OAuthRequestError("server_error", "token exchange failed", 500);
  return oauthJson(
    { error: error.code, error_description: error.message },
    { status: error.status },
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

function checkTokenRateLimit(request: Request): boolean {
  const now = Date.now();
  const key = rateLimitKey(request);
  const current = attempts.get(key);

  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + TOKEN_WINDOW_MS });
    if (attempts.size > 1000) {
      for (const [entryKey, entry] of attempts) {
        if (entry.resetAt <= now) attempts.delete(entryKey);
      }
    }
    return true;
  }

  current.count += 1;
  return current.count <= TOKEN_MAX_ATTEMPTS;
}

async function formParams(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded") {
    throw new OAuthRequestError(
      "invalid_request",
      "token request must be application/x-www-form-urlencoded",
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new OAuthRequestError("invalid_request", "invalid token request body");
  }

  const params = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    if (!TOKEN_FORM_KEYS.has(key)) {
      throw new OAuthRequestError("invalid_request", `${key} is not supported`);
    }
    if (typeof value !== "string") {
      throw new OAuthRequestError("invalid_request", "form fields must be text");
    }
    params.append(key, value);
  }
  return params;
}

function requiredSingle(params: URLSearchParams, name: string): string {
  const values = params.getAll(name);
  if (values.length === 0) {
    throw new OAuthRequestError("invalid_request", `${name} is required`);
  }
  if (values.length > 1) {
    throw new OAuthRequestError("invalid_request", `${name} must appear once`);
  }
  return values[0];
}

function optionalSingle(
  params: URLSearchParams,
  name: string,
): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) {
    throw new OAuthRequestError("invalid_request", `${name} must appear once`);
  }
  return values[0];
}

function assertOnlyGrantParams(
  params: URLSearchParams,
  allowed: ReadonlySet<string>,
): void {
  for (const key of params.keys()) {
    if (!allowed.has(key)) {
      throw new OAuthRequestError(
        "invalid_request",
        `${key} is not valid for this grant_type`,
      );
    }
  }
}

function validateRequestedResource(
  params: URLSearchParams,
  request: Request,
): void {
  const resource = optionalSingle(params, "resource");
  if (resource === undefined) return;

  const expected = `${getPublicOrigin(request)}/api/mcp`;
  if (resource !== expected) {
    throw new OAuthRequestError(
      "invalid_target",
      `resource must be ${expected}`,
    );
  }
}

export async function POST(request: Request) {
  if (!checkTokenRateLimit(request)) {
    return oauthJson(
      {
        error: "temporarily_unavailable",
        error_description: "too many token requests; retry later",
      },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  if (request.headers.has("authorization")) {
    return oauthErrorResponse(
      new OAuthRequestError(
        "invalid_client",
        "client authentication is not supported for public clients",
      ),
    );
  }

  try {
    const params = await formParams(request);
    const grantType = requiredSingle(params, "grant_type");

    if (grantType === "authorization_code") {
      assertOnlyGrantParams(
        params,
        new Set([
          "grant_type",
          "code",
          "redirect_uri",
          "client_id",
          "code_verifier",
          "resource",
        ]),
      );
      validateRequestedResource(params, request);
      const clients = await loadOAuthClients();
      const token = await exchangeOAuthAuthorizationCode(
        {
          code: requiredSingle(params, "code"),
          clientId: requiredSingle(params, "client_id"),
          redirectUri: requiredSingle(params, "redirect_uri"),
          codeVerifier: requiredSingle(params, "code_verifier"),
        },
        {
          clients,
          allowInsecureLocalhost: allowInsecureLocalhostOAuthRedirects(),
        },
      );
      return oauthJson(token);
    }

    if (grantType === "refresh_token") {
      assertOnlyGrantParams(
        params,
        new Set([
          "grant_type",
          "refresh_token",
          "client_id",
          "scope",
          "resource",
        ]),
      );
      validateRequestedResource(params, request);
      const clients = await loadOAuthClients();
      const token = await refreshOAuthAccessToken(
        {
          refreshToken: requiredSingle(params, "refresh_token"),
          clientId: requiredSingle(params, "client_id"),
          scope: optionalSingle(params, "scope"),
        },
        { clients },
      );
      return oauthJson(token);
    }

    throw new OAuthRequestError(
      "unsupported_grant_type",
      "grant_type must be authorization_code or refresh_token",
    );
  } catch (cause) {
    return oauthErrorResponse(cause);
  }
}

function methodNotAllowed(): Response {
  return oauthJson(
    {
      error: "invalid_request",
      error_description: "token endpoint requires POST",
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
