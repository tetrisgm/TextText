import { describe, expect, it } from "vitest";
import { mirrorSchedule, validateMirrorScheduleObservation } from "./mirror-schedule";
import vectors from "../../../sync/fixtures/mirror-schedule.json";

const base = { outcome: "success", consecutiveFailures: 0, hasEligiblePending: false, rerun: false } as const;

describe("native mirror retry schedule", () => {
  it("uses identical serialized decisions for each outcome and delay boundary", () => {
    for (const vector of vectors) {
      const observed = validateMirrorScheduleObservation(vector.observed);
      const before = JSON.stringify(observed);
      Object.freeze(observed);
      expect(mirrorSchedule(observed), vector.name).toEqual(vector.decision);
      expect(JSON.stringify(observed), vector.name).toBe(before);
    }
  });
  it("bounds retries indefinitely, then resets only after the changed outcome", () => {
    let failures = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      const decision = mirrorSchedule({ ...base, outcome: "transient", consecutiveFailures: failures });
      expect(decision.action).toBe("run");
      expect(decision.delayMs).toBe(Math.min(60_000, 2_000 * 2 ** Math.min(attempt, 6)));
      failures = decision.consecutiveFailures;
    }
    expect(failures).toBe(6);
    const idle = mirrorSchedule({ ...base, consecutiveFailures: failures });
    expect(idle.consecutiveFailures).toBe(0);
    expect(mirrorSchedule({ ...base, outcome: "transient", consecutiveFailures: idle.consecutiveFailures }).delayMs).toBe(2000);
  });
  it("never turns authentication, access or recovery failures into timers", () => {
    for (const outcome of ["auth-required", "permission", "conflict", "storage", "policy-unavailable", "stopped"] as const) {
      for (const hasEligiblePending of [true, false]) for (const rerun of [true, false]) {
        expect(mirrorSchedule({ outcome, consecutiveFailures: 3, hasEligiblePending, rerun }).delayMs).toBeNull();
      }
    }
  });
  it("rejects malformed, unknown and durable-command fields without guessing", () => {
    for (const value of [null, [], {}, { ...base, outcome: "offline" }, { ...base, consecutiveFailures: -1 },
      { ...base, consecutiveFailures: 7 }, { ...base, consecutiveFailures: 0.5 }, { ...base, consecutiveFailures: NaN },
      { ...base, consecutiveFailures: Infinity }, { ...base, rerun: 1 }, { ...base, hasEligiblePending: "true" },
      Object.assign(Object.create(base), { a: 1, b: 2, c: 3, d: 4 }),
      { ...base, operationId: "must-retain-existing-id" }, { ...base, payload: "must-retain-existing-bytes" },
      { outcome: "success", consecutiveFailures: 0, hasEligiblePending: false, unrelated: false }]) {
      expect(() => validateMirrorScheduleObservation(value)).toThrow("Invalid mirror schedule observation");
    }
  });
});
