#!/usr/bin/env node
import * as nextEnv from "@next/env";

import {
  evaluateAppHealthOwnerReleaseGate,
  evaluateAppHealthRelease,
  parseAppHealthReleaseTarget,
  summarizeAppHealthRows,
  type AppHealthAlert,
  type AppHealthRollupRow,
} from "../src/lib/app-health-rollup";
import {
  appHealthIdentifierSchema,
  appHealthReleaseValueSchema,
} from "../src/lib/app-health";

const VALUE_OPTIONS = new Set([
  "--app-identifier",
  "--version",
  "--build",
  "--limit",
  "--wait-seconds",
]);
const FLAG_OPTIONS = new Set([
  "--json",
  "--require-reports",
  "--fail-on-failure",
]);

interface ReviewOptions {
  appIdentifier?: string;
  version?: string;
  build?: string;
  limit: number;
  waitSeconds: number;
  asJson: boolean;
  requireReports: boolean;
  failOnFailure: boolean;
}

function parseInteger(value: string | undefined, minimum: number, maximum: number) {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= minimum && parsed <= maximum ? parsed : null;
}

function parseOptions(args: string[]): ReviewOptions | null {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (FLAG_OPTIONS.has(argument)) {
      if (flags.has(argument)) return null;
      flags.add(argument);
      continue;
    }
    if (!VALUE_OPTIONS.has(argument) || values.has(argument)) return null;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) return null;
    values.set(argument, value);
    index += 1;
  }

  const limit = parseInteger(values.get("--limit") ?? "250", 1, 2_000);
  const waitSeconds = parseInteger(
    values.get("--wait-seconds") ?? "0",
    0,
    120,
  );
  if (limit === null || waitSeconds === null) return null;

  return {
    appIdentifier: values.get("--app-identifier"),
    version: values.get("--version"),
    build: values.get("--build"),
    limit,
    waitSeconds,
    asJson: flags.has("--json"),
    requireReports: flags.has("--require-reports"),
    failOnFailure: flags.has("--fail-on-failure"),
  };
}

function printSummaries(
  summaries: ReturnType<typeof summarizeAppHealthRows>,
): void {
  for (const summary of summaries) {
    console.log(
      `  ${summary.appIdentifier} ${summary.appVersion} (${summary.buildNumber}): ` +
        `${summary.reports.pass} pass, ${summary.reports.warning} warning, ` +
        `${summary.reports.fail} fail`,
    );
    for (const check of summary.checks) {
      console.log(
        `    ${check.id}: ${check.pass}/${check.total} pass, ` +
          `p95 ${check.durationP95Milliseconds} ms, ` +
          `max ${check.durationMaxMilliseconds} ms`,
      );
    }
  }
}

function printAlerts(alerts: AppHealthAlert[]): void {
  if (alerts.length === 0) return;
  console.log("Alerts:");
  for (const alert of alerts) {
    const check = "checkId" in alert ? ` ${alert.checkId}` : "";
    console.log(`  ${alert.code}${check}`);
  }
}

function buildRecentReview(
  rows: AppHealthRollupRow[],
  invalidReportCount: number,
  evaluatedAt: Date,
) {
  const summaries = summarizeAppHealthRows(rows);
  const alerts = summaries.flatMap((summary) =>
    evaluateAppHealthRelease(
      rows,
      {
        appIdentifier: summary.appIdentifier,
        appVersion: summary.appVersion,
        buildNumber: summary.buildNumber,
      },
      { evaluatedAt },
    ).alerts,
  );
  const hasWarnings = summaries.some(
    (summary) =>
      summary.reports.warning > 0 ||
      summary.checks.some((check) => check.warning > 0),
  );
  return {
    schemaVersion: 1,
    evaluatedAt: evaluatedAt.toISOString(),
    status:
      invalidReportCount > 0 || alerts.length > 0
        ? "fail"
        : hasWarnings
          ? "warning"
          : "pass",
    reportCount: rows.length,
    invalidReportCount,
    summaries,
    alerts,
  } as const;
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    console.error("APP_HEALTH_REVIEW_OPTIONS_INVALID");
    return 1;
  }
  nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  if (!process.env.DATABASE_URL) {
    console.error("APP_HEALTH_DATABASE_UNAVAILABLE");
    return 1;
  }

  if (options.build && !options.version) {
    console.error("APP_HEALTH_RELEASE_TARGET_INVALID");
    return 1;
  }

  const exactRelease = Boolean(options.version && options.build);
  const target = exactRelease
    ? parseAppHealthReleaseTarget({
        ...(options.appIdentifier
          ? { appIdentifier: options.appIdentifier }
          : {}),
        appVersion: options.version,
        buildNumber: options.build,
      })
    : null;
  if (exactRelease && !target) {
    console.error("APP_HEALTH_RELEASE_TARGET_INVALID");
    return 1;
  }
  if (
    (!options.version && options.appIdentifier) ||
    (options.version && !appHealthReleaseValueSchema.safeParse(options.version).success) ||
    (options.appIdentifier &&
      !appHealthIdentifierSchema.safeParse(options.appIdentifier).success)
  ) {
    console.error("APP_HEALTH_RELEASE_TARGET_INVALID");
    return 1;
  }

  const {
    loadAppHealthReleaseEvaluation,
    loadAppHealthVersionRows,
    loadRecentAppHealthRows,
  } = await import("../src/lib/app-health-server");
  const deadline = Date.now() + options.waitSeconds * 1_000;

  if (target) {
    let evaluation = await loadAppHealthReleaseEvaluation(target, {
      limit: options.limit,
    });
    while (evaluation.reportCount === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      evaluation = await loadAppHealthReleaseEvaluation(target, {
        limit: options.limit,
      });
    }
    const releaseGate = evaluateAppHealthOwnerReleaseGate(evaluation);
    const review = { ...evaluation, releaseGate };

    if (options.asJson) {
      console.log(JSON.stringify(review, null, 2));
    } else {
      console.log(
        `App health release: ${target.appVersion} (${target.buildNumber})`,
      );
      console.log(`Status: ${evaluation.status}`);
      console.log(`Reports: ${evaluation.reportCount}`);
      console.log(`Release gate: ${releaseGate.passed ? "pass" : "fail"}`);
      printSummaries(evaluation.summaries);
      printAlerts(evaluation.alerts);
    }

    if (evaluation.reportCount === 0) {
      console.error("APP_HEALTH_EXACT_RELEASE_MISSING");
      return 2;
    }
    if (!releaseGate.passed) {
      console.error(
        evaluation.status === "warning"
          ? "APP_HEALTH_EXACT_RELEASE_NOT_PASS"
          : "APP_HEALTH_RELEASE_BLOCKED",
      );
      return 3;
    }
    return 0;
  }

  const loadRecent = () =>
    options.version
      ? loadAppHealthVersionRows(options.version, {
          appIdentifier: options.appIdentifier,
          limit: options.limit,
        })
      : loadRecentAppHealthRows(options.limit);
  let recent = await loadRecent();
  while (recent.rows.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    recent = await loadRecent();
  }
  const review = buildRecentReview(recent.rows, recent.invalidReportCount, new Date());

  if (options.asJson) {
    console.log(JSON.stringify(review, null, 2));
  } else {
    console.log(`App health: ${review.reportCount} report(s)`);
    console.log(`Status: ${review.status}`);
    printSummaries(review.summaries);
    printAlerts(review.alerts);
  }

  if (options.requireReports && review.reportCount === 0) {
    console.error("APP_HEALTH_REPORTS_MISSING");
    return 2;
  }
  if (
    options.failOnFailure &&
    (review.invalidReportCount > 0 || review.alerts.length > 0)
  ) {
    console.error("APP_HEALTH_REPORT_FAILURE");
    return 3;
  }
  return 0;
}

void main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch(() => {
    console.error("APP_HEALTH_REVIEW_UNAVAILABLE");
    process.exitCode = 1;
  });
