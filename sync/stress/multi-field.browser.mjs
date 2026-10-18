// Actual UnifiedDocumentEditor + readonly inspection integration fixture.
// Local mounted app/editor, no deployed/native/six-client acceptance claim.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {chromium} from 'playwright';
import {buildLocalVault} from '../../scripts/build-local-vault.mjs';
import {typeFieldSequence,checkFieldProgress} from './multi-field-input.mjs';
import {readLiveFieldDocument} from './multi-field-page.mjs';
const dir=await mkdtemp(join(tmpdir(),'texttext-live-field-editor-')),root=process.cwd();let browser;
const itemId='11111111-1111-4111-8111-111111111111',workspaceId='fixture-workspace',title='Six-client acceptance field inspection';
try {
 await symlink(join(root,'node_modules'),join(dir,'node_modules'));
 await writeFile(join(dir,'entry.tsx'),`
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';
import * as Y from '${root}/node_modules/yjs';
import{UnifiedDocumentEditor}from'${root}/src/components/document/UnifiedDocumentEditor';
import{emptyDocumentSnapshot}from'${root}/src/lib/documents/model';
import{applyDocumentSnapshot}from'${root}/src/lib/collab/document';
import{BUILTIN_TEMPLATES}from'${root}/src/lib/presentation/templates';
import{localBlog,asPost}from'${root}/src/local-vault/model';import '${root}/src/local-vault/style.css';
const snapshot=emptyDocumentSnapshot({id:'texttext.article',version:1});snapshot.content.title=${JSON.stringify(title)};snapshot.content.subtitle='Existing subtitle 日本語';snapshot.content.body='Existing body 👩‍💻';snapshot.content.fields={status:'preserve-hidden'};snapshot.content.tags=['preserve-tag'];
const doc=new Y.Doc();applyDocumentSnapshot(doc,snapshot,{kind:'fixture-initial'});const app=createRoot(document.getElementById('root'));
window.mount=(canEdit=true)=>app.render(<React.StrictMode><UnifiedDocumentEditor transport="local" localDocument={doc} blog={localBlog} post={asPost(snapshot,'fixture.textpack')} template={BUILTIN_TEMPLATES.find(t=>t.id==='texttext.article')} collab={{postId:'fixture:${workspaceId}:${itemId}',userName:'Fixture',color:'#3970c5',canEdit}} onDone={()=>{}} /></React.StrictMode>);
window.closeEditor=()=>app.unmount();window.mount();`);
 await buildLocalVault({entry:join(dir,'entry.tsx'),output:dir});
 browser=await chromium.launch({channel:'chrome',headless:true,timeout:15000});const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://field-inspection.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://field-inspection.test');
 await page.addStyleTag({content:await readFile(join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(join(dir,'app.js'),'utf8')});
 await page.getByRole('textbox',{name:'Subtitle',exact:true}).waitFor();
 const inspect=()=>page.evaluate(readLiveFieldDocument,{itemId,workspaceId,title});
 await page.waitForFunction(()=>window.texttextDocumentInspection?.read('fixture:fixture-workspace:11111111-1111-4111-8111-111111111111'));
 const initial=await inspect();assert.ok(initial);assert.equal(initial.content.fields.status,'preserve-hidden');
 await page.evaluate(()=>{const e=document.querySelector('[aria-label="Document body"]');e.__mountedFixture=true;window.inputs=[];document.addEventListener('input',event=>window.inputs.push({trusted:event.isTrusted,type:event.inputType}));});
 const role='mac-web',edits=['body','subtitle'].map(field=>({role,field,id:'r1-'+role+'-'+field,op:'append',text:'['+field+' fixture marker]'}));const progress={role,fields:[]};
 await typeFieldSequence(edits,role,{progress,snapshot:async()=>(await inspect()).content,now:()=>performance.now(),sleep:ms=>page.waitForTimeout(ms),insert:async(field,text)=>{
  if(field==='body')await page.locator('[aria-label="Document body"]').evaluate(e=>{e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);});
  else await page.getByRole('textbox',{name:'Subtitle',exact:true}).evaluate(e=>{e.focus();e.setSelectionRange(e.value.length,e.value.length);});
  await page.keyboard.insertText(text);
 }});
 assert.ok(checkFieldProgress(edits,role,progress));const final=await inspect();assert.equal(final.content.body,initial.content.body+edits[0].text);assert.equal(final.content.subtitle,initial.content.subtitle+edits[1].text);assert.deepEqual(final.content.fields,initial.content.fields);assert.deepEqual(final.content.tags,initial.content.tags);assert.deepEqual(final.presentation,initial.presentation);
 assert.equal(await page.evaluate(()=>document.querySelector('[aria-label="Document body"]').__mountedFixture),true);
 const events=await page.evaluate(()=>window.inputs);assert.equal(events.length,2);assert.ok(events.every(event=>event.trusted));
 const scope='fixture:'+workspaceId+':'+itemId;
 await page.evaluate(key=>{const copy=window.texttextDocumentInspection.read(key);copy.content.body='detached mutation';},scope);assert.equal((await inspect()).content.body,final.content.body);
 await page.evaluate(()=>window.mount(false));await page.waitForFunction(key=>window.texttextDocumentInspection.read(key)===null,scope);
 await page.evaluate(()=>window.closeEditor());assert.equal(await page.evaluate(key=>window.texttextDocumentInspection.read(key),scope),null);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({kind:'actual-editor-browser-fixture',acceptance:'none',browserVersion:browser.version(),progress,inputEvents:events.length,detachedRead:true,permissionCleanup:true,unmountCleanup:true,passed:true,fixtureDirectory:dir}));
} finally {await browser?.close();}
