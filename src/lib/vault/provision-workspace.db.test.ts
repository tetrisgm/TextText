import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const enabled=process.env.TEXTTEXT_READING_DB_TEST==="1"&&!!process.env.DATABASE_URL;
it.skipIf(!enabled)("fresh account retries interrupted provisioning concurrently without SQL content",async()=>{
 if(!["localhost","127.0.0.1","[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname))throw Error("Local PostgreSQL only");
 const {db}=await import("@/lib/db/client"); if(!db)throw Error("Missing local database");
 const {users,blogs,posts,folders,actionAudit}=await import("@/lib/db/schema");
 const {ensureOwnerBlog}=await import("@/lib/store");
 const {listVaultTextpacks}=await import("./server-store");
 const sub=`provision-${crypto.randomUUID()}`; const root=await mkdtemp(path.join(os.tmpdir(),"texttext-provision-db-"));const previous=process.env.TEXTTEXT_VAULT_ROOT;
 try{
  delete process.env.TEXTTEXT_VAULT_ROOT;
  await expect(ensureOwnerBlog({sub,name:"Fixture"})).rejects.toThrow(/storage/);
  process.env.TEXTTEXT_VAULT_ROOT=root;
  const results=await Promise.all([ensureOwnerBlog({sub,name:"Fixture"}),ensureOwnerBlog({sub,name:"Fixture"})]);
  expect(results[0].handle).toBe(results[1].handle);expect(results[0].name).toBe("My workspace");
  const [workspace]=await db.select().from(blogs).where(eq(blogs.handle,results[0].handle));
  expect(await db.select().from(posts).where(eq(posts.blogId,workspace.id))).toEqual([]);
  expect(await db.select().from(folders).where(eq(folders.blogId,workspace.id))).toEqual([]);
  expect((await listVaultTextpacks({root,workspaceId:workspace.id})).items).toHaveLength(4);
  const events=await db.select().from(actionAudit).where(eq(actionAudit.actorUserId,workspace.ownerId!));
  expect(events.filter(e=>e.actionName==="provision_file_workspace_v1")).toHaveLength(1);
  expect(events.filter(e=>e.actionName==="provision_file_workspace_v1_complete")).toHaveLength(1);
  expect(events.filter(e=>e.actionName==="vault.write")).toHaveLength(4);
 }finally{
  if(previous===undefined)delete process.env.TEXTTEXT_VAULT_ROOT;else process.env.TEXTTEXT_VAULT_ROOT=previous;
  const [owner]=await db.select().from(users).where(eq(users.appleSub,sub));if(owner){await db.delete(actionAudit).where(eq(actionAudit.actorUserId,owner.id));await db.delete(blogs).where(eq(blogs.ownerId,owner.id));await db.delete(users).where(eq(users.id,owner.id));}
  await rm(root,{recursive:true,force:true});
 }
},30000);
