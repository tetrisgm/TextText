import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const bundle = await build({ stdin:{contents:`
import React from 'react';import{createRoot}from'react-dom/client';
import{VaultShareDialog}from'./src/local-vault/VaultShareDialog';import{setVaultTransport}from'./src/local-vault/bridge';
window.requests=[];window.copied=[];window.mountCount=0;
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copied.push(text)}});
setVaultTransport(async(method)=>{window.requests.push(method);if(method==='shareList')return{grants:[]};throw Error('Unexpected mutation '+method)});
const root=createRoot(document.getElementById('root'));
window.mountShare=(scope,workspaceURL)=>root.render(<VaultShareDialog key={++window.mountCount} scope={scope} workspaceURL={workspaceURL} onClose={()=>{}}/>);
`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'} });
const dir=await mkdtemp(path.join(tmpdir(),"texttext-share-link-"));
const html='<!doctype html><html><body><div class="vault-app" id="root"></div></body></html>';
await writeFile(path.join(dir,"index.html"),html);
const workspaceId="11111111-1111-4111-8111-111111111111";
const base=`https://texttext.app/vault/${workspaceId}`;
const scope={workspaceId,scopeType:"item",scopeKey:"item-1",label:"Field notes"};
const browser=await chromium.launch();
try {
  for(const pageURL of [pathToFileURL(path.join(dir,"index.html")).href,"https://texttext.local/index.html",base]) {
    const page=await browser.newPage();page.setDefaultTimeout(5000);
    await page.route(/^https:/,route=>route.fulfill({contentType:"text/html",body:html}));
    await page.goto(pageURL);await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(({scope,base})=>window.mountShare(scope,base),{scope,base});
    await page.getByRole("button",{name:"Copy link",exact:true}).click();
    await page.getByRole("button",{name:"Copied",exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.copied),[`${base}?item=item-1`]);
    await page.evaluate(({scope,base})=>window.mountShare({...scope,scopeType:"folder",scopeKey:"Research/Field notes"},base),{scope,base});
    await page.getByRole("button",{name:"Copy link",exact:true}).click();
    await page.getByRole("button",{name:"Copied",exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.copied),[`${base}?item=item-1`,`${base}#folder=Research%2FField%20notes`]);
    for(const invalid of [null,`https://texttext.local/vault/${workspaceId}`,"file:///app/index.html"]) {
      await page.evaluate(({scope,invalid})=>window.mountShare(scope,invalid),{scope,invalid});
      await page.getByRole("button",{name:"Copy link",exact:true}).click();
      await page.getByRole("alert").filter({hasText:"workspace web address is unavailable"}).waitFor();
      assert.equal(await page.evaluate(()=>window.copied.length),2);
    }
    assert((await page.evaluate(()=>window.requests)).every(method=>method==="shareList"));
    await page.close();
  }
  console.log("PASS share-link handler at file, synthetic Windows and web page origins: identical authenticated item/folder URL, invalid/missing workspace fails closed, clipboard payload captured, no share mutations. OS clipboard permission not simulated.");
}finally{await browser.close();}
