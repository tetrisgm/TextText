import { describe, expect, it } from "vitest";
import {
  emptyDocumentSnapshot,
  requireDocumentSnapshot,
} from "@/lib/documents/model";

describe("requireDocumentSnapshot", () => {
  it("accepts a canonical schema-v1 snapshot", () => {
    const document = emptyDocumentSnapshot();
    expect(requireDocumentSnapshot(document)).toEqual(document);
  });

  it("rejects missing persisted content instead of synthesizing it", () => {
    expect(() =>
      requireDocumentSnapshot(undefined, "Persisted item item-1"),
    ).toThrow("Persisted item item-1 is missing its canonical document");
  });

  it("rejects unknown document schema versions", () => {
    expect(() =>
      requireDocumentSnapshot({
        ...emptyDocumentSnapshot(),
        schemaVersion: 2,
      }),
    ).toThrow();
  });
});
