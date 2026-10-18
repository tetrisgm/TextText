import { z } from "zod";
import { authorizeVaultWorkspaceOrScoped } from "@/app/api/vault/scoped-auth";
import { readBoundedJson } from "@/lib/http/bounded-json";
import { validVaultFolderPath, validVaultTextpackPath, validVaultItemId } from "@/lib/vault/folder-identity";
import { recoverVaultFolderCase } from "@/lib/store";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
const folder = z.string().min(1).max(256).refine(validVaultFolderPath);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const commandSchema = z.object({ operationId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),source:folder,destination:folder,baseManifestRevision:digest,
 folders:z.array(folder).max(20_000),items:z.array(z.object({itemId:z.string().refine(validVaultItemId),relativePath:z.string().max(1024).refine(validVaultTextpackPath),revision:digest}).strict()).max(20_000) }).strict();

const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("inspect"),command:commandSchema}).strict(),
 z.object({action:z.literal("cancel"),command:commandSchema,inspection:digest,consent:z.literal(true)}).strict()
]);
export async function POST(request:Request,context:{params:Promise<{workspaceId:string}>}){
 const {workspaceId}=await context.params;const access=await authorizeVaultWorkspaceOrScoped(request,workspaceId);
 if(access instanceof Response)return access;
 if(!access.canManageShares||!access.fullAccess||!access.actorUserId)return Response.json({error:"Only the current workspace owner can review folder synchronization."},{status:403,headers});
 const decoded=await readBoundedJson(request,4*1024*1024);
 if("error" in decoded)return Response.json({error:"Invalid recovery command."},{status:decoded.error==="too_large"?413:400,headers});
 const parsed=schema.safeParse(decoded.value);
 if(!parsed.success)return Response.json({error:"Invalid recovery command."},{status:400,headers});
 const {source,destination}=parsed.data.command;const parent=(value:string)=>value.includes("/")?value.slice(0,value.lastIndexOf("/")):"";
 if(source===destination||parent(source)!==parent(destination)||source.normalize("NFC").toLowerCase()!==destination.normalize("NFC").toLowerCase())return Response.json({error:"Invalid folder case command."},{status:400,headers});
 try{
  const result=await recoverVaultFolderCase({...parsed.data.command,action:parsed.data.action,...(parsed.data.action==="cancel"?{inspection:parsed.data.inspection}:{}),root:access.root,workspaceId,actorUserId:access.actorUserId,authorize:async()=>{
   const current=await authorizeVaultWorkspaceOrScoped(request,workspaceId);
   if(current instanceof Response||!current.canManageShares||!current.fullAccess||current.actorUserId!==access.actorUserId||current.root!==access.root)throw Error("Workspace owner changed");
  }});
  return Response.json(result,{headers});
 }catch{return Response.json({error:"Folder recovery is not complete or the inspection changed. Keep the saved command and files, then inspect again."},{status:409,headers});}
}
