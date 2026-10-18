// Isolated real Chromium driver/ownership fixture. No TextText account, editor,
// collaboration or six-client acceptance is represented by this page.
import assert from 'node:assert/strict';
import {realpathSync} from 'node:fs';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {closeOwnedBrowser,observeOwnedBrowser,retainGuardedBrowser} from './browser-lifecycle.mjs';
import {ProcessAdapter} from './adapter.mjs';
const file=fileURLToPath(import.meta.url),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(probe){const end=Date.now()+10000;for(;;){if(await probe())return;if(Date.now()>end)throw Error('Fixture ownership wait expired');await sleep(25);}}
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
async function launch(profile,origin){const context=await chromium.launchPersistentContext(profile,{channel:'chrome',args:['--enable-automation'],headless:true,timeout:15000});const page=context.pages()[0];page.setDefaultTimeout(10000);await page.goto(origin);await page.waitForFunction(()=>window.ready);return{context,page};}
if(process.argv[2]==='--guard-child'){
 const [profile,origin,status,cleanup]=process.argv.slice(3);const {context,page}=await launch(profile,origin);
 await page.locator('[contenteditable]').click();await page.keyboard.insertText('[guard activation]');await page.evaluate(()=>{onbeforeunload=event=>{event.preventDefault();event.returnValue='';};});
 let retained;
 try{await closeOwnedBrowser(context,page,profile);throw Error('Guard unexpectedly closed');}catch(error){assert.ok(error.retention);retained=error.retention;}
 retainGuardedBrowser(context);let beat=0;
 const pulse=setInterval(async()=>{
  await writeFile(status,JSON.stringify({retained,beat:++beat,pageRetained:!page.isClosed(),contextRetained:context.browser().isConnected()}));
  if(await readFile(cleanup).then(()=>true,()=>false)){clearInterval(pulse);await context.close();}
 },50);
 process.stdout.write(JSON.stringify({type:'error',round:1,message:'fixture production-style guard retained',retained})+'\n');
}else if(process.argv[2]==='--guard-parent'){
 const args=process.argv.slice(3);const actor=new ProcessAdapter('mac-web',[process.execPath,file,'--guard-child',...args]);
 actor.on('error',()=>process.exit(2));actor.on('message',message=>{assert.ok(message.retained);actor.retainForReview();process.stdout.write(JSON.stringify(message.retained)+'\n',()=>process.exit(0));});actor.start();
}else{
 const base=realpathSync(await mkdtemp(join(tmpdir(),'texttext-browser-normal-fixture-'))),profile=join(base,'profile');
 const html='<div contenteditable="true" aria-label="Document body"></div><script>const e=document.querySelector("[contenteditable]");e.textContent=localStorage.body??"Existing fixture body.";e.addEventListener("input",()=>localStorage.body=e.textContent);window.ready=true;</script>';
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 let context,peerBrowser,retained,cleanup;
 try{
  await import('node:fs/promises').then(fs=>fs.mkdir(profile));let page;({context,page}=await launch(profile,origin));
  peerBrowser=await chromium.launch({channel:'chrome',headless:true,timeout:15000});const peer=await peerBrowser.newPage();await peer.setContent('<p>Peer remains mounted</p>');await peer.evaluate(()=>window.peerSession='peer-'+Date.now());const peerSession=await peer.evaluate(()=>window.peerSession);
  await page.locator('[contenteditable]').click();await page.keyboard.press('End');const marker='[normal close keyboard 👩‍💻]';await page.keyboard.insertText(marker);const expected=await page.locator('[contenteditable]').textContent();assert.equal(expected.split(marker).length,2);
  const before=await observeOwnedBrowser(context,profile),signals=[];
  const proof=await closeOwnedBrowser(context,page,profile,{signal:(pid,kind)=>{signals.push(kind);return process.kill(pid,kind);}});assert.equal(proof.pid,before.pid);assert.equal(proof.method,'normal-close');assert.ok(signals.every(kind=>kind===0));
  ({context,page}=await launch(profile,origin));assert.equal(await page.locator('[contenteditable]').textContent(),expected);const after=await observeOwnedBrowser(context,profile);assert.notEqual(after.pid,before.pid);assert.equal(after.profileScopeHash,before.profileScopeHash);assert.equal(await peer.evaluate(()=>window.peerSession),peerSession);
  const guardProfile=join(base,'guard-profile'),status=join(base,'guard-status.json');cleanup=join(base,'explicit-fixture-cleanup');await import('node:fs/promises').then(fs=>fs.mkdir(guardProfile));
  const parent=spawn(process.execPath,[file,'--guard-parent',guardProfile,origin,status,cleanup],{stdio:['ignore','pipe','pipe']});let output='',errors='';parent.stdout.on('data',data=>output+=data);parent.stderr.on('data',data=>errors+=data);const code=await new Promise(resolve=>parent.once('exit',resolve));assert.equal(code,0,errors);retained=JSON.parse(output.trim());assert.ok(alive(retained.driverPid));assert.ok(alive(retained.browserPid));
  let first;await until(async()=>{try{first=JSON.parse(await readFile(status,'utf8'));return first.beat>0;}catch{return false;}});await until(async()=>{try{const next=JSON.parse(await readFile(status,'utf8'));return next.beat>first.beat&&next.pageRetained&&next.contextRetained;}catch{return false;}});
  // Only this disposable fixture authorizes bypassing the guard for cleanup,
  // after proving parent-exit survival. Production runner never sends this flag.
  await writeFile(cleanup,'explicit fixture cleanup');await until(()=>!alive(retained.driverPid)&&!alive(retained.browserPid));
  console.log(JSON.stringify({kind:'browser-driver-normal-close-fixture',acceptance:'none',normalClose:proof,reopenedPid:after.pid,profilePreserved:true,keyboardTextPreserved:true,peerMounted:true,guardDismissRetainsPage:true,driverAndBrowserSurviveParentExit:true,explicitFixtureCleanup:true,fixture:base,passed:true}));
 }finally{
  if(cleanup)await writeFile(cleanup,'explicit fixture cleanup').catch(()=>{});
  await context?.close().catch(()=>{});await peerBrowser?.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));
 }
}
