import assert from "node:assert/strict";
import { mkdtemp,readFile,writeFile,symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { buildLocalVault } from "../../../scripts/build-local-vault.mjs";
const dir=await mkdtemp(path.join(tmpdir(),"texttext-workspace-access-"));
const root=process.cwd();await symlink(path.join(root,"node_modules"),path.join(dir,"node_modules"));
await writeFile(path.join(dir,"entry.tsx"),`
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';
import{VaultApp}from'${root}/src/local-vault/VaultApp';import{setVaultTransport}from'${root}/src/local-vault/bridge';import{emptyDocumentSnapshot}from'${root}/src/lib/documents/model';
const workspaceId='11111111-1111-4111-8111-111111111111',itemId='22222222-2222-4222-8222-222222222222',path='Shared/Field notes.textpack';
const doc=emptyDocumentSnapshot({id:'texttext.note',version:1});doc.content.title='Field notes';doc.content.body='Keep this note.';
const file={path,hash:'file-1',markdown:'---\\ntextTextId: '+itemId+'\\n---\\nKeep this note.',documentJSON:JSON.stringify(doc)};
window.workspaceId=workspaceId;window.role='owner';window.accountId='account-a';window.calls=[];window.accessReads=0;window.holdNextAccess=false;
const native=new URL(location.href).searchParams.get('host')!=='web';
setVaultTransport(async(method,params)=>{
 window.calls.push(method);
 const workspaceId=window.workspaceId;
 const owner=window.role==='owner',editor=owner||window.role==='editor';
 if(method==='list')return{root:native?'/fixture/My notes/'+workspaceId:'vault:'+workspaceId,name:'My notes',folders:['Shared'],items:[{path,itemId,canEditContent:editor}],fullAccess:owner,canCreateContent:owner,writableFolders:editor?['Shared']:[]};
 if(method==='workspaceAccess'){window.accessReads++;const value={fullAccess:owner,isOwner:owner,canManageShares:owner,canEditContent:owner,canComment:owner,grants:owner?[]:[{scopeType:'folder',scopeKey:'Shared',role:window.role}]};if(window.holdNextAccess){window.holdNextAccess=false;return new Promise(resolve=>window.releaseAccess=()=>resolve(value));}return value;}
 if(method==='folderViews'||method==='templates')return{files:[]};
 if(method==='connection')return{connected:true,available:true,onlineReady:true,workspaceId,accountId:window.accountId,webURL:'https://texttext.app/vault/'+workspaceId};
 if(method==='accountRead')return{email:'alex@example.test',name:'Alex',identities:[],workspaceName:'My notes'};
 if(method==='read')return file;
 if(method==='preview')return{title:'Field notes',excerpt:'Keep this note.',document:doc};
 if(method==='collaborationConfig')return null;
 if(method==='publicationRead')return{canPublish:owner,revision:'file-1'};
 if(method==='shareList')return{grants:[]};
 if(method==='commentsRead')return{comments:[{id:'33333333-3333-4333-8333-333333333333',parentId:null,body:'A useful comment',authorUserId:'account-a',authorName:'Alex',authorActorType:'human',createdAt:'2026-10-17T12:00:00Z',updatedAt:'2026-10-17T12:00:00Z',resolvedAt:null,resolvedByUserId:null,resolvedByActorType:null}],nextCursor:null,revision:'comments-1'};
 throw Error('Unexpected method '+method);
});
window.setRole=role=>{window.role=role;window.dispatchEvent(new Event('texttext:vault-changed'));};
createRoot(document.getElementById('root')).render(<VaultApp allowFolderPicker={native}/>);
`);
await buildLocalVault({entry:path.join(dir,"entry.tsx"),output:dir});
const browser=await chromium.launch();const results=[];
try {
 for(const host of ["native","web"]){
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(7000);
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.route(/^https:/,route=>route.fulfill({contentType:"text/html",body:'<!doctype html><body style="margin:0"><div id="root"></div></body>'}));
  await page.goto(`https://workspace.test/vault/11111111-1111-4111-8111-111111111111?host=${host}`);
  await page.addStyleTag({content:await readFile(path.join(dir,"app.css"),"utf8")});await page.addScriptTag({content:await readFile(path.join(dir,"app.js"),"utf8")});
  await page.waitForFunction(()=>window.accessReads>0);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent("texttext:vault-open",{detail:{path:"Shared/Field notes.textpack"}})));
  await page.getByRole("button",{name:"Share",exact:true}).click();
  await page.getByLabel("Email address",{exact:true}).fill("invitee@example.test");
  const beforeStatus=await page.evaluate(()=>window.accessReads);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent("texttext:vault-sync-status",{detail:{available:true,onlineReady:true}})));
  await page.waitForFunction(before=>window.accessReads>before,beforeStatus);
  assert.equal(await page.getByLabel("Email address",{exact:true}).inputValue(),"invitee@example.test");
  await page.getByRole("button",{name:"Close sharing",exact:true}).click();
  await page.getByRole("button",{name:"Comments",exact:true}).click();
  await page.getByText("A useful comment",{exact:true}).waitFor();
  for(const role of ["owner","viewer","commenter","editor"]){
   const before=await page.evaluate(()=>window.accessReads);
   await page.evaluate(role=>window.setRole(role),role);await page.waitForFunction(before=>window.accessReads>before,before);
   await page.waitForFunction(role=>{
    const panel=document.querySelector('#vault-comments-panel');
    return Boolean(panel?.querySelector('textarea'))===(role!=='viewer');
   },role);
   const snapshot={role,share:await page.getByRole('button',{name:'Share',exact:true}).count(),comment:await page.getByLabel('Add a comment',{exact:true}).count(),resolve:await page.getByRole('button',{name:'Resolve',exact:true}).count()};
   assert.deepEqual(snapshot,{role,share:role==='owner'?1:0,comment:role==='viewer'?0:1,resolve:role==='owner'||role==='editor'?1:0});results.push({host,...snapshot});
  }
  await page.getByLabel('Add a comment',{exact:true}).fill('Keep this pending comment through reconnect.');
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
  await page.getByLabel('Add a comment',{exact:true}).waitFor({state:'detached'});
  assert.equal(await page.locator('#vault-comments-panel').count(),1);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.locator('#vault-comments-panel textarea').waitFor();
  assert.equal(await page.locator('#vault-comments-panel textarea').inputValue(),'Keep this pending comment through reconnect.');
  await page.locator('#vault-comments-panel').getByRole('button',{name:'Close comments',exact:true}).click();
  await page.evaluate(()=>window.setRole('owner'));
  await page.getByRole('button',{name:'Share',exact:true}).waitFor();
  await page.getByRole('button',{name:'Share',exact:true}).click();
  await page.getByLabel('Email address',{exact:true}).fill('old-workspace@example.test');
  const beforeWorkspace=await page.evaluate(()=>window.accessReads);
  await page.evaluate(()=>{window.workspaceId='44444444-4444-4444-8444-444444444444';window.dispatchEvent(new Event('texttext:vault-changed'));});
  await page.waitForFunction(before=>window.accessReads>before,beforeWorkspace);
  await page.getByRole('button',{name:'Share',exact:true}).waitFor();
  assert.equal(await page.locator('.vault-sharing-dialog').count(),0);
  if(host==='native') {
   await page.getByRole('button',{name:'Comments',exact:true}).click();
   await page.getByLabel('Add a comment',{exact:true}).waitFor();
   await page.evaluate(()=>window.setRole('owner'));
   await page.waitForFunction(()=>Array.from(document.querySelectorAll('.vault-context-actions>button')).some(button=>button.textContent==='Share'));
   await page.evaluate(()=>{window.holdNextAccess=true;window.dispatchEvent(new Event('focus'));});
   await page.waitForFunction(()=>typeof window.releaseAccess==='function');
   const reads=await page.evaluate(()=>window.accessReads);
   await page.evaluate(()=>{window.accountId='account-b';window.role='viewer';window.dispatchEvent(new CustomEvent('texttext:vault-sync-status',{detail:{available:true,onlineReady:true}}));});
   await page.waitForFunction(reads=>window.accessReads>reads,reads);
   await page.locator('#vault-comments-panel textarea').waitFor({state:'detached'});
   await page.evaluate(async()=>{window.releaseAccess();for(let n=0;n<12;n++)await Promise.resolve();});
   assert.equal(await page.getByRole('button',{name:'Share',exact:true}).count(),0);
   assert.equal(await page.locator('#vault-comments-panel textarea').count(),0);
  }
  assert.equal(await page.evaluate(()=>window.calls.some(method=>['write','commentsAdd','commentsResolve','shareInvite'].includes(method))),false);
  assert.deepEqual(errors,[]);await page.close();
 }
 assert.deepEqual(results.filter(row=>row.host==='native').map(({host,...value})=>value),results.filter(row=>row.host==='web').map(({host,...value})=>value));
 console.log('PASS production VaultApp web/native capability parity: owner/viewer/commenter/editor Share/comment/Resolve controls match; no writes; comment survives offline/reconnect; Share draft survives routine status and closes on workspace replacement; stale account reply rejected.');
}finally{await browser.close();}
