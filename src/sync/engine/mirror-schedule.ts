/** Pure retry timing for the native file mirror. Native adapters retain timers,
 * remote discovery and durable queues; this policy never creates or changes an
 * operation identity, payload, permission grant or collaboration lease.
 *
 * Outcomes describe the whole pass. Item conflicts/revoked operations that were
 * safely fenced while unrelated work completed are a successful pass, with
 * hasEligiblePending excluding those fenced operations.
 */
export type MirrorScheduleOutcome = "success" | "transient" | "auth-required" |
  "permission" | "conflict" | "storage" | "policy-unavailable" | "stopped";

export interface MirrorScheduleObservation {
  outcome: MirrorScheduleOutcome;
  /** Consecutive completed transient failures before this outcome, saturated at 6. */
  consecutiveFailures: number;
  hasEligiblePending: boolean;
  rerun: boolean;
}
export interface MirrorScheduleDecision {
  action: "run" | "wait-change" | "wait-credentials" | "wait-reopen" | "stop";
  /** A single delay, never an additional debounce after a retry delay. */
  delayMs: number | null;
  consecutiveFailures: number;
}

const outcomes: readonly string[] = ["success", "transient", "auth-required", "permission",
  "conflict", "storage", "policy-unavailable", "stopped"];

export function validateMirrorScheduleObservation(value: unknown): MirrorScheduleObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid mirror schedule observation");
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  if (keys.length !== 4 || keys.some(key => !["outcome", "consecutiveFailures", "hasEligiblePending", "rerun"].includes(key)) || typeof v.outcome !== "string" || !outcomes.includes(v.outcome) ||
      !Number.isInteger(v.consecutiveFailures) || (v.consecutiveFailures as number) < 0 ||
      (v.consecutiveFailures as number) > 6 || typeof v.hasEligiblePending !== "boolean" || typeof v.rerun !== "boolean") {
    throw Error("Invalid mirror schedule observation");
  }
  return { outcome: v.outcome as MirrorScheduleOutcome, consecutiveFailures: v.consecutiveFailures as number,
    hasEligiblePending: v.hasEligiblePending, rerun: v.rerun };
}

export function mirrorSchedule(input: MirrorScheduleObservation): MirrorScheduleDecision {
  const v = validateMirrorScheduleObservation(input);
  switch (v.outcome) {
    case "stopped": return { action: "stop", delayMs: null, consecutiveFailures: 0 };
    case "auth-required": return { action: "wait-credentials", delayMs: null, consecutiveFailures: 0 };
    case "storage":
    case "policy-unavailable": return { action: "wait-reopen", delayMs: null, consecutiveFailures: 0 };
    case "permission":
    case "conflict": return { action: "wait-change", delayMs: null, consecutiveFailures: 0 };
    case "transient": return {
      action: "run", delayMs: Math.min(60_000, 2_000 * 2 ** v.consecutiveFailures),
      consecutiveFailures: Math.min(6, v.consecutiveFailures + 1),
    };
    case "success": return {
      action: v.hasEligiblePending || v.rerun ? "run" : "wait-change",
      delayMs: v.hasEligiblePending || v.rerun ? 400 : null, consecutiveFailures: 0,
    };
  }
}
