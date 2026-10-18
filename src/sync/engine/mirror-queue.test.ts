import { describe, expect, it } from "vitest";
import { mirrorQueue, validateMirrorQueueObservation } from "./mirror-queue";
import vectors from "../../../sync/fixtures/mirror-queue.json";
const candidate = { operationId: "retained-operation", conflicted: false, editorOwned: false, recoveryBlocked: false, permitted: true };
describe("durable mirror queue selection", () => {
  it("uses identical serialized vectors without changing operation identity or order", () => {
    for (const vector of vectors) {
      const before = JSON.stringify(vector.observed);
      expect(mirrorQueue(validateMirrorQueueObservation(vector.observed)), vector.name).toEqual(vector.decision);
      expect(JSON.stringify(vector.observed)).toBe(before);
    }
  });
  it("excludes every combination of fenced work without consuming the budget", () => {
    for (let mask = 0; mask < 16; mask++) {
      const c = { ...candidate, conflicted: !!(mask & 1), editorOwned: !!(mask & 2), recoveryBlocked: !!(mask & 4), permitted: !(mask & 8) };
      const observed = { candidates: [c, { ...candidate, operationId: "unrelated" }], budget: 1 };
      expect(mirrorQueue(observed)).toEqual(mask === 0 ? { operationIds: [candidate.operationId], hasMore: true } : { operationIds: ["unrelated"], hasMore: false });
    }
  });
  it("bounds a large retained queue and returns detached decisions", () => {
    const candidates = Array.from({ length: 40_000 }, (_, i) => ({ ...candidate, operationId: `op-${i}` }));
    const input = { candidates, budget: 512 };
    const result = mirrorQueue(input);
    expect(result.operationIds).toEqual(candidates.slice(0, 512).map(c => c.operationId));
    expect(result.hasMore).toBe(true);
    result.operationIds[0] = "changed";
    expect(candidates[0].operationId).toBe("op-0");
    expect(mirrorQueue({ candidates, budget: 0 })).toEqual({ operationIds: [], hasMore: true });
    expect(mirrorQueue({ candidates: [], budget: 0 })).toEqual({ operationIds: [], hasMore: false });
  });
  it("rejects malformed snapshots and extra durable command material", () => {
    const base = { candidates: [candidate], budget: 1 };
    for (const raw of [null, [], {}, { ...base, budget: -1 }, { ...base, budget: 513 }, { ...base, budget: 1.5 },
      { ...base, budget: NaN }, { ...base, budget: Infinity }, { ...base, payload: "private bytes" },
      { ...base, candidates: [candidate, candidate] }, { ...base, candidates: Array(40_001).fill(candidate) },
      ...[null, [], {}, { ...candidate, operationId: "" }, { ...candidate, operationId: "x\n" },
        { ...candidate, operationId: "x".repeat(129) }, { ...candidate, permitted: 1 }, { ...candidate, path: "private" },
        Object.assign(Object.create(candidate), { operationId: "inherited" })].map(c => ({ ...base, candidates: [c] }))]) {
      expect(() => validateMirrorQueueObservation(raw)).toThrow("Invalid mirror queue observation");
    }
  });
});
