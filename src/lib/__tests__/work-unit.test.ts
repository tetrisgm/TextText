import { describe, expect, it } from "vitest";
import {
  formatDuration,
  safeReceiptName,
  validateReleaseReceipt,
  type ReleaseGateReceipt,
} from "../../../scripts/work-unit";

const identity = {
  sourceCommit: "a".repeat(40),
  sourceFingerprint: "b".repeat(64),
};

function validReceipt(): ReleaseGateReceipt {
  return {
    schemaVersion: 1,
    ...identity,
    generatedAt: "2026-07-18T00:00:00.000Z",
    totalDurationMilliseconds: 1_500,
    checks: [
      "web.types",
      "web.unit",
      "native.unit",
      "native.live_ai",
      "apple.eval",
    ].map((id) => ({
      id,
      status: "pass" as const,
      durationMilliseconds: 300,
      reused: false,
      commandFingerprint: "c".repeat(64),
    })),
  };
}

describe("work-unit receipts", () => {
  it("accepts only a complete receipt for the exact source state", () => {
    expect(validateReleaseReceipt(validReceipt(), identity)).toBeTruthy();
    expect(() =>
      validateReleaseReceipt(validReceipt(), {
        ...identity,
        sourceFingerprint: "d".repeat(64),
      }),
    ).toThrow("current source state");

    const incomplete = validReceipt();
    incomplete.checks.pop();
    expect(() => validateReleaseReceipt(incomplete, identity)).toThrow(
      "missing required checks",
    );
  });

  it("formats concise command names and timings", () => {
    expect(safeReceiptName("Web: production build")).toBe("web-production-build");
    expect(formatDuration(750)).toBe("750 ms");
    expect(formatDuration(2_500)).toBe("2.5 s");
    expect(formatDuration(125_000)).toBe("2m 5s");
  });
});
