import { describe, expect, it } from "vitest";
import { detachedSlice } from "@/lib/detached-slice";

describe("detachedSlice", () => {
  it("cuts to the requested length", () => {
    expect(detachedSlice("abcdefghij", 4)).toBe("abcd");
    expect(detachedSlice("abc", 10)).toBe("abc");
  });

  it("returns the original when the cut is the whole string", () => {
    const whole = "abcdef";
    expect(detachedSlice(whole, 6)).toBe(whole);
  });

  it("handles an empty string and a zero length", () => {
    expect(detachedSlice("", 10)).toBe("");
    expect(detachedSlice("abc", 0)).toBe("");
  });

  it("keeps astral characters whole", () => {
    // split("") splits by UTF-16 code unit, so a surrogate pair survives a
    // cut that does not land inside it.
    expect(detachedSlice("ab😀cd", 4)).toBe("ab😀");
  });
});
