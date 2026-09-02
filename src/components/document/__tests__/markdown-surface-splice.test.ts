import { describe, expect, it } from "vitest";
import {
  lineOverlaySignatures,
  lineSplice,
} from "@/components/document/MarkdownSurface";

// The reconciler's promise: per-keystroke DOM work is proportional to the
// CHANGED LINES, never to the buffer. These pin the pure decisions it makes;
// the DOM behavior itself is exercised by the browser collaboration eval.
describe("line splice", () => {
  it("finds the single edited line in a large document", () => {
    const previous = Array.from({ length: 10_000 }, (_, i) => `line ${i}`);
    const next = [...previous];
    next[6_543] = "line 6543 edited";
    expect(lineSplice(previous, next)).toEqual({
      start: 6_543,
      oldEnd: 6_544,
      newEnd: 6_544,
    });
  });

  it("maps Enter to one line replaced by two", () => {
    expect(lineSplice(["alpha beta", "gamma"], ["alpha", " beta", "gamma"]))
      .toEqual({ start: 0, oldEnd: 1, newEnd: 2 });
  });

  it("maps a joined line to two replaced by one", () => {
    expect(lineSplice(["alpha", "beta", "gamma"], ["alphabeta", "gamma"]))
      .toEqual({ start: 0, oldEnd: 2, newEnd: 1 });
  });

  it("returns an empty splice for identical documents", () => {
    const lines = ["one", "two", "three"];
    expect(lineSplice(lines, [...lines])).toEqual({
      start: 3,
      oldEnd: 3,
      newEnd: 3,
    });
  });

  it("handles growing from and shrinking to an empty document", () => {
    expect(lineSplice([], ["first"])).toEqual({
      start: 0,
      oldEnd: 0,
      newEnd: 1,
    });
    expect(lineSplice(["first", "second"], [])).toEqual({
      start: 0,
      oldEnd: 2,
      newEnd: 0,
    });
  });

  it("keeps repeated identical lines from over-matching", () => {
    // Every line is the same text; deleting one from the middle must still
    // produce a one-line splice, not a rebuilt document.
    const previous = ["x", "x", "x", "x"];
    const next = ["x", "x", "x"];
    const splice = lineSplice(previous, next);
    expect(splice.oldEnd - splice.start).toBe(1);
    expect(splice.newEnd - splice.start).toBe(0);
  });
});

describe("line overlay signatures", () => {
  const lines = ["alpha", "beta", "gamma"];
  const starts = [0, 6, 11]; // "alpha\nbeta\ngamma"

  it("marks only the caret's line", () => {
    const sigs = lineOverlaySignatures(lines, starts, [
      { clientId: 7, userName: "Ada", color: "#f00", from: 8, to: 8 },
    ]);
    expect(sigs[0]).toBe("");
    expect(sigs[1]).not.toBe("");
    expect(sigs[2]).toBe("");
  });

  it("marks every line a peer range crosses", () => {
    const sigs = lineOverlaySignatures(lines, starts, [
      { clientId: 7, userName: "Ada", color: "#f00", from: 2, to: 12 },
    ]);
    expect(sigs.every((sig) => sig !== "")).toBe(true);
  });

  it("assigns a caret on a line boundary to the following line", () => {
    const sigs = lineOverlaySignatures(lines, starts, [
      { clientId: 7, userName: "Ada", color: "#f00", from: 6, to: 6 },
    ]);
    expect(sigs[0]).toBe("");
    expect(sigs[1]).not.toBe("");
  });

  it("changes when a caret moves, so its old and new lines both rebuild", () => {
    const before = lineOverlaySignatures(lines, starts, [
      { clientId: 7, userName: "Ada", color: "#f00", from: 1, to: 1 },
    ]);
    const after = lineOverlaySignatures(lines, starts, [
      { clientId: 7, userName: "Ada", color: "#f00", from: 7, to: 7 },
    ]);
    expect(before[0]).not.toBe(after[0]);
    expect(before[1]).not.toBe(after[1]);
  });
});
