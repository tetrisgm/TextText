import { expect, it } from "vitest";
import { planFolderMove } from "./folder-move-plan";
const base = { source: "Projects/One", destination: "Archive/One", manifestRevision: "a".repeat(64), folders: ["Projects", "Projects/One", "Projects/One/Empty", "Archive"], items: [{ itemId: "stable", relativePath: "Projects/One/Folder view.textpack", revision: "b".repeat(64) }], grants: [] };
it("plans one subtree transition including empty directories without changing item identities or bytes", () => {
 const plan = planFolderMove(base);
 expect(plan.items).toEqual([{ ...base.items[0], destination: "Archive/One/Folder view.textpack" }]);
 expect(plan.folders).toContainEqual({ from: "Projects/One/Empty", to: "Archive/One/Empty" });
});
it("preserves inherited and nested grants and explicitly identifies destination expansion", () => {
 const plan = planFolderMove({ ...base, grants: [
  { id: "ancestor", path: "Projects", signature: "p", email: "reader@example.com", role: "viewer" },
  { id: "nested", path: "Projects/One/Empty", signature: "e", email: "editor@example.com", role: "editor" },
  { id: "destination", path: "Archive", signature: "a", email: "reader@example.com", role: "editor" },
 ] });
 expect(plan.preserveInherited[0]).toMatchObject({ id: "ancestor", destination: "Archive/One" });
 expect(plan.movedGrants[0]).toMatchObject({ id: "nested", destination: "Archive/One/Empty", signature: "e" });
 expect(plan.addedAccess).toEqual([{ email: "reader@example.com", role: "editor", via: "Archive" }]);
});
it.each(["Projects/One/Child", "projects/one", "../Escape", "Archive/.texttext", "Archive/CON"])("rejects unsafe destination %s", destination => expect(() => planFolderMove({ ...base, destination })).toThrow());
it("fences concurrent authorization edits even when file manifest is unchanged", () => {
 const grant = { id: "grant", path: "Projects", signature: "p", email: "a@example.com", role: "viewer" as const };
 expect(planFolderMove({ ...base, grants: [grant] }).grantsFingerprint).not.toBe(planFolderMove({ ...base, grants: [{ ...grant, role: "editor" }] }).grantsFingerprint);
});
