import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildLocalVault} from '../../../scripts/build-local-vault.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'texttext-long-reader-'));let browser;
try {
 const root=process.cwd();await symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'));
 await writeFile(path.join(dir,'entry.tsx'),`
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import ReactMarkdown from 'react-markdown';import remarkGfm from 'remark-gfm';
import{VaultNoteDisplay}from'${root}/src/local-vault/VaultNoteDisplay';import{emptyDocumentSnapshot}from'${root}/src/lib/documents/model';import{getBuiltinTemplate}from'${root}/src/lib/presentation/templates';import'${root}/src/local-vault/style.css';
const app=createRoot(document.getElementById('root'));const body=('One careful paragraph about a file library, its notes, reading, and images.\\n').repeat(7300);window.body=body;
window.render=async(mode)=>{flushSync(()=>app.render(null));const start=performance.now();const doc=emptyDocumentSnapshot();doc.content.title='Long note';doc.content.body=body;flushSync(()=>app.render(mode==='baseline'?<ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>:<VaultNoteDisplay document={doc} template={getBuiltinTemplate('texttext.note')} onEdit={()=>window.edited=true}/>));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start;};
`);
 await buildLocalVault({entry:path.join(dir,'entry.tsx'),output:dir});browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://reader.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://reader.test/');await page.addStyleTag({content:await readFile(path.join(dir,'app.css'),'utf8')});await page.addScriptTag({content:await readFile(path.join(dir,'app.js'),'utf8')});
 const baseline=await page.evaluate(()=>window.render('baseline'));const timings=[];
 for(const theme of ['light','dark']){await page.emulateMedia({colorScheme:theme});timings.push(await page.evaluate(()=>window.render('reader')));assert.equal(await page.locator('.tt-prose[data-tt-bind="content.body"]').textContent(),await page.evaluate(()=>window.body.slice(0,-1)));await page.getByRole('button',{name:'Edit card'}).click();assert.equal(await page.evaluate(()=>window.edited),true);}
 assert.deepEqual(errors,[]);assert.ok(Math.max(...timings)<baseline*.6,`Reader ${timings} should remove tokenizer hotspot, baseline ${baseline}`);console.log(JSON.stringify({baselineMs:baseline,readerMs:timings,fullContent:true,editAction:true,themes:['light','dark']}));
} finally {await browser?.close();await rm(dir,{recursive:true,force:true});}
