import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { buildTextpack } from "@/lib/github/textpack";

it("uses real loopback HTTP and engine to retain whole-tree move/replay/cancellation with opt-in capability",async()=>{
 const scratch=await fs.mkdtemp(path.join(os.tmpdir(),"texttext-folder-http-")),root=path.join(scratch,"server"),ready=path.join(scratch,"ready.json");
 await fs.mkdir(path.join(root,"contract-workspace/Parent/Case/Empty"),{recursive:true});
 const child=spawn(process.execPath,["--import","tsx","scripts/vault-http-test-server.ts",root,ready],{cwd:process.cwd(),stdio:["ignore","ignore","pipe"]});
 let diagnostic="";child.stderr.on("data",bytes=>{diagnostic=(diagnostic+bytes.toString()).slice(-2048);});
 try{
  let origin="";
  for(let i=0;i<200&&!origin;i++){
   if(child.exitCode!==null)throw Error("Owned fixture exited: "+diagnostic);
   try{origin=JSON.parse(await fs.readFile(ready,"utf8")).origin;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
   if(!origin)await new Promise(resolve=>setTimeout(resolve,25));
  }
  if(!origin)throw Error("Owned loopback fixture readiness timed out: "+diagnostic);
  const request=(url:string,init:RequestInit={})=>fetch(origin+url,{...init,headers:{Authorization:"Bearer vault-http-fixture",...init.headers},signal:AbortSignal.timeout(5000)});
  const items="/api/vault/contract-workspace/items",moves="/api/vault/contract-workspace/folder-case-moves";
  expect((await (await request(items)).json()).syncCapabilities).toBeUndefined();
  expect((await request("/__test/folder-case?enabled=1")).status).toBe(200);
  const document=emptyDocumentSnapshot();document.content.body="Exact HTTP original";
  const archive=buildTextpack("One",{document,markdown:"---\ntextTextId: http-one\n---\nExact HTTP original",files:{"assets/exact.bin":new Uint8Array([0,255,7])}});
  expect((await request(items+"/http-one",{method:"PUT",headers:{"X-TextText-Operation-Id":"seed","X-TextText-Path":encodeURIComponent("Parent/Case/one.textpack"),"If-None-Match":"*"},body:new Uint8Array(archive).buffer})).status).toBe(200);
  const manifest=await (await request(items)).json();expect(manifest.syncCapabilities).toEqual(["folder-case-moves-v1"]);expect(manifest.manifestRevision).toBe(manifest.revision);
  const command={operationId:crypto.randomUUID(),source:"Parent/Case",destination:"Parent/CASE",baseManifestRevision:manifest.manifestRevision,folders:manifest.folders.filter((p:string)=>p.startsWith("Parent/Case")),items:manifest.items.map(({itemId,relativePath,revision}:{itemId:string;relativePath:string;revision:string})=>({itemId,relativePath,revision}))};
  const post=(url:string,body:unknown)=>request(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  await request("/__test/reply-loss?enabled=1");await expect(post(moves,command)).rejects.toThrow();await request("/__test/reply-loss?enabled=0");
  const replay=await post(moves,command);expect(replay.status).toBe(200);const moved=await replay.json();expect(moved).toMatchObject({status:"moved",operationId:command.operationId,folders:["Parent/CASE","Parent/CASE/Empty"]});
  const current=await (await request(items)).json();expect(current.folders).toEqual(["Parent","Parent/CASE","Parent/CASE/Empty"]);expect(Buffer.from(await (await request(items+"/http-one")).arrayBuffer())).toEqual(Buffer.from(archive));
  expect(await (await post(moves+"/recovery",{action:"inspect",command})).json()).toMatchObject({state:"completed",result:moved});
  const next={...command,operationId:crypto.randomUUID(),source:"Parent/CASE",destination:"Parent/cASE",baseManifestRevision:current.manifestRevision,folders:current.folders.filter((p:string)=>p.startsWith("Parent/CASE")),items:current.items.map(({itemId,relativePath,revision}:{itemId:string;relativePath:string;revision:string})=>({itemId,relativePath,revision}))};
  await fs.mkdir(path.join(root,"contract-workspace/Another empty folder"));expect((await post(moves,next)).status).toBe(409);
  const review=await (await post(moves+"/recovery",{action:"inspect",command:next})).json();expect(review.state).toBe("review");
  const cancelled=await (await post(moves+"/recovery",{action:"cancel",command:next,inspection:review.inspection,consent:true})).json();expect(cancelled.state).toBe("cancelled");
  expect((await post(moves,next)).status).toBe(409);expect(await (await post(moves+"/recovery",{action:"inspect",command:next})).json()).toEqual(cancelled);
  expect(Buffer.from(await (await request(items+"/http-one")).arrayBuffer())).toEqual(Buffer.from(archive));
  expect((await (await request(items)).json()).folders).toContain("Parent/CASE/Empty");
  const stats=await (await request("/__test/stats")).json();expect(stats.folderPublications).toBe(1);expect(stats.folderRequests).toBeGreaterThanOrEqual(3);
 }finally{
  if(child.exitCode===null){const exited=once(child,"exit");child.kill("SIGTERM");await exited;}
  await fs.rm(scratch,{recursive:true,force:true});
 }
},20000);
