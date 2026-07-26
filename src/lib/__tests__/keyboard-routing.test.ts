import { describe, expect, it } from "vitest";
import { shouldDeferKeyToActiveOverlay } from "@/lib/commands/keyboard-routing";

describe("keyboard routing", () => {
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
