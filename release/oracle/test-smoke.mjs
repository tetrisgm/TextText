import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { smoke, smokeOrigin, removeScratchFiles, verifyScratchFolder } from "./smoke.mjs";
import { localDatabase } from "./start.mjs";

test("smoke accepts only loopback HTTP port 3400 without URL credentials or suffixes", () => {
  for (const origin of ["http://127.0.0.1:3400", "http://localhost:3400", "http://[::1]:3400"]) {
    assert.equal(smokeOrigin(origin), origin);
  }
  for (const origin of ["https://texttext.app", "http://example.com:3400", "http://127.0.0.1:3000",
    "https://127.0.0.1:3400", "http://user:pass@127.0.0.1:3400", "http://127.0.0.1:3400/path",
    "http://127.0.0.1:3400?x=1", "http://127.0.0.1:3400#x"]) {
    assert.throws(() => smokeOrigin(origin), /loopback HTTP/);
  }
});

test("smoke requires explicit scratch authorization and rejects database host overrides", async () => {
  await assert.rejects(smoke(), /--scratch/);
  await assert.rejects(smoke({ scratch: true, environment: { DATABASE_URL: "postgres://example.com/scratch" } }));
  await assert.rejects(smoke({ scratch: true, environment: { DATABASE_URL: "postgres://localhost/scratch?host=example.com" } }));
});

test("a failed HTTP check removes its committed scratch account and suppresses raw errors", {
  skip: process.env.TEXTTEXT_ORACLE_SMOKE_DB_TEST !== "1",
}, async () => {
  localDatabase(process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-smoke-cleanup-"));
  await fs.mkdir(path.join(root, "keep"));
  try {
    const scratchCount = async () => Number((await client.query(
      "SELECT count(*) FROM users WHERE username LIKE 'scratch-oracle-smoke-%'",
    )).rows[0].count);
    const before = await scratchCount();
    let contactedApp = false;
    await assert.rejects(smoke({ scratch: true, environment: { ...process.env, TEXTTEXT_VAULT_ROOT: root }, fetchImpl: async (_url, options) => {
      contactedApp = true;
      const token = options.headers.Authorization.slice("Bearer ".length);
      const { rows } = await client.query("SELECT blogs.id FROM blogs JOIN api_tokens ON blogs.owner_id=api_tokens.user_id WHERE api_tokens.token_hash=$1", [createHash("sha256").update(token).digest("hex")]);
      assert.equal(rows.length, 1);
      await fs.mkdir(path.join(root, rows[0].id, ".texttext"), { recursive: true });
      await fs.writeFile(path.join(root, rows[0].id, ".texttext", "fixture"), "only scratch");
      throw new Error("Raw transport diagnostics must not escape.");
    } }), error => error.message === "Loopback request failed: /api/app/session.");
    assert.equal(contactedApp, true, "Scratch setup must commit before simulating the HTTP failure.");
    assert.equal(await scratchCount(), before, "Failure left a scratch account in PostgreSQL.");
    assert.deepEqual(await fs.readdir(root), ["keep"], "Cleanup must remove only the scratch file workspace.");
  } finally {
    await client.end();
    await fs.rm(root, { recursive: true, force: true });
  }
});


test("scratch file cleanup rejects traversal and symlink workspace roots", async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"texttext-smoke-path-"));const id=randomUUID();
 try {
  await assert.rejects(removeScratchFiles(root,"../other"),/Invalid/);
  await fs.mkdir(path.join(root,"keep"));await fs.symlink(path.join(root,"keep"),path.join(root,id));
  await assert.rejects(removeScratchFiles(root,id),/ordinary directory/);
  assert.ok((await fs.stat(path.join(root,"keep"))).isDirectory());
 } finally { await fs.rm(root,{recursive:true,force:true}); }
});


test("folder smoke uses one stable authenticated command and rejects duplicate audits", async () => {
  for (const duplicate of [false, true]) {
    const calls=[];
    const command=async (name,args)=>{ calls.push({name,args});return {status:"folder_created",relativePath:args.name}; };
    const fixture={blogId:randomUUID(),userId:randomUUID()};
    const request=async url=>{assert.equal(url,`/api/vault/${fixture.blogId}/items`);return Response.json({folders:["Empty folder verification"],items:[]});};
    const client={query:async (_sql,params)=>{assert.deepEqual(params,[fixture.userId,`${fixture.blogId}:Empty folder verification`]);return {rows:Array.from({length:duplicate?2:1},()=>({actor_type:"human"}))};}};
    const run=verifyScratchFolder({command,request,client,fixture});
    if(duplicate)await assert.rejects(run,/exactly one human audit/);else await run;
    assert.equal(calls.length,2);assert.equal(calls[0].name,"create_folder");assert.deepEqual(calls[0],calls[1]);
  }
});
