import{expect,it}from"vitest";import{eq}from"drizzle-orm";import*as fs from"node:fs/promises";import os from"node:os";import path from"node:path";
const enabled=process.env.TEXTTEXT_READING_DB_TEST==="1"&&!!process.env.DATABASE_URL;
it.skipIf(!enabled)("owner automatic case move preserves inherited access and rebases descendant grants with one durable audit",async()=>{
 if(!["localhost","127.0.0.1","[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname))throw Error("Local PostgreSQL only");
 const{db}=await import("@/lib/db/client");if(!db)throw Error("Missing database");const{users,blogs,vaultGrants,vaultFolderMoves,actionAudit}=await import("@/lib/db/schema");const{moveVaultFolderCase,listVaultTextpacks}=await import("@/lib/store");const{vaultFolderSignature}=await import("./folder-identity");const{previewFolderMoveMetadata}=await import("./folder-move-metadata");
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"texttext-case-access-"));const workspaceId=crypto.randomUUID(),actorUserId=crypto.randomUUID(),inherited=crypto.randomUUID(),descendant=crypto.randomUUID();
 try{
 await db.insert(users).values({id:actorUserId,name:"Case access fixture"});await db.insert(blogs).values({id:workspaceId,ownerId:actorUserId,handle:`case-${workspaceId}`,name:"Case fixture"});await fs.mkdir(path.join(root,workspaceId,"Parent/Case/Empty child"),{recursive:true});
 const parentSignature=(await vaultFolderSignature(root,workspaceId,"Parent"))!;const childSignature=(await vaultFolderSignature(root,workspaceId,"Parent/Case/Empty child"))!;
 await db.insert(vaultGrants).values([{id:inherited,workspaceId,scopeType:"folder",scopeKey:"Parent",folderSignature:parentSignature,invitedEmail:"parent@example.test",role:"viewer",invitedById:actorUserId},{id:descendant,workspaceId,scopeType:"folder",scopeKey:"Parent/Case/Empty child",folderSignature:childSignature,invitedEmail:"child@example.test",role:"editor",invitedById:actorUserId}]);
 const before=await listVaultTextpacks({root,workspaceId});const command={root,workspaceId,actorUserId,operationId:"case-access",source:"Parent/Case",destination:"Parent/CASE",baseManifestRevision:before.revision,folders:before.folders.filter(folder=>folder.startsWith("Parent/Case")),items:[]};
 const plan=await previewFolderMoveMetadata({...command,manifestRevision:before.revision,folders:before.folders,caseOnly:true});expect(plan.preserveInherited).toEqual([]);expect(plan.addedAccess).toEqual([]);
 await expect(moveVaultFolderCase({...command,actorUserId:crypto.randomUUID()})).rejects.toThrow("owner");
 let authorityChecks=0;
 await expect(moveVaultFolderCase({...command,operationId:"case-access-race",authorize:async()=>{if(++authorityChecks===2)await db.update(vaultGrants).set({role:"commenter"}).where(eq(vaultGrants.id,descendant));}})).rejects.toThrow("access changed");
 expect((await listVaultTextpacks({root,workspaceId})).folders).toContain("Parent/Case/Empty child");
 const result=await moveVaultFolderCase(command);expect(result.status).toBe("moved");expect(await moveVaultFolderCase(command)).toEqual(result);
 const rows=await db.select().from(vaultGrants).where(eq(vaultGrants.workspaceId,workspaceId));expect(rows).toHaveLength(2);expect(rows.find(row=>row.id===inherited)).toMatchObject({scopeKey:"Parent",folderSignature:parentSignature,role:"viewer",revokedAt:null});expect(rows.find(row=>row.id===descendant)).toMatchObject({scopeKey:"Parent/CASE/Empty child",folderSignature:childSignature,role:"commenter",revokedAt:null});
 expect(await db.select().from(actionAudit).where(eq(actionAudit.actorUserId,actorUserId))).toHaveLength(1);expect((await db.select().from(vaultFolderMoves).where(eq(vaultFolderMoves.workspaceId,workspaceId)))[0].status).toBe("applied");
 }finally{await db.delete(vaultFolderMoves).where(eq(vaultFolderMoves.workspaceId,workspaceId));await db.delete(vaultGrants).where(eq(vaultGrants.workspaceId,workspaceId));await db.delete(actionAudit).where(eq(actionAudit.actorUserId,actorUserId));await db.delete(blogs).where(eq(blogs.id,workspaceId));await db.delete(users).where(eq(users.id,actorUserId));await fs.rm(root,{recursive:true,force:true});}
},30_000);
