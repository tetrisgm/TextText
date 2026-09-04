import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isNewTabClick,
  isSelectionRangeClick,
  isSelectionToggleClick,
} from "@/lib/workspace/selection-modifiers";

const click = (over: Partial<Record<string, boolean | number>> = {}) => ({
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  button: 0,
  ...over,
}) as never;

function platform(value: string) {
  vi.stubGlobal("navigator", { platform: value, userAgent: value });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("selection modifiers on a Mac", () => {
  it("Option toggles, Cmd opens a tab, and they never overlap", () => {
    platform("MacIntel");
    expect(isSelectionToggleClick(click({ altKey: true }))).toBe(true);
    expect(isNewTabClick(click({ altKey: true }))).toBe(false);
    expect(isNewTabClick(click({ metaKey: true }))).toBe(true);
    expect(isSelectionToggleClick(click({ metaKey: true }))).toBe(false);
  });

  it("Ctrl does NOT toggle, because it is the secondary-click alias", () => {
    platform("MacIntel");
    expect(isSelectionToggleClick(click({ ctrlKey: true }))).toBe(false);
  });

  it("Shift extends a range, with or without the toggle key", () => {
    platform("MacIntel");
    expect(isSelectionRangeClick(click({ shiftKey: true }))).toBe(true);
    expect(isSelectionRangeClick(click({ shiftKey: true, altKey: true }))).toBe(true);
    // A range click must not also be read as opening a tab.
    expect(isNewTabClick(click({ metaKey: true, shiftKey: true }))).toBe(false);
  });
});

describe("selection modifiers elsewhere", () => {
  it("Ctrl toggles and Ctrl opens no tab confusion", () => {
    platform("Win32");
    expect(isSelectionToggleClick(click({ ctrlKey: true }))).toBe(true);
    expect(isNewTabClick(click({ ctrlKey: true }))).toBe(true);
    expect(isNewTabClick(click({ metaKey: true }))).toBe(false);
  });

  it("Option still toggles, so a Mac keyboard on another machine works", () => {
    platform("Win32");
    expect(isSelectionToggleClick(click({ altKey: true }))).toBe(true);
  });
});

describe("plain clicks", () => {
  it("carry no modifier meaning", () => {
    platform("MacIntel");
    expect(isSelectionToggleClick(click())).toBe(false);
    expect(isSelectionRangeClick(click())).toBe(false);
    expect(isNewTabClick(click())).toBe(false);
    expect(isNewTabClick(click({ metaKey: true, button: 1 }))).toBe(false);
  });
});
