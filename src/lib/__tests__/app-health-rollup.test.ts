import { describe, expect, it } from "vitest";

import {
  evaluateAppHealthOwnerReleaseGate,
  evaluateAppHealthRelease,
  parseAppHealthRollupRow,
  summarizeAppHealthRows,
  type AppHealthRollupRow,
} from "@/lib/app-health-rollup";

const target = {
  appIdentifier: "app.texttext.mac",
  appVersion: "0.71",
  buildNumber: "76",
};

function row(options: {
  appVersion?: string;
  buildNumber?: string;
  status?: "pass" | "warning" | "fail";
  checkStatus?: "pass" | "warning" | "fail";
  duration?: number;
  receivedAt: string;
}): AppHealthRollupRow {
  return {
    appIdentifier: target.appIdentifier,
    appVersion: options.appVersion ?? target.appVersion,
    buildNumber: options.buildNumber ?? target.buildNumber,
    trigger: "periodic",
    status: options.status ?? "pass",
    checks: [
      {
        id: "sync.roundtrip",
        status: options.checkStatus ?? "pass",
        durationMilliseconds: options.duration ?? 10,
        metrics: { private_metric_not_for_rollups: 1 },
      },
    ],
    receivedAt: new Date(options.receivedAt),
  };
}

describe("app health rollups", () => {
  it("summarizes exact version/build reports without report metadata", () => {
    const summary = summarizeAppHealthRows([
      row({ receivedAt: "2026-07-14T10:00:00Z", duration: 10 }),
      row({
        receivedAt: "2026-07-14T11:00:00Z",
        duration: 30,
        status: "warning",
        checkStatus: "warning",
      }),
    ])[0];

    expect(summary.reports).toEqual({
      total: 2,
      pass: 1,
      warning: 1,
      fail: 0,
      passRate: 0.5,
    });
    expect(summary.checks[0]).toMatchObject({
      id: "sync.roundtrip",
      total: 2,
      pass: 1,
      warning: 1,
      durationP95Milliseconds: 30,
      durationMaxMilliseconds: 30,
    });
    expect(JSON.stringify(summary)).not.toContain("private_metric_not_for_rollups");
    expect(JSON.stringify(summary)).not.toMatch(
      /userId|installationId|operatingSystemVersion|report\"/,
    );
  });

  it("fails closed when the exact release is absent or malformed", () => {
    const missing = evaluateAppHealthRelease([], target, {
      evaluatedAt: new Date("2026-07-14T12:00:00Z"),
    });
    expect(missing.releaseReady).toBe(false);
    expect(missing.reportCount).toBe(0);
    expect(missing.alerts.map((alert) => alert.code)).toEqual([
      "exact_release_missing",
    ]);

    const malformed = evaluateAppHealthRelease([], target, {
      evaluatedAt: new Date("2026-07-14T12:00:00Z"),
      invalidTargetReportCount: 1,
    });
    expect(malformed.alerts.map((alert) => alert.code)).toEqual([
      "exact_release_missing",
      "invalid_exact_release_report",
    ]);
  });

  it("blocks on a failed check even when the report claims pass", () => {
    const evaluation = evaluateAppHealthRelease(
      [
        row({
          receivedAt: "2026-07-14T12:00:00Z",
          status: "pass",
          checkStatus: "fail",
        }),
      ],
      target,
      { evaluatedAt: new Date("2026-07-14T12:01:00Z") },
    );

    expect(evaluation.releaseReady).toBe(false);
    expect(evaluation.reportCount).toBe(1);
    expect(evaluation.alerts).toContainEqual(
      expect.objectContaining({
        code: "check_failed",
        checkId: "sync.roundtrip",
        failureCount: 1,
      }),
    );
    expect(evaluateAppHealthOwnerReleaseGate(evaluation)).toEqual({
      requiredStatus: "pass",
      passed: false,
      blockingCodes: ["check_failed"],
    });
  });

  it("blocks statistically significant report and check pass-rate drops", () => {
    const baseline = Array.from({ length: 20 }, (_, index) =>
      row({
        appVersion: "0.70",
        buildNumber: "75",
        receivedAt: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
      }),
    );
    const current = Array.from({ length: 5 }, (_, index) =>
      row({
        receivedAt: `2026-07-2${index + 1}T10:00:00Z`,
        status: "warning",
        checkStatus: "warning",
      }),
    );
    const evaluation = evaluateAppHealthRelease([...baseline, ...current], target, {
      evaluatedAt: new Date("2026-07-26T10:00:00Z"),
    });

    expect(evaluation.releaseReady).toBe(false);
    expect(evaluation.alerts.map((alert) => alert.code)).toEqual([
      "report_pass_rate_regression",
      "check_pass_rate_regression",
    ]);
    expect(evaluation.summaries[0].baseline).toMatchObject({
      reportCount: 20,
      passRate: 1,
    });
  });

  it("does not classify a small cohort as a significant regression", () => {
    const baseline = Array.from({ length: 20 }, (_, index) =>
      row({
        appVersion: "0.70",
        buildNumber: "75",
        receivedAt: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
      }),
    );
    const evaluation = evaluateAppHealthRelease(
      [
        ...baseline,
        row({
          receivedAt: "2026-07-21T10:00:00Z",
          status: "warning",
          checkStatus: "warning",
        }),
      ],
      target,
      { evaluatedAt: new Date("2026-07-22T10:00:00Z") },
    );

    expect(evaluation.releaseReady).toBe(true);
    expect(evaluation.status).toBe("warning");
    expect(evaluation.alerts).toEqual([]);
    // A warning with no failing checks is non-blocking: the owner release gate
    // blocks only on a hard failure (transient signals like a File Provider
    // latency warning must not wedge a ship).
    expect(evaluateAppHealthOwnerReleaseGate(evaluation)).toEqual({
      requiredStatus: "pass",
      passed: true,
      blockingCodes: [],
    });
  });

  it("passes the owner release gate only for an overall pass", () => {
    const evaluation = evaluateAppHealthRelease(
      [row({ receivedAt: "2026-07-21T10:00:00Z" })],
      target,
      { evaluatedAt: new Date("2026-07-21T10:01:00Z") },
    );

    expect(evaluation.status).toBe("pass");
    expect(evaluateAppHealthOwnerReleaseGate(evaluation)).toEqual({
      requiredStatus: "pass",
      passed: true,
      blockingCodes: [],
    });
  });

  it("rejects rows that include full report metadata", () => {
    expect(
      parseAppHealthRollupRow({
        ...row({ receivedAt: "2026-07-14T10:00:00Z" }),
        installationId: "6a3ca65f-1645-4e54-b199-574cf09c99cb",
      }),
    ).toBeNull();
  });
});
