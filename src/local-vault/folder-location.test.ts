import { expect, it } from "vitest";
import type { VaultListing } from "./bridge";
import { reconcileFolderLocation } from "./folder-location";
const before: VaultListing = { root: "one", folders: ["Parent/Notes", "Other"], fullAccess: true,
  items: [{ itemId: "a", path: "Parent/Notes/A.textpack" }, { itemId: "b", path: "Parent/Notes/Child/B.textpack" }] };
const moved: VaultListing = { ...before, folders: ["Archive/Notes", "Parent"],
  items: [{ itemId: "a", path: "Archive/Notes/A.textpack" }, { itemId: "b", path: "Archive/Notes/Child/B.textpack" }] };
it("follows a folder move using all stable descendant identities", () => {
  expect(reconcileFolderLocation("Parent/Notes", before, moved)).toBe("Archive/Notes");
  expect(reconcileFolderLocation("Parent/Notes/Child", before, moved)).toBe("Archive/Notes/Child");
});
it("keeps surviving folders even when some files move", () => {
  expect(reconcileFolderLocation("Parent/Notes", before, { ...moved, folders: ["Parent/Notes"] })).toBe("Parent/Notes");
});
it.each([
  { ...moved, items: [moved.items[0]] },
  { ...moved, items: [...moved.items, moved.items[0]] },
  { ...moved, items: [moved.items[0], { itemId: "b", path: "Elsewhere/Child/B.textpack" }] },
])("uses the surviving ancestor when relocation evidence is incomplete or ambiguous", after => {
  expect(reconcileFolderLocation("Parent/Notes", before, after)).toBe("Parent");
});
it("uses home for a removed empty folder", () => {
  expect(reconcileFolderLocation("Other", before, moved)).toBe("");
});
it.each([{ ...moved, root: "two" }, { ...moved, fullAccess: false }, { ...moved, folders: undefined }])("does not infer moves from another workspace or incomplete catalog", after => {
  expect(reconcileFolderLocation("Parent/Notes", before, after)).toBe("Parent/Notes");
});
