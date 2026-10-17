import { describe, expect, it } from "vitest";
import vectors from "../../../sync/fixtures/mirror-lifecycle.json";
import { mirrorLifecycle, validateMirrorLifecycleObservation } from "./mirror-lifecycle";

describe("native mirror lifecycle", () => {
  it.each(vectors)("$name", ({observed, decision}) => {
    expect(mirrorLifecycle(validateMirrorLifecycleObservation(observed))).toEqual(decision);
  });
  it("rejects malformed observations and unfenced legacy conflicts", () => {
    const observed = vectors[0].observed;
    for (const value of [null, [], {...observed, pendingKind: "unknown"}, {...observed, pendingKind: "conflict"},
      {...observed, operationId: "must-stay-native"}, {...observed, remoteRevision: null},
      {...observed, pendingKind: null}, {...observed, remoteLifecycle: ""}, Object.create(observed)]) {
      expect(() => validateMirrorLifecycleObservation(value)).toThrow();
    }
  });
});
