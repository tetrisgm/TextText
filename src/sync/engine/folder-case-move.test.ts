import {expect,it} from "vitest";
import * as fs from "node:fs/promises";import os from "node:os";import path from "node:path";
import {emptyDocumentSnapshot} from "@/lib/documents/model";import{buildTextpack}from"@/lib/github/textpack";
import{ensureVaultFolders,writeVaultTextpack,listVaultTextpacks,moveVaultFolderCase,readVaultTextpack,type VaultMutationReceipt}from"./store";
import{planFolderMove}from"./folder-move-plan";
async function fixture(){const root=await fs.mkdtemp(path.join(process.env.TEXTTEXT_PROPAGATION_ROOT??os.tmpdir(),"texttext-case-tree-"));const audits=new Map<string,VaultMutationReceipt>();let failure="";
 const context={root,workspaceId:"workspace",onReceipt:async (row:VaultMutationReceipt)=>{audits.set(row.operationId,row);if(failure==="audit"){failure="";throw Error("Lost acknowledgement");}},onFolderMove:async(_:unknown,phase:string)=>{if(failure===phase){failure="";throw Error("Metadata unavailable");}}};
 await ensureVaultFolders(context,["Parent/Case/Empty child"]);const document=emptyDocumentSnapshot();document.content.body="Exact original";const bytes=buildTextpack("One",{document,markdown:'---\ntextTextId: case-one\n---\nExact original',files:{"assets/exact.bin":new Uint8Array([0,255,21])}});
 await writeVaultTextpack({...context,itemId:"case-one",operationId:"seed",relativePath:"Parent/Case/one.textpack",baseRevision:null,bytes});const manifest=await listVaultTextpacks(context);
 const request={...context,operationId:"case-command",source:"Parent/Case",destination:"Parent/CASE",baseManifestRevision:manifest.revision,folders:manifest.folders.filter(value=>value.startsWith("Parent/Case")),items:manifest.items.map(({itemId,relativePath,revision})=>({itemId,relativePath,revision})),actorUserId:"owner",authorize:async()=>{},preparePlan:async (current:Pick<Awaited<ReturnType<typeof listVaultTextpacks>>,"folders"|"items"|"revision">)=>planFolderMove({...current,manifestRevision:current.revision,source:"Parent/Case",destination:"Parent/CASE",caseOnly:true,grants:[]})};return{root,context,request,bytes,audits,fail:(phase:string)=>failure=phase};}
it("moves actual complete subtree once, replays exact receipt after lost ACK and fences changed commands/owner",async()=>{const f=await fixture();try{
 f.fail("audit");await expect(moveVaultFolderCase(f.request)).rejects.toThrow("Lost acknowledgement");
 const result=await moveVaultFolderCase(f.request);expect(result).toMatchObject({status:"moved",source:"Parent/Case",destination:"Parent/CASE",folders:["Parent/CASE","Parent/CASE/Empty child"],items:[{itemId:"case-one",relativePath:"Parent/CASE/one.textpack",revision:f.request.items[0].revision}]});
 expect(result.manifestRevision).toMatch(/^[a-f0-9]{64}$/);expect((await listVaultTextpacks(f.context)).folders).toEqual(["Parent","Parent/CASE","Parent/CASE/Empty child"]);
 expect(Buffer.from((await readVaultTextpack({...f.context,itemId:"case-one"}))!.bytes)).toEqual(Buffer.from(f.bytes));expect(f.audits.size).toBe(1);
 expect(await moveVaultFolderCase(f.request)).toEqual(result);
 await expect(moveVaultFolderCase({...f.request,items:[]})).rejects.toThrow("Operation id was reused");
 await expect(moveVaultFolderCase({...f.request,authorize:async()=>{throw Error("Revoked");}})).rejects.toThrow("Revoked");
}finally{await fs.rm(f.root,{recursive:true,force:true});}});
it("refuses missing empty descendants, changed revision, changed manifest and distinct folded peers without moving files",async()=>{const f=await fixture();try{
 await expect(moveVaultFolderCase({...f.request,folders:["Parent/Case"]})).rejects.toThrow("topology");
 await expect(moveVaultFolderCase({...f.request,items:f.request.items.map(row=>({...row,revision:"b".repeat(64)}))})).rejects.toThrow("topology");
 await expect(moveVaultFolderCase({...f.request,baseManifestRevision:"a".repeat(64)})).rejects.toThrow("manifest changed");
 await expect(moveVaultFolderCase({...f.request,preparePlan:async (current:Pick<Awaited<ReturnType<typeof listVaultTextpacks>>,"folders"|"items"|"revision">)=>planFolderMove({...current,manifestRevision:current.revision,source:f.request.source,destination:"Other/CASE",caseOnly:true,grants:[]})})).rejects.toThrow("same-parent");
 await fs.mkdir(path.join(f.root,"workspace/Parent/case")).catch(error=>{if(error.code!=="EEXIST")throw error;});const entries=await fs.readdir(path.join(f.root,"workspace/Parent"));
 if(entries.includes("case")){const current=await listVaultTextpacks(f.context);await expect(moveVaultFolderCase({...f.request,baseManifestRevision:current.revision})).rejects.toThrow("occupied");}
 expect(Buffer.from((await readVaultTextpack({...f.context,itemId:"case-one"}))!.bytes)).toEqual(Buffer.from(f.bytes));expect(f.audits.size).toBe(0);
}finally{await fs.rm(f.root,{recursive:true,force:true});}});
it("recovers a staged tree after metadata outage before receipt without duplicate aliases",async()=>{const f=await fixture();try{f.fail("complete");await expect(moveVaultFolderCase(f.request)).rejects.toThrow("Metadata unavailable");const result=await moveVaultFolderCase(f.request);expect(result.status).toBe("moved");expect((await listVaultTextpacks(f.context)).folders).toEqual(["Parent","Parent/CASE","Parent/CASE/Empty child"]);expect(f.audits.size).toBe(1);}finally{await fs.rm(f.root,{recursive:true,force:true});}});
