import { parseWorkspaceToolInput } from "@/lib/ai/tools";
import { beforeEach, expect, it, vi } from "vitest";
const store=vi.hoisted(()=>({listVaultItemComments:vi.fn(),mutateVaultItemComments:vi.fn()}));vi.mock("@/lib/store",()=>store);
import {executeVaultCommentTool} from "../vault-comments";
const context=()=>({root:"/fixture",workspaceId:"workspace",actorUserId:"trusted-user",actorName:"Trusted agent",operationId:"stable-operation",authorize:vi.fn().mockResolvedValue(undefined)});
beforeEach(()=>{vi.resetAllMocks();});
it("attributes agent comments from context, preserves reply ID and stable operation",async()=>{
 const input=context();store.mutateVaultItemComments.mockImplementation(async args=>{await args.beforeCommit("Notes/A.textpack");return {commentId:"created"};});
 expect(await executeVaultCommentTool("add_comment",{id:"item",body:"Reply",parent_comment_id:"parent"},input)).toEqual({commentId:"created"});
 expect(store.mutateVaultItemComments.mock.calls[0][0]).toMatchObject({operationId:"stable-operation",actor:{userId:"trusted-user",name:"Trusted agent",type:"external_agent"},mutation:{kind:"create",body:"Reply",parentId:"parent"}});
 expect(input.authorize.mock.calls).toEqual([["item","",true],["item","Notes/A.textpack",true]]);
});
it("fails revoked authority at commit and does not silently discard unsupported anchors",async()=>{
 const input=context();input.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("revoked"));store.mutateVaultItemComments.mockImplementation(args=>args.beforeCommit("Notes/A.textpack"));
 await expect(executeVaultCommentTool("set_comment_resolved",{id:"item",comment_id:"thread",resolved:true},input)).rejects.toThrow("revoked");
 await expect(executeVaultCommentTool("add_comment",{id:"item",body:"Text",anchor_exact:"quote"},context())).rejects.toThrow("quote anchors");
});
it("filters replies with their thread state across pages and rechecks read authority",async()=>{
 const input=context();store.listVaultItemComments.mockResolvedValueOnce({revision:"a",relativePath:"Notes/A",comments:[{id:"open",parentId:null,resolvedAt:null},{id:"closed",parentId:null,resolvedAt:"date"}],nextCursor:"closed"}).mockResolvedValueOnce({revision:"a",relativePath:"Notes/A",comments:[{id:"reply",parentId:"closed",resolvedAt:null}],nextCursor:null});
 const result=await executeVaultCommentTool("list_comments",{id:"item",state:"resolved"},input);expect("comments" in result&&result.comments).toEqual([{id:"closed",parentId:null,resolvedAt:"date"},{id:"reply",parentId:"closed",resolvedAt:null}]);expect(input.authorize).toHaveBeenCalledTimes(3);
});
it("does not disclose comments after read access is revoked",async()=>{
 const input=context();input.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("revoked"));store.listVaultItemComments.mockResolvedValue({revision:"a",relativePath:"Notes/A",comments:[],nextCursor:null});await expect(executeVaultCommentTool("list_comments",{id:"item"},input)).rejects.toThrow("revoked");
});
it("real TextPack comment store replays lost acknowledgement once and resolves a thread",async()=>{
 const engine=await import("@/lib/vault/server-store");const {readVaultItemCommentsFromPack}=await import("@/lib/vault/item-comments");const {buildTextpack}=await import("@/lib/github/textpack");const {emptyDocumentSnapshot}=await import("@/lib/documents/model");const {mkdtemp,rm}=await import("node:fs/promises");const {tmpdir}=await import("node:os");const {join}=await import("node:path");
 const root=await mkdtemp(join(tmpdir(),"vault-agent-comments-"));const input={...context(),root,actorUserId:"11111111-1111-4111-8111-111111111111",operationId:"22222222-2222-4222-8222-222222222222"};
 try{
  await engine.writeVaultTextpack({...input,itemId:"item",operationId:"seed",relativePath:"Notes/A.textpack",baseRevision:null,bytes:buildTextpack("A",{markdown:"---\ntextTextId: item\n---\n",document:emptyDocumentSnapshot()})});
  store.mutateVaultItemComments.mockImplementation(args=>engine.mutateVaultItemComments({...args,onReceipt:async()=>{}}));
  store.listVaultItemComments.mockImplementation(async args=>{const pack=await engine.readVaultTextpack(args);return pack?{...readVaultItemCommentsFromPack(pack.bytes,args.itemId,args.limit,args.after),relativePath:pack.relativePath,revision:pack.revision}:null;});
  const args=parseWorkspaceToolInput("add_comment",{id:"item",body:"Agent thought",idempotency_key:"public-event"});
  const first=await executeVaultCommentTool("add_comment",args,input);
  expect(await executeVaultCommentTool("add_comment",args,{...input,operationId:"44444444-4444-4444-8444-444444444444"})).toEqual(first);
  expect(await executeVaultCommentTool("add_comment",args,{...input,receiptOnly:true})).toEqual(first);
  const resolve=parseWorkspaceToolInput("set_comment_resolved",{id:"item",comment_id:"commentId" in first ? first.commentId : "invalid",resolved:false,idempotency_key:"already-open"});
  const unchanged=await executeVaultCommentTool("set_comment_resolved",resolve,input);
  expect("status" in unchanged && unchanged.status).toBe("unchanged");
  expect(await executeVaultCommentTool("set_comment_resolved",resolve,{...input,receiptOnly:true})).toEqual(unchanged);
  const listed=await executeVaultCommentTool("list_comments",{id:"item",state:"all"},input);expect("comments" in listed&&listed.comments).toHaveLength(1);
  expect("comments" in listed&&listed.comments[0].authorActorType).toBe("external_agent");
  if(!("commentId" in first))throw Error("Missing comment receipt");
  await executeVaultCommentTool("set_comment_resolved",{id:"item",comment_id:"commentId" in first ? first.commentId : "invalid",resolved:true},{...input,operationId:"33333333-3333-4333-8333-333333333333"});
  const open=await executeVaultCommentTool("list_comments",{id:"item",state:"open"},input);expect("comments" in open&&open.comments).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});

it("preserves trusted human comment attribution and rejects caller actor overrides", async () => {
 const input = { ...context(), actorType: "human" as const, actorName: "Signed-in person" };
 store.mutateVaultItemComments.mockResolvedValue({ commentId: "created" });
 await executeVaultCommentTool("add_comment", { id: "item", body: "My comment" }, input);
 expect(store.mutateVaultItemComments.mock.calls[0][0].actor).toEqual({ userId: "trusted-user", name: "Signed-in person", type: "human" });
 await expect(executeVaultCommentTool("add_comment", { id: "item", body: "Impersonation", actorType: "human" }, context())).rejects.toThrow("fields");
 expect(store.mutateVaultItemComments).toHaveBeenCalledTimes(1);
});
