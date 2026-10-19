import { describe, expect, it } from "vitest";
import vectors from "../../../sync/fixtures/mirror-saved-rename.json";
import generationVectors from "../../../sync/fixtures/mirror-generation-rename.json";
import { mirrorSavedRename, validateMirrorSavedRenameObservation } from "./mirror-saved-rename";

describe("saved rename eligibility", () => {
  it.each(generationVectors)("typed generation: $name", ({ observed, decision }) => {
    expect(mirrorSavedRename(validateMirrorSavedRenameObservation(observed))).toEqual(decision);
  });
  it("replays a certified absent saved generation but holds unknown and reviews restore", () => {
    const pending = validateMirrorSavedRenameObservation(vectors.find(row => row.name === "saved request replays immutably")!.observed);
    const absent = { kind: "observed-absent" } as const, unknown = { kind: "unknown" } as const;
    const observed = { ...pending, localLifecycle: null, remoteLifecycle: null, savedLifecycle: null,
      generations: { local: absent, remote: absent, saved: absent, stoppedLocal: unknown, stoppedRemote: unknown } };
    expect(mirrorSavedRename(observed).action).toBe("replay-saved");
    expect(mirrorSavedRename({ ...observed, generations: { ...observed.generations, local: unknown } }).action).toBe("hold");
    expect(mirrorSavedRename({ ...observed, remoteLifecycle: "restored", generations: { ...observed.generations, remote: { kind: "present", generation: "restored" } } }).action).toBe("review");
    expect(mirrorSavedRename({ ...observed, generations: { ...observed.generations, saved: unknown } }).action).toBe("review");
  });
  it.each(vectors)("$name", ({ observed, decision }) => {
    expect(mirrorSavedRename(validateMirrorSavedRenameObservation(observed))).toEqual(decision);
  });
  it("rejects malformed, inherited, unknown and contradictory facts", () => {
    const observed = vectors[0].observed;
    const { phase: _phase, ...missing } = observed;
    const pending = vectors.find(row => row.name === "saved request replays immutably")!.observed;
    const stopped = vectors.find(row => row.name === "stopped move remains suppressed")!.observed;
    for (const value of [null, [], missing, Object.create(observed),
      { ...observed, operationId: "native-only" }, { ...observed, phase: "cancelled" },
      { ...observed, checkpointReady: 1 }, { ...observed, checkpointPath: null },
      { ...observed, localLifecycle: "" }, { ...observed, remoteLifecycle: "bad\nvalue" },
      { ...observed, savedSource: "Unexpected.textpack" }, { ...observed, terminalProofValid: true },
      { ...observed, phase: "pending" }, { ...observed, phase: "stopped" },
      { ...pending, savedDestination: pending.savedSource },
      { ...stopped, savedLifecycle: null }, { ...stopped, stoppedRemoteLifecycle: "generation-b" },
      ...["../Escape.textpack", "/Root.textpack", "A//B.textpack", "C:/A.textpack", "A\\B.textpack", "A/\ud800.textpack", "A.md"].map(localPath => ({ ...observed, localPath })),
    ]) expect(() => validateMirrorSavedRenameObservation(value)).toThrow();
  });
  it("does not normalize names or carry mutable request identity in its decision", () => {
    const observed = validateMirrorSavedRenameObservation(vectors[0].observed);
    expect(mirrorSavedRename({ ...observed, localPath: "old.textpack", checkpointPath: "old.textpack" })).toEqual({ action: "stage-new" });
    const pending = validateMirrorSavedRenameObservation(vectors.find(row => row.name === "saved request replays immutably")!.observed);
    expect(mirrorSavedRename(pending)).toEqual({ action: "replay-saved" });
    expect(Object.keys(mirrorSavedRename(pending))).toEqual(["action"]);
    expect(validateMirrorSavedRenameObservation(pending)).not.toBe(pending);
  });
});
