import { describe, expect, it } from "vitest";
import vectors from "../../../sync/fixtures/mirror-tombstone.json";
import { mirrorTombstone, validateMirrorTombstoneObservation } from "./mirror-tombstone";

describe("native mirror tombstone disposition", () => {
  it.each(vectors)("$name", ({ observed, decision }) => {
    expect(mirrorTombstone(validateMirrorTombstoneObservation(observed))).toEqual(decision);
  });
  it("refuses unknown keys, missing fields, malformed values and inconsistent facts", () => {
    const observed = vectors[0].observed;
    const { localHash: _removed, ...missing } = observed;
    for (const value of [null, [], missing, Object.create(observed),
      { ...observed, receiptId: "native-only" }, { ...observed, editorOwned: 0 },
      { ...observed, localIdentityVerified: "true" }, { ...observed, localHash: "not-a-hash" },
      { ...observed, localHash: "a".repeat(64) + "\n" }, { ...observed, baselineHash: null }, { ...observed, remoteRevision: null },
      { ...observed, localPresent: false }, { ...observed, localPresent: true, localPath: null },
      { ...observed, remotePresent: false }, { ...observed, localLifecycle: "" },
      { ...observed, remoteLifecycle: "generation\nother" },
      ...["/Notes/F.textpack", "../F.textpack", "Notes//F.textpack", "C:/F.textpack", "Notes\\F.textpack", "Notes/F.md", "Notes/\ud800.textpack"].map(localPath => ({ ...observed, localPath })),
    ]) expect(() => validateMirrorTombstoneObservation(value)).toThrow();
  });
  it("never treats unknown generation equality as removal authority", () => {
    const observed = vectors[0].observed;
    for (const localLifecycle of [null, "generation-a"])
      for (const remoteLifecycle of [null, "generation-a"])
        expect(mirrorTombstone({ ...observed, localLifecycle, remoteLifecycle }).action)
          .toBe(localLifecycle && remoteLifecycle ? "remove-local" : "retain-conflict");
  });
  it("keeps exact path spelling and returns a detached scalar observation", () => {
    const source = { ...vectors[0].observed };
    const observed = validateMirrorTombstoneObservation(source);
    expect(observed).not.toBe(source);
    source.localPath = "Other/Changed.textpack";
    expect(observed.localPath).toBe("Notes/Fixture.textpack");
    expect(mirrorTombstone({ ...observed, localPath: "notes/Fixture.textpack" }).action).toBe("retain-conflict");
    expect(mirrorTombstone({ ...observed, localPath: "Notes/Cafe\u0301.textpack", baselinePath: "Notes/Café.textpack", remotePath: "Notes/Café.textpack" }).action).toBe("retain-conflict");
  });
});
