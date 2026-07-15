import { resolveApiToken } from "@/lib/api-tokens";
import { parseAppHealthReport } from "@/lib/app-health";
import { db } from "@/lib/db/client";
import { appHealthReports } from "@/lib/db/schema";

function storageUnavailableResponse(): Response {
  return Response.json(
    {
      accepted: false,
      persisted: false,
      rollupAvailable: false,
      code: "health_storage_unavailable",
    },
    { status: 503 },
  );
}

export async function POST(request: Request): Promise<Response> {
  const identity = await (async () => {
    try {
      return await resolveApiToken(request.headers.get("authorization"));
    } catch {
      return undefined;
    }
  })();
  if (identity === undefined) return storageUnavailableResponse();
  if (!identity) {
    return Response.json(
      { error: "A valid API token is required" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }
  if (!identity.scopes.split(/\s+/).includes("sync")) {
    return Response.json(
      { error: "This token does not have the sync scope" },
      { status: 403 },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > 64 * 1024) {
    return Response.json({ error: "Health report is too large" }, { status: 413 });
  }

  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > 64 * 1024) {
    return Response.json({ error: "Health report is too large" }, { status: 413 });
  }
  const body = (() => {
    try {
      return JSON.parse(bodyText) as unknown;
    } catch {
      return null;
    }
  })();
  const report = parseAppHealthReport(body);
  if (!report) {
    return Response.json({ error: "Invalid health report" }, { status: 400 });
  }
  if (!db) {
    return storageUnavailableResponse();
  }

  try {
    await db
      .insert(appHealthReports)
      .values({
        id: report.id,
        userId: identity.userId,
        installationId: report.installationId,
        appIdentifier: report.appIdentifier,
        appVersion: report.appVersion,
        buildNumber: report.buildNumber,
        trigger: report.trigger,
        status: report.status,
        report,
        generatedAt: new Date(report.generatedAt),
      })
      .onConflictDoNothing({ target: appHealthReports.id });
  } catch {
    return storageUnavailableResponse();
  }

  return Response.json(
    {
      accepted: true,
      persisted: true,
      rollupAvailable: true,
      release: {
        appIdentifier: report.appIdentifier,
        appVersion: report.appVersion,
        buildNumber: report.buildNumber,
      },
    },
    { status: 202 },
  );
}
