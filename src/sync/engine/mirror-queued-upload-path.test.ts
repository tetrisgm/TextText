import { describe, expect, it } from "vitest";
import vectors from "../../../sync/fixtures/mirror-queued-upload-path.json";
import { mirrorQueuedUploadPath, validateMirrorQueuedUploadPathObservation } from "./mirror-queued-upload-path";

describe("queued upload path eligibility", () => {
  it.each(vectors)("$name", ({ observed, decision }) => {
    expect(mirrorQueuedUploadPath(validateMirrorQueuedUploadPathObservation(observed))).toEqual(decision);
  });
  it("rejects unknown, missing, malformed and incoherent wire facts", () => {
    const base = vectors[0].observed;
    const { permitted: _missing, ...missing } = base;
    for (const value of [null, [], missing, Object.create(base), { ...base, future: true },
      { ...base, pendingKind: "future" }, { ...base, intentKind: "future" },
      { ...base, permitted: 1 }, { ...base, stagedPayloadVerified: "true" },
      { ...base, pendingPath: null }, { ...base, remotePath: null },
      { ...base, baselinePath: null }, { ...base, localPath: null },
      { ...base, intentKind: "none", intentPath: "Original.textpack" },
      { ...base, intentKind: "rename" }, { ...base, intentKind: "delete", intentPath: "Original.textpack", intentDestination: "Moved.textpack" },
      ...["", "x\n", "x\u0000", "x".repeat(513)].map(remoteRevision => ({ ...base, remoteRevision })),
      ...["/F.textpack", "../F.textpack", "A//F.textpack", "C:/F.textpack", "A\\F.textpack", "F.md", "A/\ud800.textpack"].map(localPath => ({ ...base, localPath })),
    ]) expect(() => validateMirrorQueuedUploadPathObservation(value)).toThrow();
  });
  it("requires each generation to be actually known, not equality of nulls", () => {
    const base = validateMirrorQueuedUploadPathObservation(vectors[0].observed);
    for (const pendingLifecycle of [null, "generation-a"])
      for (const baselineLifecycle of [null, "generation-a"])
        for (const remoteLifecycle of [null, "generation-a"])
          expect(mirrorQueuedUploadPath({ ...base, pendingLifecycle, baselineLifecycle, remoteLifecycle }).action)
            .toBe(pendingLifecycle && baselineLifecycle && remoteLifecycle ? "reissue-at-remote-path" : "defer");
  });
  it("returns detached observations and never mutates native facts", () => {
    const source = { ...vectors[0].observed };
    const observed = validateMirrorQueuedUploadPathObservation(source);
    source.localPath = "Changed.textpack";
    expect(observed.localPath).toBe("Original.textpack");
    const before = JSON.stringify(observed);
    mirrorQueuedUploadPath(observed);
    expect(JSON.stringify(observed)).toBe(before);
  });
});
