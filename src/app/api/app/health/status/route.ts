import { authorizeAppHealthReview } from "@/lib/app-health-review-auth";
import { parseAppHealthReleaseTarget } from "@/lib/app-health-rollup";
import { loadAppHealthReleaseEvaluation } from "@/lib/app-health-server";

export const runtime = "nodejs";

const responseHeaders = { "Cache-Control": "no-store" };

function errorResponse(
  code:
    | "review_auth_unconfigured"
    | "review_unauthorized"
    | "release_target_invalid"
    | "health_data_unavailable",
  status: number,
): Response {
  return Response.json(
    {
      schemaVersion: 1,
      available: false,
      releaseReady: false,
      reportCount: 0,
      code,
    },
    {
      status,
      headers:
        status === 401
          ? { ...responseHeaders, "WWW-Authenticate": "Bearer" }
          : responseHeaders,
    },
  );
}

export async function GET(request: Request): Promise<Response> {
  const authorization = authorizeAppHealthReview(
    request.headers.get("authorization"),
  );
  if (authorization === "unconfigured") {
    return errorResponse("review_auth_unconfigured", 503);
  }
  if (authorization === "unauthorized") {
    return errorResponse("review_unauthorized", 401);
  }

  const url = new URL(request.url);
  const allowedParameters = new Set(["appIdentifier", "version", "build"]);
  if ([...url.searchParams.keys()].some((key) => !allowedParameters.has(key))) {
    return errorResponse("release_target_invalid", 400);
  }
  const appIdentifiers = url.searchParams.getAll("appIdentifier");
  const versions = url.searchParams.getAll("version");
  const builds = url.searchParams.getAll("build");
  if (
    appIdentifiers.length > 1 ||
    versions.length !== 1 ||
    builds.length !== 1
  ) {
    return errorResponse("release_target_invalid", 400);
  }
  const appIdentifier = appIdentifiers[0];
  const target = parseAppHealthReleaseTarget({
    ...(appIdentifier ? { appIdentifier } : {}),
    appVersion: versions[0],
    buildNumber: builds[0],
  });
  if (!target) return errorResponse("release_target_invalid", 400);

  try {
    const evaluation = await loadAppHealthReleaseEvaluation(target);
    return Response.json(evaluation, {
      status: evaluation.releaseReady ? 200 : 503,
      headers: responseHeaders,
    });
  } catch {
    return errorResponse("health_data_unavailable", 503);
  }
}
