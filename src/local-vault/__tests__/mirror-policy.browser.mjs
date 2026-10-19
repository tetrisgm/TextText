import assert from 'node:assert/strict';
import { buildLocalVault } from '../../../scripts/build-local-vault.mjs';
import { chromium } from 'playwright';
import { readFile, writeFile, mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const output=process.env.TEXTTEXT_MIRROR_POLICY_BUNDLE ?? await mkdtemp(path.join(tmpdir(),'texttext-mirror-policy-'));
await buildLocalVault({output});
await copyFile('sync/fixtures/mirror-policy.json',path.join(output,'vectors.json'));
await copyFile('sync/fixtures/mirror-schedule.json',path.join(output,'schedule-vectors.json'));
await copyFile('sync/fixtures/mirror-lifecycle.json',path.join(output,'lifecycle-vectors.json'));
await copyFile('sync/fixtures/mirror-queue.json',path.join(output,'queue-vectors.json'));
await copyFile('sync/fixtures/mirror-shared-path.json',path.join(output,'shared-path-vectors.json'));
await copyFile('sync/fixtures/mirror-tombstone.json',path.join(output,'tombstone-vectors.json'));
// Load the exact packaged script without an editor, transport or credentials.
await writeFile(path.join(output,'policy-fixture.html'),'<meta charset="utf-8"><p>Isolated native policy host</p><script src="mirror-policy.js"></script>');
const manifest=JSON.parse(await readFile(path.join(output,'mirror-policy.json'),'utf8'));
const vectors=JSON.parse(await readFile(path.join(output,'vectors.json'),'utf8'));
const browser=await chromium.launch();
try {
 const page=await browser.newPage();
 await page.route('https://policy.test/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice(1)||'policy-fixture.html';
  assert(['policy-fixture.html','mirror-policy.js'].includes(name));
  await route.fulfill({body:await readFile(path.join(output,name)),contentType:name.endsWith('.js')?'text/javascript':'text/html'});
 });
 await page.goto('https://policy.test');
 const first=await page.evaluate(()=>window.texttextMirrorPolicy.handshake());
 assert.equal(first.digest,manifest.digest);assert.equal(first.version,manifest.version);
 const scope={accountId:'account-a',workspaceId:'workspace',lifecycle:'connection-a'};
 const binding=await page.evaluate(scope=>window.texttextMirrorPolicy.bind({scope,generation:0}),scope);
 await page.context().setOffline(true);
 for(const [i,vector] of vectors.entries()) {
  const request={...binding,scope,requestId:String(i),observed:vector.observed};
  const reply=await page.evaluate(request=>window.texttextMirrorPolicy.evaluate(request),request);
  assert.deepEqual(reply,{...request,disposition:vector.disposition});
 }
 const schedules=JSON.parse(await readFile(path.join(output,'schedule-vectors.json'),'utf8'));
 for(const [i,vector] of schedules.entries()) {
  const request={...binding,scope,requestId:'schedule-'+i,observed:vector.observed};
  const reply=await page.evaluate(request=>window.texttextMirrorPolicy.schedule(request),request);
  assert.deepEqual(reply,{...request,decision:vector.decision});
 }
 const lifecycles=JSON.parse(await readFile(path.join(output,'lifecycle-vectors.json'),'utf8'));
 for(const [i,vector] of lifecycles.entries()) {
  const request={...binding,scope,requestId:'lifecycle-'+i,observed:vector.observed};
  const reply=await page.evaluate(request=>window.texttextMirrorPolicy.lifecycle(request),request);
  assert.deepEqual(reply,{...request,decision:vector.decision});
 }
 const paths=JSON.parse(await readFile(path.join(output,'shared-path-vectors.json'),'utf8'));
 for(const [i,vector] of paths.entries()) {
  const request={...binding,scope,requestId:'path-'+i,observed:vector.observed};
  const reply=await page.evaluate(request=>window.texttextMirrorPolicy.sharedPath(request),request);
  assert.deepEqual(reply,{...request,decision:vector.decision});
 }
 const tombstones=JSON.parse(await readFile(path.join(output,'tombstone-vectors.json'),'utf8'));
 for(const [i,vector] of tombstones.entries()) {
  const request={...binding,scope,requestId:'tombstone-'+i,observed:vector.observed};
  const reply=await page.evaluate(request=>window.texttextMirrorPolicy.tombstone(request),request);
  assert.deepEqual(reply,{...request,decision:vector.decision});
 }
 const queues=JSON.parse(await readFile(path.join(output,'queue-vectors.json'),'utf8'));
 for(const [i,vector] of queues.entries()) {
  const request={...binding,scope,requestId:'queue-'+i,observed:vector.observed};
  const reply=await page.evaluate(request=>window.texttextMirrorPolicy.queue(request),request);
  assert.deepEqual(reply,{...request,decision:vector.decision});
 }
 await page.context().setOffline(false);await page.reload();
 const second=await page.evaluate(()=>window.texttextMirrorPolicy.handshake());
 assert.notEqual(first.pageId,second.pageId);
 await page.evaluate(scope=>window.texttextMirrorPolicy.bind({scope,generation:0}),scope);
 await assert.rejects(page.evaluate(request=>window.texttextMirrorPolicy.evaluate(request),{...binding,scope,requestId:'old',observed:vectors[0].observed}),/Stale/);
 await assert.rejects(page.evaluate(request=>window.texttextMirrorPolicy.queue(request),{...binding,scope,requestId:'old-queue',observed:queues[0].observed}),/Stale/);
 await assert.rejects(page.evaluate(request=>window.texttextMirrorPolicy.sharedPath(request),{...binding,scope,requestId:'old-path',observed:paths[0].observed}),/Stale/);
 console.log('PASS packaged mirror policy: shared vectors without an editor, offline evaluation, exact digest, reload fences old page');
} finally {await browser.close();}
