import { describe, expect, it } from "vitest";
import { NATIVE_QUICK_ACTIONS } from "@/lib/ai/quick-actions";

describe("assistant quick actions", () => {
  it("includes a reversible whole-document structuring action", () => {
    expect(NATIVE_QUICK_ACTIONS).toContainEqual({
      id: "structure",
      label: "Structure",
      description: "Preview a clearer structure for the current item",
    });
  });
});
