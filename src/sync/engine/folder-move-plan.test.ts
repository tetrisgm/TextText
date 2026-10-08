import { expect, it } from "vitest";
import { folderMovePlanHash, planFolderMove, reviewedFolderMoveManifest } from "./folder-move-plan";
const base = { source: "Projects/One", destination: "Archive/One", manifestRevision: "a".repeat(64), folders: ["Projects", "Projects/One", "Projects/One/Empty", "Archive"], items: [{ itemId: "stable", relativePath: "Projects/One/Folder view.textpack", revision: "b".repeat(64) }], grants: [] };
it("permits changed contents and unrelated files but fences changed move membership", () => {
 const plan=planFolderMove(base);
 const current={folders:[...base.folders,"Other"],items:[{...base.items[0],revision:"c".repeat(64)},{itemId:"other",relativePath:"Other/Note.textpack",revision:"d".repeat(64)}],revision:"e".repeat(64)};
 expect(reviewedFolderMoveManifest(plan,current).items[0].revision).toBe(base.items[0].revision);
 expect(()=>reviewedFolderMoveManifest(plan,{...current,items:current.items.filter(item=>item.itemId!=="stable")})).toThrow("Workspace changed");
 expect(()=>reviewedFolderMoveManifest(plan,{...current,folders:[...current.folders,"Projects/One/New"]})).toThrow("Workspace changed");
 expect(()=>reviewedFolderMoveManifest(plan,{...current,folders:[...current.folders,"Archive/One"]})).toThrow("occupied");
 expect(()=>reviewedFolderMoveManifest(plan,{...current,items:[{...base.items[0],itemId:"replacement"}]})).toThrow("Workspace changed");
});
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
it("binds all reviewed changes while accepting JSONB key order and grant input order", () => {
 const grants = [{id:"z",path:"Archive",signature:"a",email:"reader@example.com",role:"editor" as const},{id:"a",path:"Projects",signature:"p",email:"reader@example.com",role:"viewer" as const}];
 const plan = planFolderMove({...base,grants});
 const digest = folderMovePlanHash(plan);
 expect(folderMovePlanHash(planFolderMove({...base,grants:[...grants].reverse()}))).toBe(digest);
 expect(folderMovePlanHash(Object.fromEntries(Object.entries(plan).reverse()) as typeof plan)).toBe(digest);
 for (const changed of [{...plan,items:[]},{...plan,folders:[]},{...plan,addedAccess:[]},{...plan,preserveInherited:[]},{...plan,destination:"Elsewhere"}]) {
  expect(folderMovePlanHash(changed)).not.toBe(digest);
 }
});
