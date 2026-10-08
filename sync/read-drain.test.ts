import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const run = promisify(execFile);
let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "texttext-read-drain-test-"));
  await symlink(path.join(process.cwd(), "node_modules"), path.join(directory, "node_modules"));
  await build({ stdin: { contents: `
import { installReadDrain,readDrainSignal,readRequestSignal,waitForReadPoll } from './src/sync/engine/read-drain';
import { listVaultTextpacks,waitVaultTextpacks,waitVaultCollaboration,readVaultCollaboration,writeVaultTextpack,readVaultTextpack } from './src/sync/engine/store';
import { emptyDocumentSnapshot } from './src/lib/documents/model';import { buildTextpack } from './src/lib/github/textpack';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
async function main(){
 if(process.argv[2]==='unmanaged'){readDrainSignal();assert.equal(process.listenerCount('SIGTERM'),0);process.kill(process.pid,'SIGTERM');await new Promise(r=>setTimeout(r,1000));throw Error('SIGTERM was swallowed');}
 const before=process.listenerCount('SIGTERM');for(let i=0;i<30;i++)installReadDrain();assert.equal(process.listenerCount('SIGTERM'),before+1);
 process.on('warning',error=>{throw error;});
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'texttext-drain-vault-'));
 try{
  const location={root,workspaceId:'fixture'};
  const seedId='22222222-2222-4222-8222-222222222222';
  await writeVaultTextpack({...location,itemId:seedId,operationId:'seed',relativePath:'Notes/Seed.textpack',baseRevision:null,bytes:buildTextpack('Seed',{document:emptyDocumentSnapshot(),markdown:'---\\ntextTextId: '+seedId+'\\n---\\n'})});
  const checkpoint=await readVaultCollaboration({...location,itemId:seedId});const initial=await listVaultTextpacks(location);
  const cancel=new AbortController();const cancelled=waitForReadPoll(25000,readRequestSignal(cancel.signal));cancel.abort();await cancelled;
  const legacy=Array.from({length:24},()=>waitForReadPoll(25000,readRequestSignal()));
  const pending=[...legacy,...Array.from({length:12},()=>waitVaultTextpacks({...location,revision:initial.revision,waitMs:25000})),...Array.from({length:12},()=>waitVaultCollaboration({...location,itemId:seedId,epoch:checkpoint.epoch,seq:checkpoint.seq,waitMs:25000}))];
  await new Promise(r=>setTimeout(r,150));const started=Date.now();process.kill(process.pid,'SIGTERM');await Promise.all(pending);assert.ok(Date.now()-started<8000);
  assert.equal(process.listenerCount('SIGTERM'),0);
  const itemId='11111111-1111-4111-8111-111111111111';const document=emptyDocumentSnapshot();document.content.body='Durable write';
  await writeVaultTextpack({...location,itemId,operationId:'write-after-drain',relativePath:'Notes/Kept.textpack',baseRevision:null,bytes:buildTextpack('Note',{document,markdown:'---\\ntextTextId: '+itemId+'\\n---\\n\\nDurable write'})});
  assert.ok(await readVaultTextpack({...location,itemId}));console.log('managed drain passed');
 }finally{await fs.rm(root,{recursive:true,force:true});}
}main().catch(error=>{console.error(error);process.exitCode=1;});
`, resolveDir: process.cwd(), loader: "ts" }, outfile: path.join(directory,"fixture.cjs"), bundle: true, platform: "node", format: "cjs", packages: "external", tsconfig: path.join(process.cwd(),"tsconfig.json"), logLevel: "silent" });
});
afterAll(async () => { if (directory) await rm(directory,{recursive:true,force:true}); });
it("leaves Node's default SIGTERM behavior intact outside the Next lifecycle", async () => {
  await expect(run(process.execPath,[path.join(directory,"fixture.cjs"),"unmanaged"],{timeout:5000})).rejects.toMatchObject({signal:"SIGTERM"});
});
it("wakes concurrent read polls without signal listener leaks or cancelling durable writes", async () => {
  const result=await run(process.execPath,[path.join(directory,"fixture.cjs"),"managed"],{timeout:15000});
  expect(result.stdout).toContain("managed drain passed");expect(result.stderr).toBe("");
},20000);
