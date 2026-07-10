import { getCurrentUser } from "@/lib/session";
import { getUserIdBySub } from "@/lib/store";
import { resolveOwnedWorkspace } from "@/lib/workspace";
import {
  OAuthRequestError,
  allowInsecureLocalhostOAuthRedirects,
  authorizationErrorRedirect,
  authorizationSuccessRedirect,
  issueOAuthAuthorizationCode,
  validateOAuthAuthorizationParams,
} from "@/lib/oauth";
import { loadOAuthClients } from "../../clients";

export const dynamic = "force-dynamic";

function toUrlSearchParams(formData: FormData): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") {
      throw new OAuthRequestError("invalid_request", "form fields must be text");
    }
    if (key !== "decision") params.append(key, value);
  }
  return params;
}

function authorizePath(params: URLSearchParams): string {
  const query = params.toString();
  return `/oauth/authorize${query ? `?${query}` : ""}`;
}

function redirectResponse(location: string, request: Request): Response {
  // Response.redirect() marks its headers immutable, so setting Cache-Control
  // on it throws (TypeError: immutable) and the approval 500s. Build the
  // redirect by hand instead.
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(location, request.url).toString(),
      "Cache-Control": "no-store",
    },
  });
}

function isSameOriginPost(request: Request): boolean {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expectedOrigin;

  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function redirectOAuthError(
  request: Request,
  redirectUri: string | undefined,
  error: OAuthRequestError,
  state?: string,
): Response {
  if (!redirectUri) {
    return Response.json(
      { error: error.code, error_description: error.message },
      { status: error.status },
    );
  }
  return redirectResponse(
    authorizationErrorRedirect(redirectUri, error, state),
    request,
  );
}

export async function POST(request: Request) {
  if (!isSameOriginPost(request)) {
    return Response.json(
      {
        error: "invalid_request",
        error_description: "authorization approval must be same-origin",
      },
      { status: 400 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: "invalid_request", error_description: "invalid form body" },
      { status: 400 },
    );
  }

  let params: URLSearchParams;
  try {
    params = toUrlSearchParams(formData);
  } catch (cause) {
    const error =
      cause instanceof OAuthRequestError
        ? cause
        : new OAuthRequestError("invalid_request", "invalid approval request");
    return Response.json(
      { error: error.code, error_description: error.message },
      { status: error.status },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return redirectResponse(
      `/signin?callbackUrl=${encodeURIComponent(authorizePath(params))}`,
      request,
    );
  }

  const clients = await loadOAuthClients();
  const validation = validateOAuthAuthorizationParams(params, {
    clients,
    allowInsecureLocalhost: allowInsecureLocalhostOAuthRedirects(),
  });
  if (!validation.ok) {
    return redirectOAuthError(
      request,
      validation.redirectUri,
      validation.error,
      validation.state,
    );
  }

  const decision = formData.get("decision");
  if (decision !== "approve") {
    return redirectOAuthError(
      request,
      validation.request.redirectUri,
      new OAuthRequestError("access_denied", "authorization was denied"),
      validation.request.state,
    );
  }

  try {
    await resolveOwnedWorkspace(user);
    const userId = await getUserIdBySub(user.sub);
    if (!userId) {
      throw new OAuthRequestError("server_error", "could not resolve user", 500);
    }

    const issued = await issueOAuthAuthorizationCode({
      userId,
      clientId: validation.request.clientId,
      redirectUri: validation.request.redirectUri,
      codeChallenge: validation.request.codeChallenge,
      scope: validation.request.scope,
    });

    return redirectResponse(
      authorizationSuccessRedirect(
        validation.request.redirectUri,
        issued.code,
        validation.request.state,
      ),
      request,
    );
  } catch (cause) {
    const error =
      cause instanceof OAuthRequestError
        ? cause
        : new OAuthRequestError(
            "server_error",
            "could not issue authorization code",
            500,
          );
    return redirectOAuthError(
      request,
      validation.request.redirectUri,
      error,
      validation.request.state,
    );
  }
}
