import { expect, it } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { snapshotFolderTree, verifyFolderParents, assertFolderDestinationAvailable } from "./folder-move-filesystem";
it("preserves tree fingerprint across atomic directory rename and detects direct file edits", async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"texttext-move-tree-"));
 try {
  await fs.mkdir(path.join(root,"A/Empty"),{recursive:true});await fs.writeFile(path.join(root,"A/note.textpack"),"archive");
  const before=await snapshotFolderTree(path.join(root,"A"));await fs.rename(path.join(root,"A"),path.join(root,"B"));
  expect(await snapshotFolderTree(path.join(root,"B"))).toEqual(before);
  await fs.writeFile(path.join(root,"B/note.textpack"),"changed");expect((await snapshotFolderTree(path.join(root,"B"))).hash).not.toBe(before.hash);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
it("rejects subtree and parent symlinks and case-folded collisions", async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"texttext-move-tree-"));
 try {
  await fs.mkdir(path.join(root,"Actual"));await fs.symlink(path.join(root,"Actual"),path.join(root,"Alias"));
  await expect(verifyFolderParents(root,"Alias/Child")).rejects.toThrow();
  await expect(snapshotFolderTree(root)).rejects.toThrow();
  await expect(assertFolderDestinationAvailable(path.join(root,"actual"))).rejects.toThrow("occupied");
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
