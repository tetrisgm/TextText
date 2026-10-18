import { z } from "zod";
import { authorizeVaultWorkspaceOrScoped } from "@/app/api/vault/scoped-auth";
import { readBoundedJson } from "@/lib/http/bounded-json";
import { validVaultFolderPath, validVaultTextpackPath, validVaultItemId } from "@/lib/vault/folder-identity";
import { moveVaultFolderCase } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const folder = z.string().min(1).max(256).refine(validVaultFolderPath);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.object({ operationId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),source:folder,destination:folder,baseManifestRevision:digest,
 folders:z.array(folder).max(20_000),items:z.array(z.object({itemId:z.string().refine(validVaultItemId),relativePath:z.string().max(1024).refine(validVaultTextpackPath),revision:digest}).strict()).max(20_000) }).strict();
const fail = (status:number,error:string) => Response.json({error},{status,headers});

/** Owner-authenticated native propagation only; general folder moves continue
 * through the reviewed proposal route. No client approval flags are accepted. */
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}) {
 const {workspaceId}=await context.params;const access=await authorizeVaultWorkspaceOrScoped(request,workspaceId);
 if(access instanceof Response)return access;
 if(!access.canManageShares||!access.fullAccess||!access.actorUserId)return fail(403,"Only the current workspace owner can propagate folder case changes.");
 const decoded=await readBoundedJson(request,4*1024*1024);if("error" in decoded)return fail(decoded.error==="too_large"?413:400,"Invalid folder case command.");
 const parsed=schema.safeParse(decoded.value);if(!parsed.success)return fail(400,"Invalid folder case command.");
 const {source,destination}=parsed.data;const parent=(value:string)=>value.includes("/")?value.slice(0,value.lastIndexOf("/")):"";
 if(source===destination||parent(source)!==parent(destination)||source.normalize("NFC").toLowerCase()!==destination.normalize("NFC").toLowerCase())return fail(400,"Only a same-parent case-only folder change can sync automatically.");
 try{
  const result=await moveVaultFolderCase({...parsed.data,root:access.root,workspaceId,actorUserId:access.actorUserId,authorize:async()=>{
   const current=await authorizeVaultWorkspaceOrScoped(request,workspaceId);
   if(current instanceof Response||!current.canManageShares||!current.fullAccess||current.actorUserId!==access.actorUserId||current.root!==access.root)throw Error("Workspace owner changed");
  }});
  return Response.json(result,{headers});
 }catch{return fail(409,"The folder topology, content or access changed. Saved local files and the pending command must be kept for review.");}
}
