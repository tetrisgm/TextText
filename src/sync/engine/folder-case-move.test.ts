import {expect,it} from "vitest";
import * as fs from "node:fs/promises";import os from "node:os";import path from "node:path";
import {emptyDocumentSnapshot} from "@/lib/documents/model";import{buildTextpack}from"@/lib/github/textpack";
import{ensureVaultFolders,writeVaultTextpack,listVaultTextpacks,moveVaultFolderCase,recoverVaultFolderCase,readVaultTextpack,type VaultMutationReceipt}from"./store";
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

it("inspects and durably cancels only the exact uncommitted command, retaining files and fencing late replay",async()=>{const f=await fixture();try{
 const cancellationAudits:unknown[]=[];const input={...f.request,action:"inspect" as const,verifyUncommitted:async()=>{},auditCancellation:async(row:unknown)=>{cancellationAudits.push(row);}};
 const before=await listVaultTextpacks(f.context);const review=await recoverVaultFolderCase(input);expect(review.state).toBe("review");if(review.state!=="review")throw Error("review missing");
 expect(review.folders).toEqual(before.folders);expect(review.requestHash).toMatch(/^[a-f0-9]{64}$/);expect(cancellationAudits).toHaveLength(0);
 const cancelled=await recoverVaultFolderCase({...input,action:"cancel",inspection:review.inspection});expect(cancelled.state).toBe("cancelled");
 expect(await recoverVaultFolderCase(input)).toEqual(cancelled);expect(cancellationAudits).toHaveLength(2);
 await expect(moveVaultFolderCase(f.request)).rejects.toThrow("cancelled");
 await expect(recoverVaultFolderCase({...input,destination:"Parent/case"})).rejects.toThrow("reused");
 expect((await listVaultTextpacks(f.context)).revision).toBe(before.revision);expect(Buffer.from((await readVaultTextpack({...f.context,itemId:"case-one"}))!.bytes)).toEqual(Buffer.from(f.bytes));
}finally{await fs.rm(f.root,{recursive:true,force:true});}});
it("refuses stale cancellation consent, unresolved metadata and revoked owners without cancelling",async()=>{const f=await fixture();try{
 const input={...f.request,action:"inspect" as const,verifyUncommitted:async()=>{},auditCancellation:async()=>{}};
 const review=await recoverVaultFolderCase(input);if(review.state!=="review")throw Error("review missing");
 await ensureVaultFolders(f.context,["Later empty folder"]);
 await expect(recoverVaultFolderCase({...input,action:"cancel",inspection:review.inspection})).rejects.toThrow("inspection changed");
 await expect(recoverVaultFolderCase({...input,verifyUncommitted:async()=>{throw Error("reserved metadata");}})).rejects.toThrow("reserved metadata");
 await expect(recoverVaultFolderCase({...input,authorize:async()=>{throw Error("Revoked");}})).rejects.toThrow("Revoked");
 expect(await fs.readdir(path.join(f.root,"workspace/.texttext/receipts"))).not.toContain("case-command.json");
 const current=await listVaultTextpacks(f.context);const result=await moveVaultFolderCase({...f.request,baseManifestRevision:current.revision});expect(result.status).toBe("moved");
}finally{await fs.rm(f.root,{recursive:true,force:true});}});
it("returns completed receipt rather than cancellation after committed response loss",async()=>{const f=await fixture();try{
 f.fail("audit");await expect(moveVaultFolderCase(f.request)).rejects.toThrow("Lost acknowledgement");
 const result=await recoverVaultFolderCase({...f.request,action:"cancel",inspection:"a".repeat(64),verifyUncommitted:async()=>{throw Error("must not inspect committed metadata");},auditCancellation:async()=>{throw Error("must not cancel completed move");}});
 expect(result.state).toBe("completed");if(result.state!=="completed")throw Error("receipt missing");expect(result.result).toEqual(await moveVaultFolderCase(f.request));
}finally{await fs.rm(f.root,{recursive:true,force:true});}});
it("keeps a cancellation tombstone after audit outage and replays its audit without moving",async()=>{const f=await fixture();try{
 let fail=true;const input={...f.request,action:"inspect" as const,verifyUncommitted:async()=>{},auditCancellation:async()=>{if(fail){fail=false;throw Error("Cancellation audit unavailable");}}};
 const review=await recoverVaultFolderCase(input);if(review.state!=="review")throw Error("review missing");
 await expect(recoverVaultFolderCase({...input,action:"cancel",inspection:review.inspection})).rejects.toThrow("audit unavailable");
 await expect(moveVaultFolderCase(f.request)).rejects.toThrow("cancelled");expect((await recoverVaultFolderCase(input)).state).toBe("cancelled");
 expect((await listVaultTextpacks(f.context)).folders).toContain("Parent/Case/Empty child");
}finally{await fs.rm(f.root,{recursive:true,force:true});}});

it("never cancels a staged move while metadata recovery remains unavailable",async()=>{const f=await fixture();try{
 f.fail("complete");await expect(moveVaultFolderCase(f.request)).rejects.toThrow("Metadata unavailable");
 const input={...f.request,action:"cancel" as const,inspection:"a".repeat(64),verifyUncommitted:async()=>{throw Error("must not bypass retained intent");},auditCancellation:async()=>{throw Error("must not cancel retained intent");}};
 f.fail("complete");await expect(recoverVaultFolderCase(input)).rejects.toThrow("Metadata unavailable");
 expect((await recoverVaultFolderCase(input)).state).toBe("completed");expect((await moveVaultFolderCase(f.request)).status).toBe("moved");
}finally{await fs.rm(f.root,{recursive:true,force:true});}});
