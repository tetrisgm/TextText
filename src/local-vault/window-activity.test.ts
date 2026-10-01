import { describe, expect, it } from "vitest";
import { vaultWindowActive } from "./window-activity";

describe("vault window activity", () => {
  it.each([
    [true, "visible", false, true],
    [true, "hidden", true, true],
    [true, "hidden", false, false],
    [false, "visible", true, false],
  ] as const)("online=%s visibility=%s focused=%s => %s", (online, visibility, focused, active) => {
    expect(vaultWindowActive(online, visibility, focused)).toBe(active);
  });
});
