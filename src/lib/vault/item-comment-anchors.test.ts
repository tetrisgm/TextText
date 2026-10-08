import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { strToU8, zipSync, unzipSync } from "fflate";
import { mutateVaultItemCommentsInPack as mutate, readVaultItemCommentsFromPack as read } from "./item-comments";
import { parseVaultCommentsPage, groupVaultCommentThreads } from "@/local-vault/vault-comments";
const item = randomUUID();
const actor = { userId: randomUUID(), name: "Reader", type: "human" as const };
const initial = () => zipSync({ "document.json": strToU8(JSON.stringify({content:{assets:[{id:"first",kind:"image"},{id:"second",kind:"image"},{id:"video",kind:"video"}]}})), "text.md": strToU8(`---\ntextTextId: ${item}\n---\n`), "assets/original.bin": new Uint8Array([1,2,3]) });
describe("stable gallery comment anchors", () => {
 it("retains distinct image threads, inherits replies and preserves original entries", () => {
  const original=initial(), first=randomUUID();
  let bytes=mutate(original,item,first,{kind:"create",body:"First",imageAssetId:"first"},actor).bytes;
  bytes=mutate(bytes,item,randomUUID(),{kind:"create",body:"Second",imageAssetId:"second"},actor).bytes;
  bytes=mutate(bytes,item,randomUUID(),{kind:"create",body:"Reply",parentId:first},actor).bytes;
  bytes=mutate(bytes,item,randomUUID(),{kind:"create",body:"Whole file"},actor).bytes;
  const rows=read(bytes,item).comments;
  expect(rows.map(r=>r.imageAssetId)).toEqual(["first","second","first",undefined]);
  expect(groupVaultCommentThreads(parseVaultCommentsPage({...read(bytes,item),revision:"1"}).comments)[0].replies).toHaveLength(1);
  for(const [name,data] of Object.entries(unzipSync(original))) expect(unzipSync(bytes)[name]).toEqual(data);
  const entries=unzipSync(bytes); entries["document.json"]=strToU8(JSON.stringify({content:{assets:[{id:"second",kind:"image"}]}}));
  bytes=zipSync(entries); // Reordering/removing images never silently retargets historical threads.
  expect(read(bytes,item).comments[0].imageAssetId).toBe("first");
  expect(mutate(bytes,item,randomUUID(),{kind:"resolve",commentId:first,resolved:true},actor).changed).toBe(true);
 });
 it("rejects missing/non-image anchors and cross-image replies", () => {
  for(const imageAssetId of ["missing","video","", "a".repeat(121)]) expect(()=>mutate(initial(),item,randomUUID(),{kind:"create",body:"No",imageAssetId},actor)).toThrow();
  const root=randomUUID(), bytes=mutate(initial(),item,root,{kind:"create",body:"Yes",imageAssetId:"first"},actor).bytes;
  expect(()=>mutate(bytes,item,randomUUID(),{kind:"create",body:"No",parentId:root,imageAssetId:"second"},actor)).toThrow("does not match");
 });
});
