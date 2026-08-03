import { z } from "zod";

import {
  appHealthCheckSchema,
  appHealthIdentifierSchema,
  appHealthReleaseValueSchema,
  appHealthStatusSchema,
  appHealthTriggerSchema,
  type AppHealthReport,
} from "./app-health";

export const APP_HEALTH_ROLLUP_SCHEMA_VERSION = 1 as const;

export const appHealthReleaseTargetSchema = z
  .object({
    appIdentifier: appHealthIdentifierSchema.optional(),
    appVersion: appHealthReleaseValueSchema,
    buildNumber: appHealthReleaseValueSchema,
  })
  .strict();

export type AppHealthReleaseTarget = z.infer<
  typeof appHealthReleaseTargetSchema
>;

const appHealthRollupRowSchema = z
  .object({
    appIdentifier: appHealthIdentifierSchema,
    appVersion: appHealthReleaseValueSchema,
    buildNumber: appHealthReleaseValueSchema,
    trigger: appHealthTriggerSchema,
    status: appHealthStatusSchema,
    checks: z
      .array(appHealthCheckSchema)
      .min(1)
      .max(100)
      .refine(
        (checks) => new Set(checks.map((check) => check.id)).size === checks.length,
      ),
    receivedAt: z.union([
      z.date(),
      z.string().datetime({ offset: true }).transform((value) => new Date(value)),
    ]),
  })
  .strict();

export type AppHealthRollupRow = z.infer<typeof appHealthRollupRowSchema>;
type AppHealthStatus = AppHealthReport["status"];
type AppHealthTrigger = AppHealthReport["trigger"];

export interface AppHealthStatusCounts {
  total: number;
  pass: number;
  warning: number;
  fail: number;
  passRate: number;
}

export interface AppHealthCheckSummary extends AppHealthStatusCounts {
  id: string;
  durationP95Milliseconds: number;
  durationMaxMilliseconds: number;
}

export interface AppHealthVersionBuildSummary {
  appIdentifier: string;
  appVersion: string;
  buildNumber: string;
  firstReceivedAt: string;
  lastReceivedAt: string;
  reports: AppHealthStatusCounts;
  triggers: Record<AppHealthTrigger, number>;
  checks: AppHealthCheckSummary[];
}

export interface AppHealthRegressionPolicy {
  minimumCurrentReports: number;
  minimumBaselineReports: number;
  minimumPassRateDrop: number;
  significanceZScore: number;
  baselineReportLimit: number;
}

export const APP_HEALTH_REGRESSION_POLICY: AppHealthRegressionPolicy = {
  minimumCurrentReports: 5,
  minimumBaselineReports: 20,
  minimumPassRateDrop: 0.1,
  significanceZScore: 1.96,
  baselineReportLimit: 200,
};

interface AppHealthAlertBase {
  severity: "blocking";
  appVersion: string;
  buildNumber: string;
}

export type AppHealthAlert =
  | (AppHealthAlertBase & {
      code: "exact_release_missing";
      appIdentifier?: string;
    })
  | (AppHealthAlertBase & {
      code: "invalid_exact_release_report";
      invalidReportCount: number;
      appIdentifier?: string;
    })
  | (AppHealthAlertBase & {
      code: "report_failed";
      appIdentifier: string;
      failureCount: number;
    })
  | (AppHealthAlertBase & {
      code: "check_failed";
      appIdentifier: string;
      checkId: string;
      failureCount: number;
    })
  | (AppHealthAlertBase & {
      code: "report_pass_rate_regression";
      appIdentifier: string;
      observedCount: number;
      observedPassRate: number;
      baselineCount: number;
      baselinePassRate: number;
      passRateDrop: number;
      zScore: number;
    })
  | (AppHealthAlertBase & {
      code: "check_pass_rate_regression";
      appIdentifier: string;
      checkId: string;
      observedCount: number;
      observedPassRate: number;
      baselineCount: number;
      baselinePassRate: number;
      passRateDrop: number;
      zScore: number;
    });

export interface AppHealthBaselineSummary {
  reportCount: number;
  passRate: number;
  firstReceivedAt: string;
  lastReceivedAt: string;
}

export interface AppHealthEvaluatedSummary extends AppHealthVersionBuildSummary {
  baseline: AppHealthBaselineSummary | null;
}

export interface AppHealthReleaseEvaluation {
  schemaVersion: typeof APP_HEALTH_ROLLUP_SCHEMA_VERSION;
  evaluatedAt: string;
  target: AppHealthReleaseTarget;
  status: AppHealthStatus;
  releaseReady: boolean;
  reportCount: number;
  policy: AppHealthRegressionPolicy;
  summaries: AppHealthEvaluatedSummary[];
  alerts: AppHealthAlert[];
}

export type AppHealthOwnerReleaseBlockingCode =
  | AppHealthAlert["code"]
  | "exact_release_not_pass";

export interface AppHealthOwnerReleaseGate {
  requiredStatus: "pass";
  passed: boolean;
  blockingCodes: AppHealthOwnerReleaseBlockingCode[];
}

export function parseAppHealthReleaseTarget(
  value: unknown,
): AppHealthReleaseTarget | null {
  const parsed = appHealthReleaseTargetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseAppHealthRollupRow(
  value: unknown,
): AppHealthRollupRow | null {
  const parsed = appHealthRollupRowSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function evaluateAppHealthOwnerReleaseGate(
  evaluation: AppHealthReleaseEvaluation,
): AppHealthOwnerReleaseGate {
  // Block a release only on a HARD failure: an overall "fail" status or a
  // failing-check alert. A "warning" with no failing checks is non-blocking. It
  // is a soft, usually transient signal (e.g. the File Provider mount still
  // warming up in the first seconds after a fresh install, which reports a
  // finder.provider latency warning and then settles). Blocking a release on a
  // warning wedges a release and drifts public state ahead of
  // source. This mirrors the local install-health gate, which is warning-tolerant.
  const blockingCodes: AppHealthOwnerReleaseBlockingCode[] =
    evaluation.alerts.map((alert) => alert.code);
  const hardFail = evaluation.status === "fail" || blockingCodes.length > 0;
  if (hardFail && blockingCodes.length === 0) {
    blockingCodes.push("exact_release_not_pass");
  }
  return {
    requiredStatus: "pass",
    passed: !hardFail && evaluation.reportCount > 0,
    blockingCodes: [...new Set(blockingCodes)],
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function statusCounts(statuses: AppHealthStatus[]): AppHealthStatusCounts {
  const counts: AppHealthStatusCounts = {
    total: statuses.length,
    pass: 0,
    warning: 0,
    fail: 0,
    passRate: 0,
  };
  for (const status of statuses) counts[status] += 1;
  counts.passRate = counts.total === 0 ? 0 : round(counts.pass / counts.total);
  return counts;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function releaseKey(row: AppHealthRollupRow): string {
  return `${row.appIdentifier}\u0000${row.appVersion}\u0000${row.buildNumber}`;
}

function emptyTriggers(): Record<AppHealthTrigger, number> {
  return {
    versionLaunch: 0,
    periodic: 0,
    manual: 0,
    releaseVerification: 0,
  };
}

function summarizeChecks(rows: AppHealthRollupRow[]): AppHealthCheckSummary[] {
  const checks = new Map<
    string,
    { statuses: AppHealthStatus[]; durations: number[] }
  >();
  for (const row of rows) {
    for (const check of row.checks) {
      const current = checks.get(check.id) ?? { statuses: [], durations: [] };
      current.statuses.push(check.status);
      current.durations.push(check.durationMilliseconds);
      checks.set(check.id, current);
    }
  }

  return [...checks.entries()]
    .map(([id, value]): AppHealthCheckSummary => ({
      id,
      ...statusCounts(value.statuses),
      durationP95Milliseconds: percentile(value.durations, 0.95),
      durationMaxMilliseconds: Math.max(...value.durations),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function summarizeAppHealthRows(
  rows: AppHealthRollupRow[],
): AppHealthVersionBuildSummary[] {
  const groups = new Map<string, AppHealthRollupRow[]>();
  for (const row of rows) {
    const key = releaseKey(row);
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((group): AppHealthVersionBuildSummary => {
      const ordered = [...group].sort(
        (left, right) => left.receivedAt.getTime() - right.receivedAt.getTime(),
      );
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      const triggers = emptyTriggers();

      for (const row of ordered) {
        triggers[row.trigger] += 1;
      }

      return {
        appIdentifier: first.appIdentifier,
        appVersion: first.appVersion,
        buildNumber: first.buildNumber,
        firstReceivedAt: first.receivedAt.toISOString(),
        lastReceivedAt: last.receivedAt.toISOString(),
        reports: statusCounts(ordered.map((row) => row.status)),
        triggers,
        checks: summarizeChecks(ordered),
      };
    })
    .sort(
      (left, right) =>
        left.appIdentifier.localeCompare(right.appIdentifier) ||
        left.appVersion.localeCompare(right.appVersion) ||
        left.buildNumber.localeCompare(right.buildNumber),
    );
}

function regression(
  observedPass: number,
  observedTotal: number,
  baselinePass: number,
  baselineTotal: number,
  policy: AppHealthRegressionPolicy,
): { passRateDrop: number; zScore: number } | null {
  if (
    observedTotal < policy.minimumCurrentReports ||
    baselineTotal < policy.minimumBaselineReports
  ) {
    return null;
  }

  const observedRate = observedPass / observedTotal;
  const baselineRate = baselinePass / baselineTotal;
  const passRateDrop = baselineRate - observedRate;
  if (passRateDrop < policy.minimumPassRateDrop) return null;

  const pooledRate = (observedPass + baselinePass) / (observedTotal + baselineTotal);
  const standardError = Math.sqrt(
    pooledRate *
      (1 - pooledRate) *
      (1 / observedTotal + 1 / baselineTotal),
  );
  if (standardError === 0) return null;

  const zScore = passRateDrop / standardError;
  return zScore >= policy.significanceZScore
    ? { passRateDrop: round(passRateDrop), zScore: round(zScore) }
    : null;
}

function rowsForTarget(
  rows: AppHealthRollupRow[],
  target: AppHealthReleaseTarget,
): AppHealthRollupRow[] {
  return rows.filter(
    (row) =>
      row.appVersion === target.appVersion &&
      row.buildNumber === target.buildNumber &&
      (!target.appIdentifier || row.appIdentifier === target.appIdentifier),
  );
}

function baselineRowsForSummary(
  rows: AppHealthRollupRow[],
  summary: AppHealthVersionBuildSummary,
  policy: AppHealthRegressionPolicy,
): AppHealthRollupRow[] {
  const firstReceivedAt = new Date(summary.firstReceivedAt).getTime();
  return rows
    .filter(
      (row) =>
        row.appIdentifier === summary.appIdentifier &&
        releaseKey(row) !==
          `${summary.appIdentifier}\u0000${summary.appVersion}\u0000${summary.buildNumber}` &&
        row.receivedAt.getTime() < firstReceivedAt,
    )
    .sort((left, right) => right.receivedAt.getTime() - left.receivedAt.getTime())
    .slice(0, policy.baselineReportLimit);
}

export function evaluateAppHealthRelease(
  rows: AppHealthRollupRow[],
  target: AppHealthReleaseTarget,
  options: {
    evaluatedAt?: Date;
    invalidTargetReportCount?: number;
    policy?: AppHealthRegressionPolicy;
  } = {},
): AppHealthReleaseEvaluation {
  const policy = options.policy ?? APP_HEALTH_REGRESSION_POLICY;
  const targetRows = rowsForTarget(rows, target);
  const targetSummaries = summarizeAppHealthRows(targetRows);
  const summaries: AppHealthEvaluatedSummary[] = [];
  const alerts: AppHealthAlert[] = [];

  if (targetSummaries.length === 0) {
    alerts.push({
      code: "exact_release_missing",
      severity: "blocking",
      appIdentifier: target.appIdentifier,
      appVersion: target.appVersion,
      buildNumber: target.buildNumber,
    });
  }

  const invalidTargetReportCount = options.invalidTargetReportCount ?? 0;
  if (invalidTargetReportCount > 0) {
    alerts.push({
      code: "invalid_exact_release_report",
      severity: "blocking",
      appIdentifier: target.appIdentifier,
      appVersion: target.appVersion,
      buildNumber: target.buildNumber,
      invalidReportCount: invalidTargetReportCount,
    });
  }

  for (const summary of targetSummaries) {
    const baselineRows = baselineRowsForSummary(rows, summary, policy);
    const baselineSummary = summarizeAppHealthRows(baselineRows).reduce(
      (combined, value) => ({
        total: combined.total + value.reports.total,
        pass: combined.pass + value.reports.pass,
      }),
      { total: 0, pass: 0 },
    );
    const baseline =
      baselineRows.length === 0
        ? null
        : {
            reportCount: baselineRows.length,
            passRate: round(baselineSummary.pass / baselineSummary.total),
            firstReceivedAt: new Date(
              Math.min(...baselineRows.map((row) => row.receivedAt.getTime())),
            ).toISOString(),
            lastReceivedAt: new Date(
              Math.max(...baselineRows.map((row) => row.receivedAt.getTime())),
            ).toISOString(),
          };
    summaries.push({ ...summary, baseline });

    if (summary.reports.fail > 0) {
      alerts.push({
        code: "report_failed",
        severity: "blocking",
        appIdentifier: summary.appIdentifier,
        appVersion: summary.appVersion,
        buildNumber: summary.buildNumber,
        failureCount: summary.reports.fail,
      });
    }

    for (const check of summary.checks) {
      if (check.fail > 0) {
        alerts.push({
          code: "check_failed",
          severity: "blocking",
          appIdentifier: summary.appIdentifier,
          appVersion: summary.appVersion,
          buildNumber: summary.buildNumber,
          checkId: check.id,
          failureCount: check.fail,
        });
      }
    }

    const reportRegression = regression(
      summary.reports.pass,
      summary.reports.total,
      baselineSummary.pass,
      baselineSummary.total,
      policy,
    );
    if (reportRegression) {
      alerts.push({
        code: "report_pass_rate_regression",
        severity: "blocking",
        appIdentifier: summary.appIdentifier,
        appVersion: summary.appVersion,
        buildNumber: summary.buildNumber,
        observedCount: summary.reports.total,
        observedPassRate: summary.reports.passRate,
        baselineCount: baselineSummary.total,
        baselinePassRate: round(baselineSummary.pass / baselineSummary.total),
        ...reportRegression,
      });
    }

    const baselineChecks = new Map(
      summarizeChecks(baselineRows).map((check) => [check.id, check]),
    );
    for (const check of summary.checks) {
      const baselineCheck = baselineChecks.get(check.id);
      if (!baselineCheck) continue;
      const checkRegression = regression(
        check.pass,
        check.total,
        baselineCheck.pass,
        baselineCheck.total,
        policy,
      );
      if (!checkRegression) continue;
      alerts.push({
        code: "check_pass_rate_regression",
        severity: "blocking",
        appIdentifier: summary.appIdentifier,
        appVersion: summary.appVersion,
        buildNumber: summary.buildNumber,
        checkId: check.id,
        observedCount: check.total,
        observedPassRate: check.passRate,
        baselineCount: baselineCheck.total,
        baselinePassRate: baselineCheck.passRate,
        ...checkRegression,
      });
    }
  }

  const hasWarnings = summaries.some(
    (summary) =>
      summary.reports.warning > 0 ||
      summary.checks.some((check) => check.warning > 0),
  );
  const releaseReady = alerts.length === 0;

  return {
    schemaVersion: APP_HEALTH_ROLLUP_SCHEMA_VERSION,
    evaluatedAt: (options.evaluatedAt ?? new Date()).toISOString(),
    target,
    status: releaseReady ? (hasWarnings ? "warning" : "pass") : "fail",
    releaseReady,
    reportCount: targetRows.length,
    policy: { ...policy },
    summaries,
    alerts,
  };
}
