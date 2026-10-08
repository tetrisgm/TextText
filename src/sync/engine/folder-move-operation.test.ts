import { expect,it } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { applyFolderMoveIntent, type FolderMoveIntent } from "./folder-move-operation";
import { snapshotFolderTree } from "./folder-move-filesystem";
import { planFolderMove } from "./folder-move-plan";
it("recovers a lost metadata acknowledgement after one atomic subtree publication",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"texttext-folder-op-"));
 try{
  await fs.mkdir(path.join(root,"Source/Empty"),{recursive:true});await fs.mkdir(path.join(root,"pending"));await fs.writeFile(path.join(root,"Source/Note.textpack"),"unchanged");
  const plan=planFolderMove({source:"Source",destination:"Moved",folders:["Source","Source/Empty"],items:[],grants:[],manifestRevision:"a".repeat(64)});
  const intent:FolderMoveIntent={kind:"move_folder",workspaceId:"workspace",operationId:"operation",requestHash:"b".repeat(64),actorUserId:"actor",actorType:"human",treeIdentity:(await snapshotFolderTree(path.join(root,"Source"))).entries[0].identity,plan,manifest:{folders:plan.folders.map(folder=>folder.from),items:[]},treeHash:(await snapshotFolderTree(path.join(root,"Source"))).hash};
  const phases:string[]=[];let fail=true,finish=0;
  const context={workspace:root,pendingDirectory:path.join(root,"pending"),sync:async()=>{},metadata:async(_:FolderMoveIntent,phase:"reserve"|"complete"|"abort")=>{phases.push(phase);if(phase==="complete"&&fail){fail=false;throw Error("Lost database acknowledgement");}},finish:async()=>{finish++;}};
  await expect(applyFolderMoveIntent(intent,context)).rejects.toThrow("Lost database");
  expect(await fs.readFile(path.join(root,"Moved/Note.textpack"),"utf8")).toBe("unchanged");
  await applyFolderMoveIntent(intent,context);
  expect(phases).toEqual(["reserve","complete","reserve","complete"]);expect(finish).toBe(1);
  expect((await fs.stat(path.join(root,"Moved/Empty"))).isDirectory()).toBe(true);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
it("refuses external changes after metadata reservation without moving or overwriting",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"texttext-folder-op-"));
 try{
  await fs.mkdir(path.join(root,"Source"));await fs.mkdir(path.join(root,"pending"));await fs.writeFile(path.join(root,"Source/note"),"old");
  const plan=planFolderMove({source:"Source",destination:"Moved",folders:["Source"],items:[],grants:[],manifestRevision:"a".repeat(64)});
  const intent:FolderMoveIntent={kind:"move_folder",workspaceId:"workspace",operationId:"operation",requestHash:"b".repeat(64),actorUserId:"actor",actorType:"human",treeIdentity:(await snapshotFolderTree(path.join(root,"Source"))).entries[0].identity,plan,manifest:{folders:plan.folders.map(folder=>folder.from),items:[]},treeHash:(await snapshotFolderTree(path.join(root,"Source"))).hash};
  const phases:string[]=[];
  await expect(applyFolderMoveIntent(intent,{workspace:root,pendingDirectory:path.join(root,"pending"),sync:async()=>{},metadata:async(_,phase)=>{phases.push(phase);if(phase==="reserve")await fs.writeFile(path.join(root,"Source/note"),"new");},finish:async()=>{throw Error("Must not finish");}})).rejects.toThrow("changed");
  expect(phases).toEqual(["reserve","abort"]);expect(await fs.readFile(path.join(root,"Source/note"),"utf8")).toBe("new");
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
