import { buildTemplateRetirement } from "@/lib/presentation/vault-template-retirement";
import { afterEach, beforeEach, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { writeVaultTextpack, retireVaultTemplate, readVaultTextpack, deleteVaultTextpack, createVaultTemplate } from "@/sync/engine/store";
const sourceId="78c56737-2b69-4b8f-8db4-a0c9d6e728c3";
const template={...requireBuiltinTemplate("texttext.note"),id:"local.retirement",name:"Research"};
let root:string, sourceHash:string;
const location=()=>({root,workspaceId:"workspace",onReceipt:async()=>{}});
const request=()=>({...location(),templateId:template.id,sourceItemId:sourceId,sourceHash,operationId:"retire-one",audit:{actorUserId:"actor",actorType:"external_agent" as const},beforeCommit:async()=>{},beforeSourceRead:async()=>{}});
beforeEach(async()=>{
 root=await fs.mkdtemp(path.join(os.tmpdir(),"retirement-"));
 const document=emptyDocumentSnapshot({id:template.id,version:template.version});
 const saved=await writeVaultTextpack({...location(),itemId:sourceId,operationId:"source",relativePath:"Templates/Research.textpack",baseRevision:null,bytes:buildTextpack("Template",{document,template,markdown:`---\ntextTextId: ${sourceId}\n---\n`})});
 sourceHash=saved.revision!;
});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});
it("persists retirement exactly once, rechecks access on replay and binds complete request",async()=>{
 const first=await retireVaultTemplate(request());expect(first.status).toBe("written");
 expect(await retireVaultTemplate(request())).toEqual(first);
 await expect(retireVaultTemplate({...request(),beforeCommit:async()=>{throw new Error("revoked");}})).rejects.toThrow("revoked");
 await expect(retireVaultTemplate({...request(),sourceHash:"b".repeat(64)})).rejects.toThrow("reused");
});
it("rejects stale source and concurrent second retirement without duplicate identity markers",async()=>{
 await expect(retireVaultTemplate({...request(),sourceHash:"b".repeat(64)})).rejects.toThrow("changed");
 const results=await Promise.allSettled([retireVaultTemplate(request()),retireVaultTemplate({...request(),operationId:"retire-two"})]);
 expect(results.filter(row=>row.status==="fulfilled")).toHaveLength(1);
 expect(results.filter(row=>row.status==="rejected")).toHaveLength(1);
});
it("replays lost audit acknowledgment without repeating mutation",async()=>{
 let fail=true;
 const input={...request(),onReceipt:async()=>{if(fail){fail=false;throw new Error("lost acknowledgment");}}};
 await expect(retireVaultTemplate(input)).rejects.toThrow("lost acknowledgment");
 const receipt=await retireVaultTemplate(input);expect(receipt.status).toBe("written");
 expect(await retireVaultTemplate({...input,receiptOnly:true})).toEqual(receipt);
});
it("explicit marker deletion restores availability and replay never recreates retirement",async()=>{
 const retired=await retireVaultTemplate(request());if(retired.status!=="written")throw new Error("retirement failed");
 await deleteVaultTextpack({...location(),itemId:retired.itemId,operationId:"delete-marker",basePath:retired.relativePath,baseRevision:retired.revision});
 expect(await retireVaultTemplate(request())).toEqual(retired);
 expect(await readVaultTextpack({...location(),itemId:retired.itemId})).toBeNull();
 const next=await retireVaultTemplate({...request(),operationId:"retire-again"});expect(next.status).toBe("written");expect(next.itemId).not.toBe(retired.itemId);
});
it("blocks new versions after retirement while explicit remix creates a fresh identity",async()=>{
 await retireVaultTemplate(request());
 const common={...location(),itemId:"00c56737-2b69-4b8f-8db4-a0c9d6e728c3",operationId:"new-version",audit:request().audit,beforeCommit:async()=>{},beforeSourceRead:async()=>{}};
 await expect(createVaultTemplate({...common,creation:{sourceItemId:sourceId,sourceHash,update:{templateId:template.id,baseVersion:1,definition:template}}})).rejects.toThrow("retired");
 expect((await createVaultTemplate({...common,operationId:"remix",creation:{sourceItemId:sourceId,sourceHash,remix:{templateId:template.id,templateVersion:1,name:"New identity"}}})).status).toBe("written");
 expect((await readVaultTextpack({...location(),itemId:sourceId}))?.revision).toBe(sourceHash);
});

it("honors direct file marker creation and removal without a preceding manifest request",async()=>{
 const record=buildTemplateRetirement({format:"texttext-template-retirement",version:1,templateId:template.id,sourceItemId:sourceId,sourceHash,sourceVersion:1},"Research","direct-file");
 const target=path.join(root,"workspace",record.relativePath);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,record.bytes);
 const input={...location(),itemId:"00c56737-2b69-4b8f-8db4-a0c9d6e728c3",operationId:"new-version",audit:request().audit,beforeCommit:async()=>{},beforeSourceRead:async()=>{},creation:{sourceItemId:sourceId,sourceHash,update:{templateId:template.id,baseVersion:1,definition:template}}};
 await expect(createVaultTemplate(input)).rejects.toThrow("retired");
 await fs.unlink(target);
 expect((await createVaultTemplate(input)).status).toBe("written");
});

it("treats noncanonical directory casing consistently with client discovery",async()=>{
 const record=buildTemplateRetirement({format:"texttext-template-retirement",version:1,templateId:template.id,sourceItemId:sourceId,sourceHash,sourceVersion:1},"Research","case-variant");
 const target=path.join(root,"workspace",record.relativePath.replace("/Retired/","/retired/"));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,record.bytes);
 expect((await createVaultTemplate({...location(),itemId:"00c56737-2b69-4b8f-8db4-a0c9d6e728c3",operationId:"new-version",audit:request().audit,beforeCommit:async()=>{},beforeSourceRead:async()=>{},creation:{sourceItemId:sourceId,sourceHash,update:{templateId:template.id,baseVersion:1,definition:template}}})).status).toBe("written");
});
