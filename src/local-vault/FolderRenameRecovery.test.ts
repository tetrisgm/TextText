import { describe, expect, it } from "vitest";
import { validateFolderRenameRecovery } from "./FolderRenameRecovery";
const entry = { id: "operation", fromPath: "Notes", toPath: "notes", expectedIdentity: "original",
  from: { present: false, identity: null }, to: { present: true, identity: "foreign" }, inspection: "a".repeat(64),
  summary: "2 entries", resolutionBlocked: null, resolved: false };
describe("folder metadata recovery contract", () => {
  it("accepts explicit absence, foreign directories and read-only resolved records", () => {
    expect(validateFolderRenameRecovery(entry)).toEqual(entry);
    expect(validateFolderRenameRecovery({ ...entry, to: { present: true, identity: null }, resolutionBlocked: "This path cannot be verified." })).toMatchObject({ resolutionBlocked: "This path cannot be verified." });
    expect(validateFolderRenameRecovery({ ...entry, from: { present: true, identity: "original" }, resolved: true })).toMatchObject({ resolved: true });
  });
  it("refuses incomplete, future, ambiguous or unsafe metadata", () => {
    for (const value of [null, [], {}, { ...entry, future: true }, { ...entry, expectedIdentity: "" }, { ...entry, inspection: "bad" },
      { ...entry, inspection: entry.inspection + "\n" }, { ...entry, fromPath: "../Notes" }, { ...entry, toPath: "/notes" },
      { ...entry, toPath: "Notes" }, { ...entry, from: { present: false, identity: "original" } }, { ...entry, to: { present: true, identity: null } },
      { ...entry, to: { present: true, identity: "foreign", future: 1 } }, { ...entry, summary: "x".repeat(65_537) },
      { ...entry, resolutionBlocked: 1 }, { ...entry, resolved: "yes" }]) expect(() => validateFolderRenameRecovery(value)).toThrow();
  });
});
