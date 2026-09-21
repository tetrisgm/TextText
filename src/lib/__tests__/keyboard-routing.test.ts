import { describe, expect, it } from "vitest";
import { shouldDeferKeyToActiveOverlay, shouldDeferNativeActivation } from "@/lib/commands/keyboard-routing";

describe("keyboard routing", () => {
  const event = { key: "Enter", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
  it("lets focused buttons and links activate instead of opening workspace selection", () => {
    expect(shouldDeferNativeActivation(event, "button")).toBe(true);
    expect(shouldDeferNativeActivation({ ...event, key: " " }, "button")).toBe(true);
    expect(shouldDeferNativeActivation(event, "link")).toBe(true);
    expect(shouldDeferNativeActivation({ ...event, key: " " }, "link")).toBe(false);
    expect(shouldDeferNativeActivation(event, null)).toBe(false);
  });
  it.each(["metaKey", "ctrlKey", "altKey", "shiftKey"] as const)("preserves modified shortcuts with %s", (modifier) => {
    expect(shouldDeferNativeActivation({ ...event, [modifier]: true }, "button")).toBe(false);
  });
  it("lets the active overlay own Enter and other non-Escape keys", () => {
    expect(shouldDeferKeyToActiveOverlay(1, "Enter")).toBe(true);
    expect(shouldDeferKeyToActiveOverlay(1, "ArrowRight")).toBe(true);
    expect(shouldDeferKeyToActiveOverlay(2, "Backspace")).toBe(true);
  });

  it("keeps Escape in the global layer so it can close the top overlay", () => {
    expect(shouldDeferKeyToActiveOverlay(1, "Escape")).toBe(false);
  });

  it("does not alter routing when no overlay is active", () => {
    expect(shouldDeferKeyToActiveOverlay(0, "Enter")).toBe(false);
    expect(shouldDeferKeyToActiveOverlay(0, "Backspace")).toBe(false);
  });
});
