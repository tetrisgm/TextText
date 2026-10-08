import {expect,it} from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {buildTextpack} from "@/lib/github/textpack";
import {emptyDocumentSnapshot} from "@/lib/documents/model";
import {ensureVaultFolders,writeVaultTextpack,listVaultTextpacks,readVaultTextpack,moveVaultFolder,type VaultMutationReceipt} from "./store";
import {planFolderMove} from "./folder-move-plan";
it("recovers one subtree move with stable pack identity/default bytes, empty folders and audited replay",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"texttext-folder-engine-"));
 try{
  const audit=new Map<string,VaultMutationReceipt>();let lose=true;
  const context={root,workspaceId:"workspace",onReceipt:async(receipt:VaultMutationReceipt)=>{audit.set(receipt.operationId,receipt);},onFolderMove:async(_:unknown,phase:string)=>{if(phase==="complete"&&lose){lose=false;throw Error("Database unavailable");}}};
  await ensureVaultFolders(context,["Source/Empty","Archive"]);
  const document=emptyDocumentSnapshot();document.content.title="Folder view";document.content.body="Keep exact bytes";
  const bytes=buildTextpack("Note",{document,markdown:'---\ntextTextId: item-1\n---\nKeep exact bytes'});
  await writeVaultTextpack({...context,itemId:"item-1",operationId:"seed",relativePath:"Source/Folder view.textpack",baseRevision:null,bytes});
  const before=await listVaultTextpacks(context);const plan=planFolderMove({...before,manifestRevision:before.revision,source:"Source",destination:"Archive/Moved",grants:[]});
  const request={...context,operationId:"move",plan,actorUserId:"actor",actorType:"human" as const,authorize:async()=>{}};
  await expect(moveVaultFolder(request)).rejects.toThrow("Database unavailable");
  const after=await listVaultTextpacks(context);
  expect(after.folders).toContain("Archive/Moved/Empty");expect(after.folders).not.toContain("Source");
  const item=await readVaultTextpack({...context,itemId:"item-1"});expect(item?.relativePath).toBe("Archive/Moved/Folder view.textpack");expect(Buffer.from(item!.bytes)).toEqual(Buffer.from(bytes));
  expect(await moveVaultFolder(request)).toEqual({status:"folder_moved",relativePath:"Archive/Moved"});expect(audit.size).toBe(1);
  const reordered=Object.fromEntries(Object.entries(plan).reverse()) as typeof plan;
  expect(await moveVaultFolder({...request,plan:reordered})).toEqual({status:"folder_moved",relativePath:"Archive/Moved"});expect(audit.size).toBe(1);
  await expect(moveVaultFolder({...request,plan:{...plan,items:[]}})).rejects.toThrow("Operation id was reused");
  await expect(moveVaultFolder({...request,authorize:async()=>{throw Error("Revoked");}})).rejects.toThrow("Revoked");
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
it("rejects stale manifest and drops a pre-publication failed intent without blocking later reads",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"texttext-folder-engine-"));
 try{
  const context={root,workspaceId:"workspace",onReceipt:async()=>{},onFolderMove:async(_:unknown,phase:string)=>{if(phase==="reserve")throw Error("Grant changed");}};
  await ensureVaultFolders(context,["Source"]);const manifest=await listVaultTextpacks(context);const plan=planFolderMove({...manifest,manifestRevision:manifest.revision,source:"Source",destination:"Moved",grants:[]});
  const request={...context,operationId:"move",plan,actorUserId:"actor",actorType:"human" as const,authorize:async()=>{}};
  await expect(moveVaultFolder({...request,plan:{...plan,manifestRevision:"0".repeat(64)}})).rejects.toThrow("Workspace changed");
  await expect(moveVaultFolder(request)).rejects.toThrow("Grant changed");
  expect((await listVaultTextpacks(context)).folders).toEqual(["Source"]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
