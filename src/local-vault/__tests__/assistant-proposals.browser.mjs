import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const fixture=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AssistantWriteProposals}from'./src/local-vault/AssistantWriteProposals';import{setVaultTransport}from'./src/local-vault/bridge';window.refreshes=0;setVaultTransport(async()=>{window.refreshes++;return{}});const root=createRoot(document.getElementById('root'));window.renderCards=(path,proposals)=>root.render(<AssistantWriteProposals key={path} root="vault:test" path={path} proposals={proposals} beforeApprove={async()=>true}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let pending, decisions=[];
 const cards=[1,2].map(n=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,kind:'workspace',title:`Change ${n}`,summary:'Review body',arguments:{body:`Body ${n}`},expiresAt:new Date(Date.now()+60000).toISOString(),status:'pending'}));
 await page.route('https://test.local/**',async route=>{
  const req=route.request();if(req.url().includes('/api/ai/proposals/')){
   const card=cards.find(c=>req.url().endsWith(c.id));assert.ok(card);
   if(req.method()==='GET'){await route.fulfill({json:{proposal:card}});return;}
   decisions.push({id:card.id,decision:req.postDataJSON().decision});pending=route;return;
  }await route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
 });
 await page.goto('https://test.local');await page.addScriptTag({content:fixture.outputFiles[0].text});
 await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Quota','QuotaExceededError')}});
 await page.evaluate(cards=>window.renderCards('Notes/A',cards),[cards[0]]);
 await page.getByText('Keep this panel open to review these changes.',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Approve change'}).click();
 await page.waitForFunction(()=>document.querySelector('button')?.disabled);
 for(let i=0;!pending&&i<100;i++)await new Promise(r=>setTimeout(r,10));assert.ok(pending);
 await page.evaluate(cards=>window.renderCards('Notes/A',cards),cards);
 await pending.fulfill({status:503,json:{error:'Result temporarily unavailable'}});pending=null;
 await page.getByRole('button',{name:'Check result'}).waitFor();assert.equal(await page.getByRole('heading').count(),2);
 await page.getByRole('button',{name:'Check result'}).click();
 for(let i=0;!pending&&i<100;i++)await new Promise(r=>setTimeout(r,10));assert.ok(pending);
 await pending.fulfill({json:{receipt:{text:'Saved exactly once'}}});pending=null;
 await page.getByText('Saved exactly once').waitFor();assert.equal(await page.getByRole('heading').count(),2);
 assert.deepEqual(decisions,[{id:cards[0].id,decision:'approve'},{id:cards[0].id,decision:'approve'}]);
 await page.getByRole('button',{name:'Reject change'}).click();
 for(let i=0;!pending&&i<100;i++)await new Promise(r=>setTimeout(r,10));assert.ok(pending);
 await page.evaluate(()=>window.renderCards('Notes/B',[]));await pending.fulfill({json:{status:'denied'}});
 await page.waitForFunction(()=>document.querySelectorAll('h3').length===0);assert.deepEqual(errors,[]);
 console.log('PASS proposal cards: quota recovery, concurrent arrival retained, 503 same-ID/decision retry, navigation fence.');
}finally{await browser.close();}
