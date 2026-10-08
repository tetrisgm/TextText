import { and, eq, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/lib/db/client";
import { vaultGrants, vaultFolderMoves } from "@/lib/db/schema";
import { planFolderMove, type FolderMoveGrant, type FolderMoveItem } from "@/sync/engine/folder-move-plan";
import { vaultFolderSignature } from "./folder-identity";
import { normalizeAccessEmail } from "@/lib/permissions";

type Plan = ReturnType<typeof planFolderMove>;
type Transaction = Parameters<Parameters<NonNullable<typeof db>["transaction"]>[0]>[0];
async function ownerLock(tx: Transaction, workspaceId: string, actorUserId: string) {
 const result = await tx.execute(sql`SELECT id FROM blogs WHERE id = ${workspaceId}::uuid AND owner_id = ${actorUserId}::uuid AND deleted_at IS NULL FOR UPDATE`);
 if (result.rows.length !== 1) throw Error("Only the workspace owner can move folders");
}
export async function assertNoReservedFolderMove(tx: Transaction, workspaceId: string) {
 const pending = await tx.select({ id: vaultFolderMoves.operationId }).from(vaultFolderMoves).where(and(eq(vaultFolderMoves.workspaceId, workspaceId), eq(vaultFolderMoves.status, "reserved"))).limit(1);
 if (pending.length) throw Error("A folder move is being recovered. Try again shortly.");
}
/** Caller already holds the engine lock. This transaction never calls the
 * engine: lock ordering is always engine -> workspace SQL row. A committed
 * reservation survives database rollback during the later filesystem phase. */
export async function reserveFolderMove(input: {
 root: string; workspaceId: string; actorUserId: string; operationId: string; requestHash: string;
 source: string; destination: string; manifestRevision: string; folders: string[]; items: FolderMoveItem[];
 expectedGrantsFingerprint: string;
}) {
 if (!db) throw Error("Sharing requires the database");
 return db.transaction(async tx => {
  await ownerLock(tx,input.workspaceId,input.actorUserId);
  const [prior] = await tx.select().from(vaultFolderMoves).where(and(eq(vaultFolderMoves.workspaceId,input.workspaceId),eq(vaultFolderMoves.operationId,input.operationId)));
  if (prior) {
   if(prior.requestHash!==input.requestHash || prior.actorUserId!==input.actorUserId) throw Error("Operation id was reused");
   if(prior.status==="aborted") throw Error("Folder move was cancelled");
   return prior.plan as Plan;
  }
  await assertNoReservedFolderMove(tx,input.workspaceId);
  const rows=await tx.select().from(vaultGrants).where(and(eq(vaultGrants.workspaceId,input.workspaceId),eq(vaultGrants.scopeType,"folder"),isNull(vaultGrants.revokedAt)));
  const grants: FolderMoveGrant[]=[];
  for(const row of rows) {
   const signature=await vaultFolderSignature(input.root,input.workspaceId,row.scopeKey);
   if(signature && signature===row.folderSignature && ["viewer","commenter","editor"].includes(row.role)) grants.push({id:row.id,path:row.scopeKey,signature,email:normalizeAccessEmail(row.invitedEmail),role:row.role as FolderMoveGrant["role"]});
  }
  const plan=planFolderMove({...input,grants});
  if(plan.grantsFingerprint!==input.expectedGrantsFingerprint) throw Error("Folder access changed. Review the move again.");
  await tx.insert(vaultFolderMoves).values({workspaceId:input.workspaceId,operationId:input.operationId,requestHash:input.requestHash,actorUserId:input.actorUserId,plan});
  return plan;
 });
}

function stableId(value:string) {const h=createHash("sha256").update(value).digest("hex");return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;}
/** Idempotent metadata completion. Engine publication and revalidation happen
 * first, under its lock; share writers cannot change this frozen grant set. */
export async function completeFolderMoveMetadata(input:{workspaceId:string;operationId:string;requestHash:string;rootSignature:string}) {
 if(!db)throw Error("Sharing requires the database");
 return db.transaction(async tx=>{
  const locked=await tx.execute(sql`SELECT id FROM blogs WHERE id=${input.workspaceId}::uuid FOR UPDATE`);
  if(locked.rows.length!==1)throw Error("Workspace unavailable");
  const [saved]=await tx.select().from(vaultFolderMoves).where(and(eq(vaultFolderMoves.workspaceId,input.workspaceId),eq(vaultFolderMoves.operationId,input.operationId)));
  if(!saved||saved.requestHash!==input.requestHash||saved.status==="aborted")throw Error("Folder move reservation unavailable");
  if(saved.status==="applied")return;
  const plan=saved.plan as Plan;
  for(const grant of plan.movedGrants) await tx.update(vaultGrants).set({scopeKey:grant.destination}).where(and(eq(vaultGrants.id,grant.id),eq(vaultGrants.workspaceId,input.workspaceId),eq(vaultGrants.scopeKey,grant.path),isNull(vaultGrants.revokedAt)));
  for(const inherited of plan.preserveInherited){
   const [source]=await tx.select().from(vaultGrants).where(and(eq(vaultGrants.id,inherited.id),eq(vaultGrants.workspaceId,input.workspaceId),isNull(vaultGrants.revokedAt)));
   if(!source)throw Error("Reserved folder access changed");
   const [existing]=await tx.select().from(vaultGrants).where(and(eq(vaultGrants.workspaceId,input.workspaceId),eq(vaultGrants.scopeType,"folder"),eq(vaultGrants.scopeKey,plan.destination),eq(vaultGrants.invitedEmail,source.invitedEmail),isNull(vaultGrants.revokedAt)));
   if(existing) await tx.update(vaultGrants).set({role:inherited.role,folderSignature:input.rootSignature}).where(eq(vaultGrants.id,existing.id));
   else await tx.insert(vaultGrants).values({id:stableId(`${input.workspaceId}:${input.operationId}:${source.id}`),workspaceId:input.workspaceId,scopeType:"folder",scopeKey:plan.destination,folderSignature:input.rootSignature,invitedEmail:source.invitedEmail,userId:source.userId,role:inherited.role,invitedById:source.invitedById});
  }
  await tx.update(vaultFolderMoves).set({status:"applied",completedAt:new Date()}).where(and(eq(vaultFolderMoves.workspaceId,input.workspaceId),eq(vaultFolderMoves.operationId,input.operationId)));
 });
}

export async function abortFolderMoveMetadata(input:{workspaceId:string;operationId:string;requestHash:string}) {
 if(!db)throw Error("Sharing requires the database");
 await db.transaction(async tx=>{
  await tx.execute(sql`SELECT id FROM blogs WHERE id=${input.workspaceId}::uuid FOR UPDATE`);
  await tx.update(vaultFolderMoves).set({status:"aborted",completedAt:new Date()}).where(and(eq(vaultFolderMoves.workspaceId,input.workspaceId),eq(vaultFolderMoves.operationId,input.operationId),eq(vaultFolderMoves.requestHash,input.requestHash),eq(vaultFolderMoves.status,"reserved")));
 });
}

export async function coordinateFolderMove(root:string,intent:import("@/sync/engine/folder-move-operation").FolderMoveIntent,phase:"reserve"|"complete"|"abort") {
 const identity={workspaceId:intent.workspaceId,operationId:intent.operationId,requestHash:intent.requestHash};
 if(phase==="reserve") { await reserveFolderMove({...intent.plan,...intent.manifest,...identity,root,actorUserId:intent.actorUserId,expectedGrantsFingerprint:intent.plan.grantsFingerprint});return; }
 if(phase==="abort") return abortFolderMoveMetadata(identity);
 const rootSignature=await vaultFolderSignature(root,intent.workspaceId,intent.plan.destination);
 if(!rootSignature)throw Error("Moved folder identity unavailable");
 await completeFolderMoveMetadata({...identity,rootSignature});
}
