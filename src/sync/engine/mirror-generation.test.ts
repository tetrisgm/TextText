import { describe, expect, it } from "vitest";
import { sameMirrorGeneration, validateMirrorGeneration, validateMirrorGenerationFacts } from "./mirror-generation";
import vectors from "../../../sync/fixtures/mirror-generation.json";

describe("typed file generation", () => {
  it.each(vectors)("$name", ({ left, right, same }) => {
    expect(sameMirrorGeneration(left, right)).toBe(same);
    expect(sameMirrorGeneration(right, left)).toBe(same);
  });
  it("never upgrades unknown or equates absent with a restored generation", () => {
    const values = [{ kind: "unknown" }, { kind: "observed-absent" },
      { kind: "present", generation: "restore-a" }, { kind: "present", generation: "restore-b" }];
    for (let a = 0; a < values.length; a++) for (let b = 0; b < values.length; b++)
      expect(sameMirrorGeneration(values[a], values[b])).toBe(a === b && a !== 0);
  });
  it("returns detached frozen facts without normalization", () => {
    const input = { kind: "present", generation: "CaseSensitive" };
    const result = validateMirrorGeneration(input);
    expect(result).toEqual(input); expect(result).not.toBe(input); expect(Object.isFrozen(result)).toBe(true);
    expect(sameMirrorGeneration(input, { kind: "present", generation: "casesensitive" })).toBe(false);
  });
  it("rejects contradictory legacy fields and accessor or inherited fact containers", () => {
    let reads = 0;
    for (const value of [[], {}, Object.create({ local: { kind: "unknown" } }),
      { get local() { reads++; return { kind: "unknown" }; } },
      { local: { kind: "observed-absent" }, extra: true }])
      expect(() => validateMirrorGenerationFacts(value, { local: null })).toThrow();
    expect(reads).toBe(0);
    expect(() => validateMirrorGenerationFacts({ local: { kind: "observed-absent" } }, { local: "restored" })).toThrow();
    expect(() => validateMirrorGenerationFacts({ local: { kind: "present", generation: "restored" } }, { local: null })).toThrow();
  });
  it("rejects null, malformed, inherited, accessor and extra fields without reading getters", () => {
    let reads = 0;
    const accessor = { get kind() { reads++; return "observed-absent"; } };
    for (const value of [null, undefined, "absent", [], {}, { kind: "absent" },
      { kind: "unknown", generation: null }, { kind: "observed-absent", generation: "sentinel" },
      { kind: "present" }, { kind: "present", generation: null }, { kind: "present", generation: "" },
      { kind: "present", generation: "a\n" }, { kind: "present", generation: "\ud800" },
      { kind: "present", generation: "é".repeat(257) }, Object.create({ kind: "observed-absent" }), accessor,
      { kind: "unknown", [Symbol("hidden")]: true }]) expect(() => validateMirrorGeneration(value)).toThrow();
    expect(reads).toBe(0);
    expect(validateMirrorGeneration({ kind: "present", generation: "é".repeat(256) })).toBeDefined();
  });
});
