import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";

const fixture = await build({ stdin: { contents: `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DocumentBoundary} from './src/local-vault/DocumentBoundary';
function Editor({broken}) { if(broken) throw new Error('Invalid file'); return <input aria-label="Draft" defaultValue="Saved"/>; }
function App(){
 const [file,setFile]=useState({hash:'bad',broken:true});
 const [key,setKey]=useState(0);
 window.replace=(next)=>{setKey(k=>k+1);setFile(next)};
 return <DocumentBoundary key={key} revision={file.hash} reload={async signal=>{
  window.reads++; const next=window.disk;
  if(window.hold) await new Promise(resolve=>window.release=resolve);
  if(window.fail) throw new Error('Offline');
  if(!signal.aborted)setFile(next);
 }}><Editor broken={file.broken}/></DocumentBoundary>;
}
window.reads=0;window.disk={hash:'bad',broken:true};
createRoot(document.getElementById('root')).render(<App/>);
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: fixture.outputFiles[0].text });
  await page.getByRole("alert").waitFor();
  await page.evaluate(() => { window.fail=true; window.dispatchEvent(new Event('texttext:vault-changed')); });
  await page.waitForFunction(() => window.reads === 1);
  assert.match(await page.getByRole('alert').innerText(), /Invalid file/);
  await page.evaluate(() => { window.fail=false; window.disk={hash:'repaired',broken:false};window.dispatchEvent(new Event('texttext:vault-changed')); });
  await page.getByRole('textbox', { name:'Draft' }).waitFor();
  await page.getByRole('textbox', { name:'Draft' }).fill('Unsaved typing');
  await page.evaluate(() => { for(let i=0;i<10;i++)window.dispatchEvent(new Event('texttext:vault-changed')); });
  assert.equal(await page.getByRole('textbox', {name:'Draft'}).inputValue(),'Unsaved typing');
  assert.equal(await page.evaluate(()=>window.reads),2);
  // A repair arriving during a stale read must trigger a fresh read, not vanish.
  await page.evaluate(()=>{window.disk={hash:'bad-queued',broken:true};window.replace(window.disk)});
  await page.getByRole('alert').waitFor();
  await page.evaluate(()=>{window.hold=true;window.dispatchEvent(new Event('texttext:vault-changed'));});
  await page.waitForFunction(()=>typeof window.release==='function');
  await page.evaluate(()=>{window.disk={hash:'fixed-queued',broken:false};window.dispatchEvent(new Event('texttext:vault-changed'));window.hold=false;window.release();window.release=null;});
  await page.getByRole('textbox',{name:'Draft'}).waitFor();
  assert.equal(await page.evaluate(()=>window.reads),4);
  // A read held across navigation must never replace the new document.
  await page.evaluate(()=>window.replace({hash:'bad-again',broken:true}));
  await page.getByRole('alert').waitFor();
  await page.evaluate(()=>{window.hold=true;window.dispatchEvent(new Event('texttext:vault-changed'));});
  await page.waitForFunction(()=>typeof window.release==='function');
  await page.evaluate(()=>window.replace({hash:'other',broken:false}));
  await page.getByRole('textbox',{name:'Draft'}).fill('Other document draft');
  await page.evaluate(()=>window.release());
  assert.equal(await page.getByRole('textbox',{name:'Draft'}).inputValue(),'Other document draft');
  console.log('PASS failed reader repairs automatically; transient reads retain errors; healthy drafts and navigation survive notifications.');
} finally { await browser.close(); }
