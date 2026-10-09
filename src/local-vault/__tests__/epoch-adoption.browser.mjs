// Live epoch adoption. A pending edit meets an outside replacement of the
// TextPack; the real FileCollaborationClient recovers it against the real
// file-backed relay store (temp directory) through an emulated native bridge
// that advertises `epoch-adoption`. The mounted editor must keep its body
// element, focus and caret, show remote and local text, replace its awareness,
// keep undoing through the adoption without discarding the remote edit, and
// survive a failed native checkpoint of the adopted epoch.
// Run: node --import tsx src/local-vault/__tests__/epoch-adoption.browser.mjs
import assert from 'node:assert/strict';import{mkdtemp,writeFile,readFile,rm,symlink}from'node:fs/promises';import{tmpdir}from'node:os';import path from'node:path';import{chromium}from'playwright';import{createRequire}from'node:module';const Y=createRequire(import.meta.url)('yjs');/* the same copy the TypeScript store loads */import{buildLocalVault}from'../../../scripts/build-local-vault.mjs';
import{buildTextpack}from'../../lib/github/textpack';import{emptyDocumentSnapshot}from'../../lib/documents/model';import{documentText}from'../../lib/collab/document';
import{readVaultCollaboration,pushVaultCollaboration,writeVaultTextpack,readVaultTextpack,VaultCollaborationEpochError,VaultCollaborationRecoveryError}from'../../sync/engine/store';
const dir=await mkdtemp(path.join(tmpdir(),'texttext-epoch-adoption-'));const vault=await mkdtemp(path.join(tmpdir(),'texttext-epoch-adoption-store-'));let browser;
const workspaceId='workspace-1',itemId='item-1',relativePath='Notes/Shared.textpack';const audit={actorUserId:'user-1',actorType:'human'};
const location={root:vault,workspaceId,itemId,onReceipt:async()=>{}};
function note(body){const d=emptyDocumentSnapshot({id:'texttext.note',version:1});d.content.body=body;return d;}
function markdown(body){return`---\ntextTextId: ${itemId}\n---\n\n${body}`;}
function pack(body,files){return buildTextpack('Note',{document:note(body),markdown:markdown(body),files});}
async function serverBody(){const s=await readVaultCollaboration(location);const d=new Y.Doc();try{Y.applyUpdate(d,Buffer.from(s.update,'base64'));return documentText(d,'body').toString();}finally{d.destroy();}}
async function serverEpoch(){return(await readVaultCollaboration(location)).epoch;}
try{
await writeVaultTextpack({...location,relativePath,operationId:'initial',baseRevision:null,bytes:pack('Hello')});
const initialRevision=(await readVaultTextpack(location)).revision;
// Native bridge emulation: one file, one journal, the Mac/Windows checkpoint guard.
const file={path:relativePath,hash:initialRevision,markdown:markdown('Hello'),documentJSON:JSON.stringify(note('Hello'))};
const native={journal:null,checkpoints:[],failCheckpoints:0,failRecoveryPushes:0,presence:[],pushes:[]};
let holdNormalPush=null,holdRecoveryPush=null,recoveryPushSeen=null;
const fail=(message,code)=>({__error:{message,code}});
async function vaultCall(method,params){
 if(method==='collaborationOpen')return{sessionToken:'session-1',path:file.path,hash:file.hash,projectedHash:null,acknowledgedRevision:file.hash,journal:native.journal,retiredReason:null,capabilities:['epoch-adoption']};
 if(method==='collaborationClose')return{};
 if(method==='read'){if(params.path!==file.path)return fail('Missing '+params.path,'missing');return{...file};}
 if(method==='collaborationRead'){
  const wait=Number(params.waitMs??0);const started=Date.now();
  for(;;){const state=await readVaultCollaboration(location);if(!state)return fail('Missing','404');
   if(!wait||state.epoch!==params.epoch||state.seq!==params.seq)return{...state,canEditContent:true,canComment:true};
   if(Date.now()-started>Math.min(wait,1500))return{epoch:state.epoch,seq:state.seq,revision:state.revision,relativePath:state.relativePath,unchanged:true,canEditContent:true,canComment:true};
   await new Promise(r=>setTimeout(r,40));}}
 if(method==='collaborationPush'){
  const recovery=params.recoveryUpdate!==undefined;native.pushes.push({operationId:params.operationId,epoch:params.epoch,recovery});
  if(recovery){recoveryPushSeen?.();if(holdRecoveryPush)await holdRecoveryPush;if(native.failRecoveryPushes>0){native.failRecoveryPushes-=1;native.pushes.at(-1).failed=true;return fail('Relay unavailable.','503');}}else if(holdNormalPush)await holdNormalPush;
  try{return await pushVaultCollaboration({...location,operationId:params.operationId,epoch:params.epoch,audit,...(recovery?{recoveryUpdate:params.recoveryUpdate}:{updates:params.updates})});}
  catch(error){if(error instanceof VaultCollaborationEpochError)return fail(error.message,'epoch_changed');if(error instanceof VaultCollaborationRecoveryError)return fail(error.message,error.code);return fail(String(error),'500');}}
 if(method==='collaborationCheckpoint'){
  const journal=JSON.parse(params.journal);const prior=native.journal?JSON.parse(native.journal):null;
  const priorPending=prior&&(prior.pending.length||prior.batch||prior.unqueuedDirty||prior.recovery);
  const authorized=prior&&journal.recovery&&journal.recovery.adopted===true&&prior.recovery&&prior.recovery.operationId===journal.recovery.operationId&&journal.recovery.epoch===prior.epoch;
  native.checkpoints.push({epoch:journal.epoch,pending:params.pending,recovery:journal.recovery??null,authorized:Boolean(authorized)});
  if(params.hash!==file.hash)return fail('The file changed outside this session.','stale_file');
  if(prior&&priorPending&&journal.epoch!==prior.epoch&&!authorized)return fail('A pending journal cannot change epoch without a proven adoption.','stale_session');
  if(native.failCheckpoints>0&&journal.recovery?.adopted){native.failCheckpoints-=1;native.checkpoints.at(-1).failed=true;return fail('Simulated native checkpoint failure.','checkpoint_failed');}
  native.journal=params.journal;file.markdown=params.markdown;file.documentJSON=params.documentJSON;file.hash=params.revision;return{path:file.path,hash:file.hash};}
 if(method==='presenceJoin'){native.presence.push({method,clientId:params.awarenessClientId});return{epoch:1,presence:[],session:{clientId:'p-'+crypto.randomUUID(),sessionCredential:'v1:test',expiresAt:Date.now()+600000}};}
 if(method==='presenceLeave'){native.presence.push({method});return{};}
 if(method==='presenceUpdate'||method==='presenceRead')return{epoch:1,presence:[]};
 return fail('Unsupported '+method,'unsupported');}
const root=process.cwd();await symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'));
await writeFile(path.join(dir,'entry.tsx'),`
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';import{CollaborativeVaultEditor}from'${root}/src/local-vault/CollaborativeVaultEditor';import{setVaultTransport,VaultError}from'${root}/src/local-vault/bridge';import '${root}/src/local-vault/style.css';
window.calls=[];
setVaultTransport(async(method,params)=>{window.calls.push(method);const result=await (window as any).vaultCall(method,params);if(result&&result.__error)throw new VaultError(result.__error.message,result.__error.code);return result;});
const initial=${JSON.stringify(file)};
createRoot(document.getElementById('root')!).render(<React.StrictMode><div className="vault-app"><CollaborativeVaultEditor initial={initial} root="/shared" startEditing config={{namespace:'https://relay.test',workspaceId:'${workspaceId}',itemId:'${itemId}',localFiles:true}} registerFlush={()=>{}} onChanged={()=>{}} onRemoved={()=>{}}/></div></React.StrictMode>);
`);
await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(process.env.EPOCH_DEBUG)console.log('[page]',m.text());});
const dump=async()=>{console.log('STATE',JSON.stringify(await state()),'calls',JSON.stringify(await page.evaluate(()=>window.calls.slice(-30))),'checkpoints',JSON.stringify(native.checkpoints.map(c=>({...c,recovery:c.recovery&&{...c.recovery,update:'…'}}))),'pushes',JSON.stringify(native.pushes));};
await page.exposeFunction('vaultCall',vaultCall);
await page.route('https://adoption.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://adoption.test');await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});
const body=page.getByLabel('Document body');await body.waitFor();
const waitState=(state,timeout=15000)=>page.waitForFunction(s=>document.querySelector('[data-collaboration-item="item-1"]')?.getAttribute('data-collaboration-state')===s,state,{timeout});
await waitState('ready');
await body.click();await page.keyboard.press('End');
await page.evaluate(()=>{document.querySelector('[aria-label="Document body"]').__adoption='mounted';});
var state=()=>page.evaluate(()=>{const el=document.querySelector('[aria-label="Document body"]');const sel=window.getSelection();let caret=null;if(el&&sel&&sel.rangeCount&&el.contains(sel.anchorNode)){const r=document.createRange();r.setStart(el,0);r.setEnd(sel.anchorNode,sel.anchorOffset);caret=r.toString().length;}
 return{marked:el?.__adoption??null,focused:document.activeElement===el,text:el?.innerText.replace(/\\n$/,'')??null,caret,status:document.querySelector('[data-collaboration-item="item-1"]')?.getAttribute('data-collaboration-state'),notice:document.querySelector('.vault-notice')?.innerText??''};});
// Hold the normal upload, so " local" is pending when the file is replaced outside TextText.
let releaseNormal;holdNormalPush=new Promise(r=>{releaseNormal=r;});
await page.keyboard.type(' local');
await page.waitForFunction(()=>window.calls.filter(c=>c==='collaborationPush').length>=1,null,{timeout:10000});
// Arm the recovery hold before the outside replacement: the long poll may notice the new epoch before the held upload fails.
let releaseRecovery;holdRecoveryPush=new Promise(r=>{releaseRecovery=r;});const recoveryStarted=new Promise(r=>{recoveryPushSeen=r;});
const epochBefore=await serverEpoch();const replaced=await readVaultTextpack(location);
await writeVaultTextpack({...location,relativePath,operationId:'outside-1',baseRevision:replaced.revision,bytes:pack('Hello remote',{'opaque.bin':new Uint8Array([1])})});
assert.equal(await serverEpoch(),epochBefore+1,'outside replacement starts a new epoch');
// Edits typed while the recovery push is in flight are the "late" edits adoption must carry.
releaseNormal();holdNormalPush=null;
await Promise.race([recoveryStarted,new Promise((_,reject)=>setTimeout(()=>reject(new Error('recovery push never arrived')),15000))]).catch(async e=>{await dump();throw e;});
await page.waitForTimeout(500);// past the 400 ms undo coalescing window: " late" is its own step
await page.keyboard.type(' late');for(let i=0;i<5;i+=1)await page.keyboard.press('ArrowLeft');
let s=await state();assert.equal(s.text,'Hello local late');assert.equal(s.caret,11,'caret before adoption: '+JSON.stringify(s));
// The relay drops the first recovery push: the client backs off and replays the same persisted intent.
native.failRecoveryPushes=1;
releaseRecovery();holdRecoveryPush=null;
await page.waitForFunction(()=>document.querySelector('[aria-label="Document body"]')?.innerText.includes('remote'),null,{timeout:15000}).catch(async e=>{await dump();throw e;});
await page.waitForTimeout(100);
s=await state();
assert.deepEqual({marked:s.marked,focused:s.focused,text:s.text,caret:s.caret},{marked:'mounted',focused:true,text:'Hello remote local late',caret:18},'adoption rebinds without remount, keeps focus, maps the caret past the merged remote text: '+JSON.stringify(s));
assert.equal(await serverEpoch(),epochBefore+1);
await waitState('ready');
const recoveryPushes=native.pushes.filter(p=>p.recovery);
assert.equal(recoveryPushes.length,2,'the dropped recovery push was replayed: '+JSON.stringify(native.pushes));
assert.ok(recoveryPushes[0].failed&&recoveryPushes[0].operationId===recoveryPushes[1].operationId,'replay reuses the persisted operation: '+JSON.stringify(native.pushes));
const adopted=native.checkpoints.filter(c=>c.epoch===epochBefore+1);
assert.ok(adopted.some(c=>c.authorized&&c.recovery?.adopted),'the adoption checkpoint carried the proven intent: '+JSON.stringify(native.checkpoints));
const journal=JSON.parse(native.journal);assert.equal(journal.epoch,epochBefore+1);assert.equal(journal.recovery,undefined,'intent cleared only after the native checkpoint succeeded');
assert.ok(native.checkpoints.every(c=>c.epoch===epochBefore||c.epoch===epochBefore+1));
// Awareness followed the document: presence left on the old client ID and joined with the new one.
await page.waitForFunction(()=>window.calls.filter(c=>c==='presenceJoin').length>=2,null,{timeout:10000});
const joins=native.presence.filter(p=>p.method==='presenceJoin').map(p=>p.clientId);
assert.equal(new Set(joins).size,2,'presence rejoined with the replacement document identity: '+JSON.stringify(native.presence));
assert.ok(native.presence.some(p=>p.method==='presenceLeave'),'old presence left');
// Undo crosses the adoption: the live step first, then the captured step, never the remote edit.
const undo=process.platform==='darwin'?'Meta+z':'Control+z',redo=process.platform==='darwin'?'Meta+Shift+z':'Control+y';
await page.keyboard.press(undo);await page.waitForTimeout(50);s=await state();assert.equal(s.text,'Hello remote local','undo the late edit: '+JSON.stringify(s));
await page.keyboard.press(undo);await page.waitForTimeout(50);s=await state();assert.deepEqual({text:s.text,caret:s.caret,marked:s.marked},{text:'Hello remote',caret:12,marked:'mounted'},'undo the pending edit captured on the old document, keeping the remote edit: '+JSON.stringify(s));
await page.keyboard.press(undo);await page.waitForTimeout(50);s=await state();assert.equal(s.text,'Hello remote','nothing older to undo: '+JSON.stringify(s));
await page.keyboard.press(redo);await page.waitForTimeout(50);s=await state();assert.equal(s.text,'Hello remote local','redo the captured step: '+JSON.stringify(s));
await page.keyboard.press(redo);await page.waitForTimeout(50);s=await state();assert.equal(s.text,'Hello remote local late','redo the live step: '+JSON.stringify(s));
await page.keyboard.press(undo);await page.waitForTimeout(50);await page.keyboard.press('End');await page.keyboard.type(' typed');
s=await state();assert.equal(s.text,'Hello remote local typed');
await page.keyboard.press(redo);await page.waitForTimeout(50);s=await state();assert.equal(s.text,'Hello remote local typed','a new edit ends every redo path: '+JSON.stringify(s));
// Everything converges on the server in the adopted epoch, with a clean native journal.
for(let i=0;i<100&&await serverBody()!=='Hello remote local typed';i+=1)await new Promise(r=>setTimeout(r,100));
assert.equal(await serverBody(),'Hello remote local typed');assert.equal(await serverEpoch(),epochBefore+1);
await waitState('ready');
for(let i=0;i<100&&JSON.parse(native.journal).pending.length;i+=1)await new Promise(r=>setTimeout(r,100));
const finalJournal=JSON.parse(native.journal);assert.equal(finalJournal.epoch,epochBefore+1);assert.deepEqual(finalJournal.pending,[]);assert.equal(finalJournal.batch,null);
s=await state();assert.equal(s.marked,'mounted','the editor never remounted');
// A second replacement whose adoption checkpoint fails natively: fail closed, intent retained, nothing lost.
holdNormalPush=new Promise(r=>{releaseNormal=r;});
await page.keyboard.press('End');await page.keyboard.type(' more');
await page.waitForFunction(n=>window.calls.filter(c=>c==='collaborationPush').length>n,await page.evaluate(()=>window.calls.filter(c=>c==='collaborationPush').length),{timeout:10000});
const second=await readVaultTextpack(location);
await writeVaultTextpack({...location,relativePath,operationId:'outside-2',baseRevision:second.revision,bytes:pack('Hello remote local typed outside',{'opaque.bin':new Uint8Array([2])})});
native.failCheckpoints=1;releaseNormal();holdNormalPush=null;
await waitState('error');
s=await state();assert.ok(s.notice.includes('reopened'),'fail closed asks to reopen: '+JSON.stringify(s));
const failed=native.checkpoints.filter(c=>c.epoch===epochBefore+2);
assert.ok(failed.length===1&&failed[0].failed&&failed[0].authorized,'exactly one adoption checkpoint was attempted and failed: '+JSON.stringify(failed));
const retained=JSON.parse(native.journal);const lastRecovery=native.pushes.filter(p=>p.recovery).at(-1);
assert.equal(retained.epoch,epochBefore+1,'the native journal stays on the old epoch');
assert.deepEqual({operationId:retained.recovery?.operationId,adopted:retained.recovery?.adopted},{operationId:lastRecovery.operationId,adopted:undefined},'the unadopted intent that the server already committed is retained for native adoption on reopen');
assert.equal(await serverBody(),'Hello remote local typed outside more','the server committed the recovery; the intent waits for its native adoption');
assert.deepEqual(errors,[]);
console.log('PASS live epoch adoption: pending and late edits recovered into the replaced epoch through the real client and store; body element, focus and mapped caret kept; awareness rejoined; undo crossed the adoption without discarding the remote edit; dropped recovery push replayed with the same intent; journal clean; a failed native adoption checkpoint fails closed with the intent retained.');
}finally{await browser?.close();await rm(dir,{recursive:true,force:true});await rm(vault,{recursive:true,force:true});}
