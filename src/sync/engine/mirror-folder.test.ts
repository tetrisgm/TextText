import vectors from "../../../sync/fixtures/mirror-folder.json";
import { describe, expect, it } from "vitest";
import { mirrorFolder, validateMirrorFolderObservation, type MirrorFolderObservation } from "./mirror-folder";
const base: MirrorFolderObservation = { phase: "candidate", capabilityAvailable: true, topologyMatches: true, changesContained: true, barriers: [] };
describe("folder dispatch", () => {
  it("matches serialized adapter vectors", () => {
    for (const vector of vectors) expect(mirrorFolder(validateMirrorFolderObservation(vector.observed))).toEqual(vector.decision);
  });
  it("stages only a complete candidate and leaves idle work alone", () => {
    expect(mirrorFolder(base)).toEqual({ action: "stage-new" });
    expect(mirrorFolder({ ...base, phase: "idle", capabilityAvailable: false })).toEqual({ action: "none" });
    for (const key of ["capabilityAvailable", "topologyMatches", "changesContained"] as const)
      expect(mirrorFolder({ ...base, [key]: false })).toEqual({ action: "hold" });
  });
  it("retained receipt replay ignores fresh topology without inventing terminal conflict", () => {
    expect(mirrorFolder({ ...base, phase: "pending", topologyMatches: false, changesContained: false })).toEqual({ action: "replay-existing" });
    expect(mirrorFolder({ ...base, phase: "pending", capabilityAvailable: false })).toEqual({ action: "hold" });
  });
  it("preserves every supplied platform barrier", () => {
    for (const lane of ["document", "binary", "savedRename", "pull"] as const)
      for (const phase of ["candidate", "pending"] as const)
        expect(mirrorFolder({ ...base, phase, barriers: [lane] })).toEqual({ action: "hold" });
  });
  it("returns detached observations and rejects malformed/future data", () => {
    const input = { ...base, barriers: ["binary"] as MirrorFolderObservation["barriers"] };
    const copy = validateMirrorFolderObservation(input); input.barriers.length = 0;
    expect(copy.barriers).toEqual(["binary"]);
    for (const bad of [null, [], { ...base, future: true }, { ...base, phase: "future" },
      { ...base, barriers: ["binary", "binary"] }, { ...base, barriers: ["unknown"] },
      { ...base, barriers: new Array(1) }, { ...base, topologyMatches: 1 }, { ...base, barriers: "binary" }])
      expect(() => validateMirrorFolderObservation(bad)).toThrow();
    const extra = Object.assign(["binary"], { future: true });
    expect(() => validateMirrorFolderObservation({ ...base, barriers: extra })).toThrow("Invalid folder observation");
    const symbol = ["binary"]; Object.defineProperty(symbol, Symbol("future"), { value: true });
    expect(() => validateMirrorFolderObservation({ ...base, barriers: symbol })).toThrow("Invalid folder observation");
    const barriers = ["binary"]; Object.defineProperty(barriers, "0", { get() { throw Error("must not run"); } });
    expect(() => validateMirrorFolderObservation({ ...base, barriers })).toThrow("Invalid folder observation");
    const getter = { ...base }; Object.defineProperty(getter, "phase", { get() { throw Error("must not run"); } });
    expect(() => validateMirrorFolderObservation(getter)).toThrow("Invalid folder observation");
  });
});
