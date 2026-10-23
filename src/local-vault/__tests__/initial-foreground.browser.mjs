import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
// Production React lifecycle with controlled transport; not installed acceptance.
const output = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {VaultApp} from './src/local-vault/VaultApp';
import {setVaultTransport} from './src/local-vault/bridge';
import {emptyDocumentSnapshot} from './src/lib/documents/model';
const mode=window.fixtureMode;
window.terminals=0;window.addEventListener('texttext:initial-view-terminal',()=>window.terminals++);
const document=emptyDocumentSnapshot({id:'texttext.note',version:1});document.content.title='Exact startup';document.content.body='Exact body';
if(mode==='feed')document.content.fields={texttextFeedSubscription:1,feedUrl:'https://example.com/feed'};
if(mode==='feed-error')document.content.fields={texttextFeedSubscription:99};
const file={path:'Notes/Initial.textpack',hash:'hash',markdown:'---\\ntextTextId: "initial-note"\\n---\\nExact body',documentJSON:JSON.stringify(document)};
if(mode!=='home'&&mode!=='list-error')localStorage.setItem('texttext:vault-location:C:/Fixture',JSON.stringify({folder:'Notes',path:file.path}));
setVaultTransport(async(method)=>{
 if(method==='list'){if(mode==='list-error')throw Error('Listing unavailable');return{root:'C:/Fixture',name:'Fixture',folders:['Notes'],items:mode==='home'?[]:[{itemId:'initial-note',path:file.path}],fullAccess:true,canCreateContent:true};}
 if(method==='read'){if(mode==='read-error')throw Error('Read unavailable');return file;}
 if(method==='collaborationConfig'){if(mode==='config-error')throw Error('Configuration unavailable');if(mode==='pending')return new Promise(()=>{});return null;}
 if(method==='workspaceAccess')return {fullAccess:true,isOwner:true,canEditContent:true,canComment:true,canManageShares:true,grants:[]};
 if(method==='folderViews'||method==='templates')return{files:[]};
 if(method==='readFeedEntries'||method==='keptFeedEntries')return{items:[]};
 return null;
});
createRoot(window.document.getElementById('root')).render(<VaultApp/>);
`},bundle:true,write:false,outdir:'unused',jsx:'automatic',loader:{'.css':'empty','.jpg':'dataurl','.png':'dataurl','.svg':'dataurl'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'local-components',setup(b){for(const [name,file] of [['ParticipantsRow','LocalParticipants.tsx'],['WorkspaceTypeLibrary','LocalTemplateLibrary.tsx'],['CommandLayer','LocalKeyboard.ts']])b.onResolve({filter:new RegExp('(?:^|/)'+name+'$')},()=>({path:path.join(process.cwd(),'src/local-vault',file)}));}}]});
const browser=await chromium.launch({headless:true});
try{for(const mode of ['home','local','list-error','read-error','config-error','feed','feed-error','pending']){
 const page=await browser.newPage();await page.route('https://startup.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://startup.test');await page.evaluate(mode=>window.fixtureMode=mode,mode);await page.addScriptTag({content:output.outputFiles.find(f=>f.path.endsWith('.js')).text});
 if(mode==='pending'){await page.getByText('Opening document', {exact:false}).first().waitFor();assert.equal(await page.evaluate(()=>window.terminals),0);}
 else await page.waitForFunction(()=>window.terminals>0,{},{timeout:5000});
 console.log('PASS initial renderer '+mode);await page.close();
}}finally{await browser.close();}
