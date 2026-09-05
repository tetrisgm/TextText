import { describe, expect, it } from "vitest";
import { replicaHasActiveMessages } from "../replica-peek";

const replica = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    conversations: [
      { id: "a", messages: [{ role: "user", text: "hello" }] },
      { id: "b", messages: [] },
    ],
    activeByContext: { "place:/@demo": "a", "item:42": "b" },
    ...overrides,
  });

describe("replicaHasActiveMessages", () => {
  it("is true when the active chat for the context holds messages", () => {
    expect(replicaHasActiveMessages(replica(), "place:/@demo")).toBe(true);
  });
  it("is false for an empty active chat, an unknown context, or no replica", () => {
    expect(replicaHasActiveMessages(replica(), "item:42")).toBe(false);
    expect(replicaHasActiveMessages(replica(), "item:missing")).toBe(false);
    expect(replicaHasActiveMessages(null, "place:/@demo")).toBe(false);
  });
  it("treats corrupt or foreign shapes as a fresh start", () => {
    expect(replicaHasActiveMessages("{not json", "place:/@demo")).toBe(false);
    expect(
      replicaHasActiveMessages(replica({ activeByContext: ["a"] }), "place:/@demo"),
    ).toBe(false);
  });
});
