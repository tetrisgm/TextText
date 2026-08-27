import { describe, expect, it } from "vitest";
import { compareBuild, comparableBuild } from "@/lib/deployed-build";

/**
 * The decision behind "this page is out of date", kept away from React and the
 * network so it can be checked directly.
 *
 * The failure this prevents is not a crash. It is a person looking at a fix
 * that shipped hours ago and reporting it as broken, because the window they
 * are in still holds the bundle it loaded.
 */
describe("is this page still the build the origin serves", () => {
  it("says stale when the origin has moved on", () => {
    expect(compareBuild("texttext-aaa", { buildId: "texttext-bbb" })).toEqual({
      state: "stale",
      running: "texttext-aaa",
      serving: "texttext-bbb",
    });
  });

  it("says current when they match", () => {
    expect(compareBuild("texttext-aaa", { buildId: "texttext-aaa" })).toEqual({
      state: "current",
    });
  });

  it("stays quiet in development, where the id never changes but the code does", () => {
    expect(compareBuild("development", { buildId: "development" }).state).toBe(
      "unknown",
    );
    expect(compareBuild("development", { buildId: "texttext-aaa" }).state).toBe(
      "unknown",
    );
  });

  it("stays quiet when the answer is unusable, rather than nagging", () => {
    for (const answer of [null, undefined, {}, { buildId: "" }, "", 7]) {
      expect(compareBuild("texttext-aaa", answer).state).toBe("unknown");
    }
    expect(compareBuild(null, { buildId: "texttext-aaa" }).state).toBe("unknown");
  });

  it("accepts a bare string as well as the endpoint's shape", () => {
    expect(compareBuild("texttext-aaa", "texttext-bbb").state).toBe("stale");
  });

  it("ignores surrounding whitespace on both sides", () => {
    expect(compareBuild(" texttext-aaa ", { buildId: "texttext-aaa" }).state).toBe(
      "current",
    );
    expect(comparableBuild("  ")).toBeNull();
  });
});
