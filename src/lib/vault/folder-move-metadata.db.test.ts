import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const enabled=process.env.TEXTTEXT_READING_DB_TEST==="1"&&!!process.env.DATABASE_URL;
it.skipIf(!enabled)("reserves grant metadata durably and blocks revocation until idempotent move completion",async()=>{
 if(!["localhost","127.0.0.1","[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname))throw Error("Local PostgreSQL only");
 const {db}=await import("@/lib/db/client");if(!db)throw Error("Missing database");
 const {users,blogs,vaultGrants,vaultFolderMoves,actionAudit}=await import("@/lib/db/schema");
 const {reserveFolderMove,completeFolderMoveMetadata,abortFolderMoveMetadata,previewFolderMoveMetadata}=await import("./folder-move-metadata");
 const {changeVaultGrant}=await import("./grants");
 const {vaultFolderSignature}=await import("./folder-identity");
 const {planFolderMove}=await import("@/sync/engine/folder-move-plan");
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"texttext-move-db-")),workspaceId=crypto.randomUUID(),actorUserId=crypto.randomUUID(),grantId=crypto.randomUUID();
 try{
  await db.insert(users).values({id:actorUserId,name:"Move fixture"});await db.insert(blogs).values({id:workspaceId,ownerId:actorUserId,handle:`move-${workspaceId}`,name:"Move fixture"});
  await fs.mkdir(path.join(root,workspaceId,"Projects/One/Empty"),{recursive:true});await fs.mkdir(path.join(root,workspaceId,"Archive"));
  const signature=(await vaultFolderSignature(root,workspaceId,"Projects"))!;
  await db.insert(vaultGrants).values({id:grantId,workspaceId,scopeType:"folder",scopeKey:"Projects",folderSignature:signature,invitedEmail:"reader@example.com",role:"viewer",invitedById:actorUserId});
  const tree={source:"Projects/One",destination:"Archive/One",manifestRevision:"a".repeat(64),folders:["Projects","Projects/One","Projects/One/Empty","Archive"],items:[]};
  const plan=planFolderMove({...tree,grants:[{id:grantId,path:"Projects",signature,email:"reader@example.com",role:"viewer"}]});
  const request={...tree,root,workspaceId,actorUserId,operationId:"fixture",requestHash:"b".repeat(64),expectedGrantsFingerprint:plan.grantsFingerprint};
  expect(await previewFolderMoveMetadata(request)).toEqual(plan);
  expect(await db.select().from(vaultFolderMoves).where(eq(vaultFolderMoves.workspaceId,workspaceId))).toHaveLength(0);
  await expect(previewFolderMoveMetadata({...request,actorUserId:crypto.randomUUID()})).rejects.toThrow("Only the workspace owner");
  expect(await reserveFolderMove(request)).toEqual(plan);
  await expect(changeVaultGrant({root,workspaceId,actorUserId,scope:{type:"folder",key:"Projects"},grantId,revoke:true})).rejects.toThrow("being recovered");
  expect(await reserveFolderMove(request)).toEqual(plan);
  await fs.rename(path.join(root,workspaceId,"Projects/One"),path.join(root,workspaceId,"Archive/One"));
  const completion={workspaceId,operationId:"fixture",requestHash:request.requestHash,rootSignature:(await vaultFolderSignature(root,workspaceId,"Archive/One"))!};
  await completeFolderMoveMetadata(completion);await completeFolderMoveMetadata(completion);
  const rows=await db.select().from(vaultGrants).where(eq(vaultGrants.workspaceId,workspaceId));
  expect(rows).toHaveLength(2);expect(rows.find(row=>row.scopeKey==="Archive/One")).toMatchObject({invitedEmail:"reader@example.com",userId:null,role:"viewer",folderSignature:completion.rootSignature});
  // An abort must release the sharing fence without rewriting or resurrecting
  // grants. Repeating the abort is harmless, and its operation ID stays retired.
  const nextTree={source:"Archive/One",destination:"Projects/Back",manifestRevision:"c".repeat(64),folders:["Projects","Archive","Archive/One","Archive/One/Empty"],items:[]};
  const nextGrants=rows.map(row=>({id:row.id,path:row.scopeKey,signature:row.folderSignature!,email:row.invitedEmail,role:row.role as "viewer"}));
  const nextPlan=planFolderMove({...nextTree,grants:nextGrants});
  const next={...nextTree,root,workspaceId,actorUserId,operationId:"abort-fixture",requestHash:"d".repeat(64),expectedGrantsFingerprint:nextPlan.grantsFingerprint};
  await reserveFolderMove(next);
  await abortFolderMoveMetadata({...next,requestHash:"e".repeat(64)});
  await expect(changeVaultGrant({root,workspaceId,actorUserId,scope:{type:"folder",key:"Projects"},grantId,revoke:true})).rejects.toThrow("being recovered");
  await abortFolderMoveMetadata(next);await abortFolderMoveMetadata(next);
  await expect(reserveFolderMove(next)).rejects.toThrow("cancelled");
  expect(await changeVaultGrant({root,workspaceId,actorUserId,scope:{type:"folder",key:"Projects"},grantId,revoke:true})).toBe(true);
  expect((await db.select().from(vaultGrants).where(eq(vaultGrants.workspaceId,workspaceId))).find(row=>row.scopeKey==="Archive/One")).toMatchObject({role:"viewer",revokedAt:null});
 }finally{
  await db.delete(vaultFolderMoves).where(eq(vaultFolderMoves.workspaceId,workspaceId));await db.delete(vaultGrants).where(eq(vaultGrants.workspaceId,workspaceId));await db.delete(actionAudit).where(eq(actionAudit.actorUserId,actorUserId));await db.delete(blogs).where(eq(blogs.id,workspaceId));await db.delete(users).where(eq(users.id,actorUserId));await fs.rm(root,{recursive:true,force:true});
 }
},30000);
