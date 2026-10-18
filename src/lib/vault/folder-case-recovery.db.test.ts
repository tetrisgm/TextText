import{expect,it}from"vitest";import{eq}from"drizzle-orm";import*as fs from"node:fs/promises";import os from"node:os";import path from"node:path";
const enabled=process.env.TEXTTEXT_READING_DB_TEST==="1"&&!!process.env.DATABASE_URL;
it.skipIf(!enabled)("owner cancellation preserves files, audits once and refuses reserved/applied metadata",async()=>{
 if(!["localhost","127.0.0.1","[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname))throw Error("Local PostgreSQL only");
 const{db}=await import("@/lib/db/client");if(!db)throw Error("Missing database");
 const{users,blogs,vaultFolderMoves,actionAudit}=await import("@/lib/db/schema");
 const{moveVaultFolderCase,recoverVaultFolderCase,listVaultTextpacks}=await import("@/lib/store");
 const{verifyFolderCaseUncommitted}=await import("./folder-move-metadata");
 const{folderCaseRequestHash}=await import("@/sync/engine/store");
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"texttext-case-cancel-db-")),workspaceId=crypto.randomUUID(),actorUserId=crypto.randomUUID();
 try{
  await db.insert(users).values({id:actorUserId,name:"Case recovery fixture"});await db.insert(blogs).values({id:workspaceId,ownerId:actorUserId,handle:`case-recovery-${workspaceId}`,name:"Case recovery fixture"});
  await fs.mkdir(path.join(root,workspaceId,"Parent/Case/Empty"),{recursive:true});
  const before=await listVaultTextpacks({root,workspaceId});const command={root,workspaceId,actorUserId,operationId:"cancel-case",source:"Parent/Case",destination:"Parent/CASE",baseManifestRevision:before.revision,folders:before.folders.filter(row=>row.startsWith("Parent/Case")),items:[]};
  await expect(recoverVaultFolderCase({...command,actorUserId:crypto.randomUUID(),action:"inspect"})).rejects.toThrow("owner");
  const review=await recoverVaultFolderCase({...command,action:"inspect"});if(review.state!=="review")throw Error("review missing");
  expect(await db.select().from(actionAudit).where(eq(actionAudit.actorUserId,actorUserId))).toHaveLength(0);
  const cancelled=await recoverVaultFolderCase({...command,action:"cancel",inspection:review.inspection});expect(cancelled.state).toBe("cancelled");
  expect(await recoverVaultFolderCase({...command,action:"inspect"})).toEqual(cancelled);
  await expect(moveVaultFolderCase(command)).rejects.toThrow("cancelled");
  expect((await listVaultTextpacks({root,workspaceId})).revision).toBe(before.revision);
  const audits=await db.select().from(actionAudit).where(eq(actionAudit.actorUserId,actorUserId));expect(audits).toHaveLength(1);expect(audits[0].actionName).toBe("vault.folder.case.cancel");
  const metadata={workspaceId,actorUserId,operationId:"reserved-case",requestHash:folderCaseRequestHash(command)};
  await db.insert(vaultFolderMoves).values({...metadata,plan:{},status:"reserved"});
  await expect(verifyFolderCaseUncommitted(metadata)).rejects.toThrow("finish recovery");
  await db.update(vaultFolderMoves).set({status:"applied"}).where(eq(vaultFolderMoves.operationId,metadata.operationId));await expect(verifyFolderCaseUncommitted(metadata)).rejects.toThrow("finish recovery");
  await db.update(vaultFolderMoves).set({status:"aborted"}).where(eq(vaultFolderMoves.operationId,metadata.operationId));await expect(verifyFolderCaseUncommitted(metadata)).resolves.toBeUndefined();
  await expect(verifyFolderCaseUncommitted({...metadata,requestHash:"a".repeat(64)})).rejects.toThrow("finish recovery");
 }finally{await db.delete(vaultFolderMoves).where(eq(vaultFolderMoves.workspaceId,workspaceId));await db.delete(actionAudit).where(eq(actionAudit.actorUserId,actorUserId));await db.delete(blogs).where(eq(blogs.id,workspaceId));await db.delete(users).where(eq(users.id,actorUserId));await fs.rm(root,{recursive:true,force:true});}
},30000);
