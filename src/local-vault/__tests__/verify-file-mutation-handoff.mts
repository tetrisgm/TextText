// Production editor/session/owner with disposable controlled transport. No installed app or account.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { chromium } from "playwright";
import { buildLocalVault } from "../../../scripts/build-local-vault.mjs";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { seedVaultCollaboration, applyVaultCollaboration } from "@/sync/engine/collaboration";
import { openPack } from "../pack";

const flags = new Set(process.argv.slice(2));
for (const flag of flags) assert.ok(["--hosted", "--write-failure", "--unknown-write", "--template", "--app-shortcuts", "--held-ready", "--switch-at-read", "--unmount-at-read", "--recovery", "--copy-failure", "--read-failure"].includes(flag));
const localFiles = !flags.has("--hosted"), itemId = "owned-mutation", root = "/isolated/mutation";
const config = { namespace: "https://mutation.test", workspaceId: "owned-workspace", accountId: "owned-account", itemId, localFiles };
const document = emptyDocumentSnapshot(flags.has("--template") ? {id:"texttext.article",version:1} : undefined); document.content.title = "Owned mutation"; document.content.body = "Original";
const files: Record<string, Uint8Array> = {};
function pack(markdown: string, documentJSON: string, templateJSON?: string, filePath = "Owned.textpack") {
  const bytes = buildTextpack("Owned", { markdown, document: JSON.parse(documentJSON), files, ...(templateJSON ? { template: JSON.parse(templateJSON) } : {}) });
  return { bytes, file: openPack(bytes, filePath, createHash("sha256").update(bytes).digest("hex")).file };
}
let current = pack(`---\ntextTextId: ${itemId}\n---\n\nOriginal`, JSON.stringify(document));
const otherDocument=emptyDocumentSnapshot();otherDocument.content.title="Other selected";otherDocument.content.body="Other safe body";
let other=pack("---\ntextTextId: other-item\n---\n\nOther safe body",JSON.stringify(otherDocument),undefined,"Other.textpack");
const otherState=seedVaultCollaboration(other.bytes,"other-item",1);
let readFailure=false;
let heldRead=false,releaseRead!:()=>void;const readGate=new Promise<void>(r=>{releaseRead=r;});const openItems:string[]=[];
let state = seedVaultCollaboration(current.bytes, itemId, 1), remoteBytes = current.bytes;
let creates = 0, exists = false, failCheckpoint = false, recoveries = 0;
let recovered: ReturnType<typeof pack> | null = null;
let token: string | null = null, journal: string | null = null, opens = 0, closes = 0, writes = 0, closedCallbacks = 0;
let heldReady = false, releaseReady!: () => void; const readyGate = new Promise<void>(r=>{releaseReady=r;});
let heldWrite = false, releaseWrite!: () => void; const writeGate = new Promise<void>(r => { releaseWrite = r; });
const events: string[] = [], errors: string[] = [], transportErrors: string[] = [];
const dir = await mkdtemp(path.join(tmpdir(), "texttext-file-mutation-controlled-"));
const entry = path.join(dir, "entry.tsx"), output = path.join(dir, "ui");
const sourceRoot = path.resolve(".");
const rendered = flags.has("--app-shortcuts") ? "<VaultApp/>" : `<CollaborativeVaultEditor initial={selectedInitial} root=${JSON.stringify(root)} config={selectedConfig} startEditing registerFlush={f=>window.fixtureFlush=f} onChanged={()=>{}} onRemoved={()=>{}}/>`;
await writeFile(entry, `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{CollaborativeVaultEditor}from ${JSON.stringify(path.join(sourceRoot,"src/local-vault/CollaborativeVaultEditor"))};
import{VaultApp}from ${JSON.stringify(path.join(sourceRoot,"src/local-vault/VaultApp"))};
import{setVaultTransport}from ${JSON.stringify(path.join(sourceRoot,"src/local-vault/bridge"))};
import{acquireVaultDocument}from ${JSON.stringify(path.join(sourceRoot,"src/local-vault/document-session"))};
const config=${JSON.stringify(config)},initial=${JSON.stringify(current.file)},otherInitial=${JSON.stringify(other.file)};
setVaultTransport((m,p)=>window.fixtureRequest(m,p));
window.tryCompeting=()=>{try{const h=acquireVaultDocument(config,initial,${JSON.stringify(root)});void h.release();return 'ACQUIRED'}catch(e){return e.message}};
const mount=createRoot(document.getElementById('root'));
window.fixtureUnmount=()=>{mount.unmount();document.getElementById('root').textContent='Unmounted safe view'};
function Fixture(){const[other,setOther]=useState(false);window.fixtureSwitch=()=>setOther(true);const selectedInitial=other?otherInitial:initial,selectedConfig=other?{...config,itemId:'other-item'}:config;return ${rendered};}
mount.render(<Fixture/>);`);
await symlink(path.join(sourceRoot,"node_modules"),path.join(dir,"node_modules"));
await buildLocalVault({ entry, output });
const browser = await chromium.launch({headless:true});
const until = async (f:()=>boolean,label:string) => { for(let i=0;i<160;i++){if(f())return;await wait(50);}throw Error("Timed out: "+label); };
scenario: { try {
  const page = await browser.newPage(); page.setDefaultTimeout(8000); page.on("pageerror",e=>errors.push(e.message));
  // Exposed function uses normal transport replies; no expected editor state is injected.
  await page.exposeFunction("fixtureRpc", async(method:string,p:any) => {
    events.push(method);
    if(method==="fixtureFailCheckpoint"){failCheckpoint=true;return {};}
    if(method==="collaborationOpen") { openItems.push(p.itemId);token="native-"+(++opens);if(p.itemId==="other-item")return {sessionToken:token,path:other.file.path,hash:other.file.hash,projectedHash:other.file.hash,acknowledgedRevision:otherState.revision,journal:null,retiredReason:null}; return {sessionToken:token,path:current.file.path,hash:current.file.hash,projectedHash:current.file.hash,acknowledgedRevision:state.revision,journal,retiredReason:null,capabilities:["epoch-adoption"]}; }
    if(method==="collaborationClose") { assert.equal(p.sessionToken,token);token=null;closes++;return {}; }
    if(method==="collaborationRead") { if(p.itemId==="other-item")return {...otherState,relativePath:other.file.path,canEditContent:true,canComment:true}; if(flags.has("--held-ready")&&opens===2&&!heldReady){heldReady=true;await readyGate;} if(p.waitMs) await wait(80);return {...state,relativePath:current.file.path,canEditContent:true,canComment:true}; }
    if(method==="collaborationPush") { const next=applyVaultCollaboration(state,remoteBytes,p.updates);state=next.state;remoteBytes=next.bytes;return {status:"written",revision:state.revision}; }
    if(method==="collaborationCheckpoint") { if(failCheckpoint)throw Error("Controlled checkpoint refusal"); if(p.itemId==="other-item"){other=pack(p.markdown,p.documentJSON,undefined,"Other.textpack");return {path:other.file.path,hash:other.file.hash};} if(p.sessionToken!==token){closedCallbacks++;throw Object.assign(Error("The local shared file session has closed. Your journal is kept."),{code:"session_closed"});}assert.equal(p.hash,current.file.hash);current=pack(p.markdown,p.documentJSON,current.file.templateJSON??undefined);journal=p.journal;return {path:current.file.path,hash:current.file.hash}; }
    if(method==="read"||method==="preview") {
      if(p.path==="Other.textpack")return other.file;
      if(p.path==="Recovered.textpack")return recovered!.file;
      if(flags.has("--read-failure")&&writes===1&&!readFailure){readFailure=true;throw Error("Controlled reopen read refusal");}
      const captured=current.file;
      if(writes===1&&!heldRead&&(flags.has("--switch-at-read")||flags.has("--unmount-at-read"))){heldRead=true;await readGate;}
      return captured;
    }
    if(method==="list")return {root,folders:["Notes"],items:exists?[{path:current.file.path}]:[]};
    if(method==="connection")return {connected:true,available:true,workspaceId:config.workspaceId,webURL:"https://mutation.test/vault/owned"};
    if(method==="accountRead")return {accountId:config.accountId,email:"owned@example.invalid"};
    if(method==="workspaceAccess")return {fullAccess:true,isOwner:true,canEditContent:true,canComment:true,canManageShares:true,grants:[]};
    if(method==="folderViews")return {files:[]};
    if(method==="collaborationConfig")return config;
    if(method==="create"||method==="importPack"){
      exists=true;creates++;
      if(String(p.title).endsWith("(recovered)")){const d=emptyDocumentSnapshot();d.content.title=p.title;recovered=pack('---\ntextTextId: recovered-item\n---\n\n',JSON.stringify(d),undefined,'Recovered.textpack');return recovered.file;}
      return current.file;
    }
    if(method==="collaborationRecover") {
      assert.equal(p.sessionToken,token);assert.equal(p.recoveryPath,recovered!.file.path);assert.equal(p.recoveryHash,recovered!.file.hash);
      token=null;journal=null;failCheckpoint=false;recoveries++;return {};
    }
    if(method==="write") {
      if(p.path==="Recovered.textpack") {
        assert.equal(p.hash,recovered!.file.hash);
        if(flags.has("--copy-failure"))throw Error("Controlled recovery copy refusal");
        recovered=pack(p.markdown,p.documentJSON,undefined,"Recovered.textpack");return recovered.file;
      }
      assert.equal(p.hash,current.file.hash);assert.equal(token,null,"native owner closed before external write");heldWrite=true;await writeGate;
      if(flags.has("--write-failure"))throw Error("Controlled CAS refusal");
      for(const asset of p.addedAssets??[])files["assets/"+asset.filename]=Buffer.from(asset.data,"base64");
      current=pack(p.markdown,p.documentJSON,p.templateJSON);writes++;state=seedVaultCollaboration(current.bytes,itemId,1);remoteBytes=current.bytes;journal=null;
      await page.evaluate(()=>window.dispatchEvent(new Event("texttext:vault-changed")));
      await wait(250);
      if(flags.has("--unknown-write"))throw Error("Controlled lost write reply");
      return current.file;
    }
    if(method.startsWith("presence"))throw Error("No presence in controlled fixture");
    if(method==="publicationRead")return {canPublish:true,revision:current.file.hash,publicURL:null};
    transportErrors.push(method);throw Error("Unexpected method "+method);
  });
  await page.addInitScript(()=>{ (window as any).fixtureRequest=(m:string,p:unknown)=>(window as any).fixtureRpc(m,p); });
  await page.goto(pathToFileURL(path.join(output,"index.html")).href);
  if(flags.has("--app-shortcuts"))await page.getByRole("button",{name:"New note",exact:true}).click();
  const body=page.getByRole("textbox",{name:"Document body",exact:true});await body.waitFor();
  await until(()=>!localFiles||opens===1,"initial native owner");
  await page.waitForFunction(()=>document.querySelector('.vault-document')?.getAttribute('data-collaboration-state')==='ready');
  if(flags.has("--recovery")||flags.has("--copy-failure")) {
    await page.evaluate(()=>(window as any).fixtureRpc('fixtureFailCheckpoint',{}));
    await body.click();await page.keyboard.press('End');await page.keyboard.type(' recovery text');
    await page.getByRole('status').filter({hasText:/needs to be reopened/}).waitFor();
    const originalHash=current.file.hash;
    await page.getByRole('button',{name:'Save a copy and reopen',exact:true}).click();
    if(flags.has("--copy-failure")) {
      await page.getByRole('status').filter({hasText:/Controlled recovery copy refusal/}).waitFor();
      assert.equal(recoveries,0);assert.equal(closes,0);assert.equal(opens,1);assert.equal(current.file.hash,originalHash);
      assert.ok((await page.locator(".vault-document").innerText()).includes("recovery text"));
    } else {
      await until(()=>recoveries===1&&opens===2,'supported recovery and original reopen');
      assert.ok(recovered);assert.ok(JSON.parse(recovered.file.documentJSON!).content.body.includes('recovery text'));
      assert.equal(closes,0,'recovery actor released native lease, no second close');
      await page.waitForFunction(()=>!(document.querySelector('.vault-document') as HTMLElement)?.inert);
      assert.equal(await page.evaluate(async()=>(window as any).fixtureFlush()),true);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(transportErrors,[]);
    await writeFile(path.join(dir,'result.json'),JSON.stringify({ok:true,flags:[...flags],recoveries,closes,opens,events},null,2));
    console.log('PASS controlled supported recovery',dir);break scenario;
  }
  if(flags.has("--template")) {
    await page.getByLabel('More actions',{exact:true}).click();
    await page.getByRole('button',{name:'Change look',exact:true}).click();
    await page.getByRole('button',{name:'Gallery',exact:true}).click();
  } else {
    await body.click();await page.keyboard.press(process.platform==='darwin'?'Meta+ArrowDown':'Control+End');
    await body.evaluate(async element=>{
      const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;canvas.getContext('2d')!.fillRect(0,0,4,4);
      const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/png'));
      const data=new DataTransfer();data.items.add(new File([blob],'owned.png',{type:'image/png'}));
      element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    });
  }
  await until(()=>heldWrite,"external write reached");
  assert.match(await page.evaluate(()=>(window as any).tryCompeting()),/finishing a save/);
  assert.equal(await page.locator('.vault-document').evaluate(e=>(e as HTMLElement).inert),true);
  const before=JSON.parse(current.file.documentJSON!);
  await page.keyboard.type('nabc');
  assert.deepEqual(JSON.parse(current.file.documentJSON!),before,"inert interval accepted no new input");
  if(flags.has("--app-shortcuts"))assert.equal(creates,1,"trusted bare n did not dispatch actual VaultApp New note");
  releaseWrite();
  if(flags.has("--read-failure")) {
    await page.getByRole('status').filter({hasText:/Could not reopen the saved file/}).waitFor();
    assert.equal(opens,1);assert.equal(await body.count(),0,"no destroyed editor restored after failed reopen");
    assert.equal(await page.locator('.vault-document').evaluate(e=>(e as HTMLElement).inert),false);
    await page.getByRole('button',{name:'Reopen file',exact:true}).click();
  }
  if(flags.has("--switch-at-read")||flags.has("--unmount-at-read")) {
    await until(()=>heldRead,"authoritative reopen read held");
    if(flags.has("--switch-at-read")) {
      await page.evaluate(()=>(window as any).fixtureSwitch());
      await page.getByRole("textbox",{name:"Title",exact:true}).waitFor();
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('textarea,input')).some(e=>(e as HTMLInputElement).value==='Other selected'));
    } else await page.evaluate(()=>(window as any).fixtureUnmount());
    releaseRead();await wait(350);
    if(flags.has("--switch-at-read")) {
      assert.equal(await page.getByRole('textbox',{name:'Title',exact:true}).inputValue(),'Other selected');
      assert.equal(JSON.parse(other.file.documentJSON!).content.body,'Other safe body');
      assert.deepEqual(openItems,[itemId,'other-item']);
    } else {assert.equal(await page.locator('#root').innerText(),'Unmounted safe view');assert.deepEqual(openItems,[itemId]);}
    assert.equal(closedCallbacks,0);assert.deepEqual(errors,[]);
    await writeFile(path.join(dir,'result.json'),JSON.stringify({ok:true,flags:[...flags],openItems,writes,closedCallbacks,events},null,2));
    console.log('PASS controlled stale reopen',dir);break scenario;
  }
  if(flags.has("--held-ready")) {
    await until(()=>heldReady,"replacement baseline held");
    assert.equal(await page.locator('.vault-document').evaluate(e=>(e as HTMLElement).inert),true);
    await page.keyboard.type('nabc');assert.equal(creates,1,"no actual VaultApp bare-n dispatch while replacement opens");
    releaseReady();
  }
  await until(()=>localFiles?opens===2:events.filter(x=>x==='collaborationRead').length>=2,"new owner opening");
  await page.waitForFunction(()=>!(document.querySelector('.vault-document') as HTMLElement)?.inert);
  if(flags.has("--write-failure")||flags.has("--unknown-write"))await page.getByRole('status').filter({hasText:/Controlled/}).waitFor();
  assert.equal(closedCallbacks,0);assert.deepEqual(errors,[]);assert.deepEqual(transportErrors,[]);
  const actual=JSON.parse(current.file.documentJSON!);
  assert.equal(actual.content.assets.length,flags.has("--write-failure")||flags.has("--template")?0:1);
  if(flags.has("--template"))assert.equal(actual.presentation.template.id,"texttext.gallery");
  assert.equal(await page.evaluate(async()=>(window as any).fixtureFlush ? (window as any).fixtureFlush() : (window as any).texttextFlushForNativeClose().then((r:any)=>r.ok)),true);
  if(flags.has("--app-shortcuts")) {
    await wait(100);
    const editableTitle=page.getByRole("textbox",{name:"Title",exact:true});await editableTitle.click();await page.keyboard.press('End');await page.keyboard.type(' after mutation');
    assert.equal(await page.evaluate(async()=>(window as any).texttextFlushForNativeClose()).then(r=>r.ok),true);
    assert.ok(JSON.parse(current.file.documentJSON!).content.title.includes('after mutation'));assert.equal(creates,1);
  }
  await writeFile(path.join(dir,'result.json'),JSON.stringify({ok:true,localFiles,writes,opens,closes,closedCallbacks,events,scope:'Controlled Chromium, production component/session/owner; not installed acceptance'},null,2));
  console.log('PASS controlled file mutation',dir);
} finally { await browser.close(); } }
