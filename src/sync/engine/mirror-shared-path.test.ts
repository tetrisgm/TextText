import { describe, expect, it } from "vitest";
import { mirrorSharedPath, validateMirrorSharedPathObservation } from "./mirror-shared-path";
import vectors from "../../../sync/fixtures/mirror-shared-path.json";
const base = validateMirrorSharedPathObservation(vectors[0].observed);
describe("protected projection path disposition", () => {
  it.each(vectors)("uses the serialized decision: $name", vector => {
    const before = JSON.stringify(vector.observed);
    expect(mirrorSharedPath(validateMirrorSharedPathObservation(vector.observed))).toEqual(vector.decision);
    expect(JSON.stringify(vector.observed)).toBe(before);
  });
  it("returns only a disposition, never an operation ID, payload or mutation", () => {
    for (const vector of vectors) expect(Object.keys(mirrorSharedPath(validateMirrorSharedPathObservation(vector.observed)))).toEqual(["action"]);
  });
  it("does not confuse an ambiguous retained replay with review or allocate a new identity", () => {
    expect(mirrorSharedPath({ ...base, pendingRename: "replay" })).toEqual({ action: "announce-local" });
    expect(mirrorSharedPath({ ...base, pendingRename: "review" })).toEqual({ action: "hold" });
  });
  it("refuses future, missing, mistyped and executable fields", () => {
    for (const value of [null, [], true, {}, { ...base, future: true }, { ...base, pendingRename: "conflicted" }, { ...base, blocked: 0 },
      Object.fromEntries(Object.entries(base).filter(([key]) => key !== "localUnique")), { ...base, operationId: "not-policy-owned" }, { ...base, localLifecycle: "" }, { ...base, remoteLifecycle: 1 }, { ...base, localLifecycle: "x".repeat(513) }, { ...base, remoteLifecycle: "generation\n" }, { ...base, lifecycleMatches: true }])
      expect(() => validateMirrorSharedPathObservation(value)).toThrow("Invalid mirror shared path observation");
  });
  it("refuses unsafe, malformed or oversized relative pack paths", () => {
    for (const key of ["baselinePath", "localPath", "remotePath", "checkpointPath"]) {
      for (const value of ["", "/absolute.textpack", "C:/absolute.textpack", "../x.textpack", "a/../x.textpack", "a/./x.textpack", "a//x.textpack", "a\\x.textpack", "x.md", "x.textpack\n", "x\u0000.textpack", "x".repeat(1024) + ".textpack", "\ud800.textpack", 1, {}])
        expect(() => validateMirrorSharedPathObservation({ ...base, [key]: value })).toThrow("Invalid mirror shared path observation");
    }
  });
  it("compares exact case and Unicode without normalizing native path identity", () => {
    expect(mirrorSharedPath({ ...base, localPath: "Notes/old.textpack", checkpointPath: "Notes/old.textpack" })).toEqual({ action: "announce-local" });
    expect(mirrorSharedPath({ ...base, baselinePath: "Notes/é.textpack", remotePath: "Notes/é.textpack", localPath: "Notes/é.textpack", checkpointPath: "Notes/é.textpack" })).toEqual({ action: "announce-local" });
  });
});
