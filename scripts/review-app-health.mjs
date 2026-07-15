#!/usr/bin/env node
import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const version = option("--version");
const build = option("--build");
const limit = Math.max(1, Math.min(2_000, Number(option("--limit") ?? 250)));
const waitSeconds = Math.max(
  0,
  Math.min(120, Number(option("--wait-seconds") ?? 0)),
);
const asJson = args.includes("--json");
const requireReports = args.includes("--require-reports");
const failOnFailure = args.includes("--fail-on-failure");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to review app health reports.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const readRows = async () => {
  if (version && build) {
    return sql`
      select app_version, build_number, status, trigger, report, generated_at, received_at
      from app_health_reports
      where app_version = ${version} and build_number = ${build}
      order by received_at desc
      limit ${limit}
    `;
  }
  if (version) {
    return sql`
      select app_version, build_number, status, trigger, report, generated_at, received_at
      from app_health_reports
      where app_version = ${version}
      order by received_at desc
      limit ${limit}
    `;
  }
  return sql`
      select app_version, build_number, status, trigger, report, generated_at, received_at
      from app_health_reports
      order by received_at desc
      limit ${limit}
    `;
};

const deadline = Date.now() + waitSeconds * 1_000;
let rows = await readRows();
while (rows.length === 0 && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  rows = await readRows();
}

const percentile = (values, ratio) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
};

const versions = new Map();
const checks = new Map();
const triggers = {};
let firstReceivedAt = null;
let lastReceivedAt = null;

for (const row of rows) {
  const key = `${row.app_version} (${row.build_number})`;
  const summary = versions.get(key) ?? { total: 0, pass: 0, warning: 0, fail: 0 };
  summary.total += 1;
  summary[row.status] = (summary[row.status] ?? 0) + 1;
  versions.set(key, summary);
  triggers[row.trigger] = (triggers[row.trigger] ?? 0) + 1;

  const received = new Date(row.received_at).toISOString();
  if (!firstReceivedAt || received < firstReceivedAt) firstReceivedAt = received;
  if (!lastReceivedAt || received > lastReceivedAt) lastReceivedAt = received;

  for (const check of row.report?.checks ?? []) {
    const current = checks.get(check.id) ?? {
      total: 0,
      pass: 0,
      warning: 0,
      fail: 0,
      durations: [],
    };
    current.total += 1;
    current[check.status] = (current[check.status] ?? 0) + 1;
    current.durations.push(Number(check.durationMilliseconds ?? 0));
    checks.set(check.id, current);
  }
}

const report = {
  reportCount: rows.length,
  firstReceivedAt,
  lastReceivedAt,
  triggers,
  versions: Object.fromEntries([...versions.entries()]),
  checks: Object.fromEntries(
    [...checks.entries()].map(([id, value]) => [id, {
      total: value.total,
      pass: value.pass,
      warning: value.warning,
      fail: value.fail,
      durationP95Milliseconds: percentile(value.durations, 0.95),
      durationMaxMilliseconds: Math.max(0, ...value.durations),
    }]),
  ),
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`App health: ${report.reportCount} report(s)`);
  if (report.firstReceivedAt && report.lastReceivedAt) {
    console.log(`Window: ${report.firstReceivedAt} to ${report.lastReceivedAt}`);
  }
  for (const [key, value] of Object.entries(report.versions)) {
    console.log(
      `  ${key}: ${value.pass} pass, ${value.warning} warning, ${value.fail} fail`,
    );
  }
  console.log("Checks:");
  for (const [id, value] of Object.entries(report.checks)) {
    const issue = value.fail > 0 || value.warning > 0 ? " !" : "";
    console.log(
      `  ${id}: ${value.pass}/${value.total} pass, p95 ${value.durationP95Milliseconds} ms, max ${value.durationMaxMilliseconds} ms${issue}`,
    );
  }
}

if (requireReports && rows.length === 0) {
  console.error("No matching app health report was received.");
  process.exitCode = 2;
} else if (failOnFailure && rows.some((row) => row.status === "fail")) {
  console.error("At least one matching app health report failed.");
  process.exitCode = 3;
}
