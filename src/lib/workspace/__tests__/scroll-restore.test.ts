import { expect, it } from "vitest";
import { scrollRestoreWindow } from "../scroll-restore";

it("waits for an asynchronous list then gives its layout time to settle", () => {
  const finished = scrollRestoreWindow(false, 0);
  expect(finished(300, false)).toBe(false);
  expect(finished(1200, false)).toBe(false);
  expect(finished(1300, true)).toBe(false);
  expect(finished(1549, true)).toBe(false);
  expect(finished(1550, true)).toBe(true);
});
it("does not prolong the ordinary cached-list return", () => {
  const finished = scrollRestoreWindow(false, 100);
  expect(finished(100, true)).toBe(false);
  expect(finished(350, true)).toBe(true);
});
it("restarts settling if a list shrinks during hydration", () => {
  const finished = scrollRestoreWindow(false, 0);
  expect(finished(0, true)).toBe(false);
  expect(finished(200, false)).toBe(false);
  expect(finished(400, true)).toBe(false);
  expect(finished(650, true)).toBe(true);
});
it("has a deadline when deleted rows make the old position unreachable", () => {
  const finished = scrollRestoreWindow(false, 0);
  expect(finished(2499, false)).toBe(false);
  expect(finished(2500, false)).toBe(true);
});
it("preserves the existing reader/editor settling window", () => {
  const finished = scrollRestoreWindow(true, 100);
  expect(finished(999, true)).toBe(false);
  expect(finished(1000, false)).toBe(true);
});
