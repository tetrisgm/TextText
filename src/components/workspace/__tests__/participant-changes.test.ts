import { describe, expect, it } from "vitest";
import { changeSummary, itemAgentChanges } from "../participant-changes";
const change = { id: "record-1", connectionId: "connection-1", runId: "run-1", createdAt: "2026-09-05T00:00:00.000Z", reverted: false, revertsId: null,
  changes: [{ field: "body", before: "Before", after: "After" }] };
describe("participant item history", () => {
  it("checks the requested item before exposing content", () => {
    expect(() => itemAgentChanges({ itemId: "old-item", changes: [change] }, "new-item")).toThrow();
  });
  it("rejects unavailable or malformed results instead of reporting no changes", () => {
    for (const payload of [{}, { itemId: "item" }, { itemId: "item", changes: [{ ...change, createdAt: "yesterday" }] }]) {
      expect(() => itemAgentChanges(payload, "item")).toThrow();
    }
  });
  it("sorts latest-first and keeps authenticated connection/run attribution", () => {
    const changes = itemAgentChanges({ itemId: "item", changes: [change, { ...change, id: "record-2", createdAt: "2026-09-06T00:00:00.000Z" }] }, "item");
    expect(changes[0].id).toBe("record-2");
    expect(changes[0].connectionId).toBe("connection-1");
    expect(changes[0].runId).toBe("run-1");
  });
  it("labels edits and reverts without attributing them to a presence display name", () => {
    const [record] = itemAgentChanges({ itemId: "item", changes: [change] }, "item");
    expect(changeSummary(record)).toBe("Changed body");
    expect(changeSummary({ ...record, reverted: true })).toBe("Changed body (reverted)");
    expect(changeSummary({ ...record, revertsId: "earlier" })).toBe("Reverted body");
  });
  it("accepts a confirmed empty history", () => {
    expect(itemAgentChanges({ itemId: "item", changes: [] }, "item")).toEqual([]);
  });
});
