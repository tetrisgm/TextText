import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPEARANCE_BOOT_SCRIPT,
  APPEARANCE_STORAGE_KEY,
  appearanceLabel,
  isAppearance,
  nextAppearance,
} from "@/lib/workspace/appearance";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("appearance preference", () => {
  it("cycles light, dark, system", () => {
    expect(nextAppearance("light")).toBe("dark");
    expect(nextAppearance("dark")).toBe("system");
    expect(nextAppearance("system")).toBe("light");
  });

  it("names each state for the toast and the control", () => {
    expect(appearanceLabel("light")).toBe("Light");
    expect(appearanceLabel("dark")).toBe("Dark");
    expect(appearanceLabel("system")).toBe("System");
  });

  it("rejects anything that is not one of the three", () => {
    expect(isAppearance("light")).toBe(true);
    expect(isAppearance("Dark")).toBe(false);
    expect(isAppearance(null)).toBe(false);
  });

  it("boots only for an explicit choice, so system keeps following the OS", () => {
    // The stamp is what beats prefers-color-scheme; writing it for "system"
    // would freeze the OS setting at whatever it was on first load.
    expect(APPEARANCE_BOOT_SCRIPT).toContain(JSON.stringify(APPEARANCE_STORAGE_KEY));
    expect(APPEARANCE_BOOT_SCRIPT).toContain('v==="light"||v==="dark"');
    expect(APPEARANCE_BOOT_SCRIPT).toContain("setAttribute");
    expect(APPEARANCE_BOOT_SCRIPT).not.toContain("system");
    // Never throws out of the head, whatever storage does.
    expect(APPEARANCE_BOOT_SCRIPT).toContain("catch");
  });
});
