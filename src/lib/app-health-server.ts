import { and, asc, desc, eq, lt, not, sql } from "drizzle-orm";

import { db } from "./db/client";
import { appHealthReports } from "./db/schema";
import {
  APP_HEALTH_REGRESSION_POLICY,
  evaluateAppHealthRelease,
  parseAppHealthRollupRow,
  type AppHealthReleaseEvaluation,
  type AppHealthReleaseTarget,
  type AppHealthRollupRow,
} from "./app-health-rollup";

export const APP_HEALTH_MAX_REPORTS = 2_000;

export class AppHealthDataUnavailableError extends Error {
  constructor() {
    super("app health data unavailable");
    this.name = "AppHealthDataUnavailableError";
  }
}

const rollupSelection = {
  appIdentifier: appHealthReports.appIdentifier,
  appVersion: appHealthReports.appVersion,
  buildNumber: appHealthReports.buildNumber,
  trigger: appHealthReports.trigger,
  status: appHealthReports.status,
  checks: sql<unknown>`${appHealthReports.report} -> 'checks'`,
  receivedAt: appHealthReports.receivedAt,
};

function boundedLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return APP_HEALTH_MAX_REPORTS;
  }
  return Math.max(1, Math.min(APP_HEALTH_MAX_REPORTS, Math.trunc(value)));
}

function parseRows(values: unknown[]): {
  rows: AppHealthRollupRow[];
  invalidReportCount: number;
} {
  const rows: AppHealthRollupRow[] = [];
  let invalidReportCount = 0;
  for (const value of values) {
    const row = parseAppHealthRollupRow(value);
    if (row) rows.push(row);
    else invalidReportCount += 1;
  }
  return { rows, invalidReportCount };
}

export async function loadRecentAppHealthRows(
  limit?: number,
): Promise<{ rows: AppHealthRollupRow[]; invalidReportCount: number }> {
  const database = db;
  if (!database) throw new AppHealthDataUnavailableError();
  const values = await database
    .select(rollupSelection)
    .from(appHealthReports)
    .orderBy(desc(appHealthReports.receivedAt))
    .limit(boundedLimit(limit));
  return parseRows(values);
}

export async function loadAppHealthVersionRows(
  appVersion: string,
  options: { appIdentifier?: string; limit?: number } = {},
): Promise<{ rows: AppHealthRollupRow[]; invalidReportCount: number }> {
  const database = db;
  if (!database) throw new AppHealthDataUnavailableError();
  const conditions = [eq(appHealthReports.appVersion, appVersion)];
  if (options.appIdentifier) {
    conditions.push(eq(appHealthReports.appIdentifier, options.appIdentifier));
  }
  const values = await database
    .select(rollupSelection)
    .from(appHealthReports)
    .where(and(...conditions))
    .orderBy(desc(appHealthReports.receivedAt))
    .limit(boundedLimit(options.limit));
  return parseRows(values);
}

export async function loadAppHealthReleaseEvaluation(
  target: AppHealthReleaseTarget,
  options: { evaluatedAt?: Date; limit?: number } = {},
): Promise<AppHealthReleaseEvaluation> {
  const database = db;
  if (!database) throw new AppHealthDataUnavailableError();
  const limit = boundedLimit(options.limit);
  const exactConditions = [
    eq(appHealthReports.appVersion, target.appVersion),
    eq(appHealthReports.buildNumber, target.buildNumber),
  ];
  if (target.appIdentifier) {
    exactConditions.push(eq(appHealthReports.appIdentifier, target.appIdentifier));
  }

  const exactValues = await database
    .select(rollupSelection)
    .from(appHealthReports)
    .where(and(...exactConditions))
    .orderBy(desc(appHealthReports.receivedAt))
    .limit(limit);
  const exact = parseRows(exactValues);

  const appIdentifiers = [...new Set(exact.rows.map((row) => row.appIdentifier))];
  const earliestValues = await Promise.all(
    appIdentifiers.map(async (appIdentifier) => {
      const [first] = await database
        .select({ receivedAt: appHealthReports.receivedAt })
        .from(appHealthReports)
        .where(
          and(
            eq(appHealthReports.appIdentifier, appIdentifier),
            eq(appHealthReports.appVersion, target.appVersion),
            eq(appHealthReports.buildNumber, target.buildNumber),
          ),
        )
        .orderBy(asc(appHealthReports.receivedAt))
        .limit(1);
      return first ? ([appIdentifier, first.receivedAt] as const) : null;
    }),
  );
  const earliestByApp = new Map(
    earliestValues.filter(
      (value): value is readonly [string, Date] => value !== null,
    ),
  );

  const baselineValues = await Promise.all(
    [...earliestByApp.entries()].map(([appIdentifier, earliest]) =>
      database
        .select(rollupSelection)
        .from(appHealthReports)
        .where(
          and(
            eq(appHealthReports.appIdentifier, appIdentifier),
            not(
              and(
                eq(appHealthReports.appVersion, target.appVersion),
                eq(appHealthReports.buildNumber, target.buildNumber),
              )!,
            ),
            lt(appHealthReports.receivedAt, earliest),
          ),
        )
        .orderBy(desc(appHealthReports.receivedAt))
        .limit(APP_HEALTH_REGRESSION_POLICY.baselineReportLimit),
    ),
  );
  const baseline = parseRows(baselineValues.flat());

  return evaluateAppHealthRelease([...exact.rows, ...baseline.rows], target, {
    evaluatedAt: options.evaluatedAt,
    invalidTargetReportCount: exact.invalidReportCount,
  });
}
