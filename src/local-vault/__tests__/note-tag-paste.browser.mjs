import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { buildLocalVault } from "../../../scripts/build-local-vault.mjs";

const root = process.cwd();
const dir = await mkdtemp(path.join(tmpdir(), "texttext-note-tag-paste-"));
await symlink(path.join(root, "node_modules"), path.join(dir, "node_modules"));
await writeFile(path.join(dir, "entry.tsx"), `
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';
import{VaultApp}from'${root}/src/local-vault/VaultApp';import{VaultError,setVaultTransport}from'${root}/src/local-vault/bridge';
import{emptyDocumentSnapshot}from'${root}/src/lib/documents/model';import{readDocument,writePayload}from'${root}/src/local-vault/model';
import{coherentProjection}from'${root}/src/lib/documents/projection-baseline';
const itemId='22222222-2222-4222-8222-222222222222',path='Notes/Thought.textpack';let revision=1;
const doc=emptyDocumentSnapshot({id:'texttext.note',version:1});doc.content.title='Thought';doc.content.body='Keep this note.';
let file={...writePayload({path,hash:'1',markdown:'---\\ntextTextId: '+itemId+'\\n---\\n\\n'},doc),hash:'1',assets:[]};
window.writes=[];window.readSaved=()=>({document:readDocument(file),file});
setVaultTransport(async(method,params)=>{
 if(method==='list')return{root:'/fixture/Workspace',name:'My notes',folders:['Notes'],items:[{path,itemId,canEditContent:true}],fullAccess:true,canCreateContent:true};
 if(method==='folderViews'||method==='templates')return{files:[]};
 if(method==='connection')return{connected:false,available:true};
 if(method==='accountRead')return{email:'alex@example.test',name:'Alex',identities:[],workspaceName:'My notes'};
 if(method==='read')return file;
 if(method==='preview')return{title:'Thought',excerpt:'Keep this note.',document:readDocument(file)};
 if(method==='collaborationConfig')return null;
 if(method==='write'){
  if(params.hash!==file.hash)throw new VaultError('File changed','conflict',file);
  window.writes.push({hash:params.hash,coherent:!!coherentProjection(params.markdown,params.documentJSON),assets:params.addedAssets?.length??0});
  file={...file,...params,hash:String(++revision),assets:[...file.assets,...(params.addedAssets??[])]};return file;
 }
 throw Error('Unexpected '+method);
});
createRoot(document.getElementById('root')).render(<VaultApp/>);
`);
await buildLocalVault({ entry: path.join(dir, "entry.tsx"), output: dir });
const browser = await chromium.launch();
try {
  const page = await browser.newPage(); page.setDefaultTimeout(7000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.route(/^https:/, route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto("https://note-paste.test/");
  await page.addStyleTag({ content: await readFile(path.join(dir, "app.css"), "utf8") });
  await page.addScriptTag({ content: await readFile(path.join(dir, "app.js"), "utf8") });
  await page.getByRole("heading", { name: "All files", exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("texttext:vault-open", { detail: { path: "Notes/Thought.textpack" } })));
  await page.getByRole("button", { name: "Edit card", exact: true }).click();
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.fill("Updated checklist\n- [ ] Next step\n- [ ] ");
  await page.getByRole("button", { name: "Add to note", exact: true }).click();
  await page.getByRole("menuitem", { name: "Tag", exact: true }).click();
  await page.getByRole("textbox", { name: "Add note tag", exact: true }).fill("#Ideas");
  await page.getByRole("textbox", { name: "Add note tag", exact: true }).press("Enter");
  // Paste immediately: the production VaultEditor must flush the tag/body
  // first, observe a coherent reply, then write the attachment through CAS.
  await page.getByRole("button", { name: "Add to note", exact: true }).click();
  await page.getByRole("menuitem", { name: "Image", exact: true }).click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.getByLabel("Choose note images").setInputFiles({ name: "Thought photo.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => window.readSaved().file.assets.length === 1, undefined, { timeout: 7000 });
  const saved = await page.evaluate(() => window.readSaved());
  assert.deepEqual(saved.document.content.tags, ["ideas"]);
  assert(saved.document.content.body.includes("Updated checklist"));
  assert(saved.document.content.body.includes("assets/Thought-photo.png"));
  assert.deepEqual(Buffer.from(saved.file.assets[0].data, "base64"), png);
  assert((await page.evaluate(() => window.writes)).every(write => write.coherent));
  assert.equal(await page.getByRole("button", { name: "Retry save", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Save my edits as a copy", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS production VaultEditor tag/body flush then image CAS: uppercase tag canonicalized, all writes coherent, original PNG bytes preserved, no retry/conflict warning.");
} finally { await browser.close(); }
