import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { buildLocalVault } from "../../../scripts/build-local-vault.mjs";

const root = process.cwd();
const dir = await mkdtemp(path.join(tmpdir(), "texttext-note-rapid-draft-"));
await symlink(path.join(root, "node_modules"), path.join(dir, "node_modules"));
await writeFile(path.join(dir, "entry.tsx"), `
import React from '${root}/node_modules/react/index.js';import{createRoot}from'${root}/node_modules/react-dom/client.js';
import{VaultApp}from'${root}/src/local-vault/VaultApp';import{setVaultTransport}from'${root}/src/local-vault/bridge';
import{openPack}from'${root}/src/local-vault/pack';import{readDocument}from'${root}/src/local-vault/model';
const files=new Map();window.saved=()=>[...files.values()].map(readDocument);
setVaultTransport(async(method,params)=>{
 if(method==='list')return{root:'/fixture/Workspace',name:'My notes',folders:['Notes'],items:[...files.values()].map(file=>({path:file.path,canEditContent:true})),fullAccess:true,canCreateContent:true};
 if(method==='folderViews'||method==='templates')return{files:[]};
 if(method==='connection')return{connected:false,available:true};
 if(method==='accountRead')return{email:'alex@example.test',name:'Alex',identities:[],workspaceName:'My notes'};
 if(method==='read')return files.get(params.path);
 if(method==='preview'){const document=readDocument(files.get(params.path));return{title:document.content.title,excerpt:document.content.body,document};}
 if(method==='importPack'){const file=openPack(Uint8Array.from(atob(params.data),c=>c.charCodeAt(0)),params.folder+'/'+params.title+'.textpack','1').file;files.set(file.path,file);return file;}
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
  await page.goto("https://note-draft.test/");
  await page.addStyleTag({ content: await readFile(path.join(dir, "app.css"), "utf8") });
  await page.addScriptTag({ content: await readFile(path.join(dir, "app.js"), "utf8") });
  await page.getByRole("heading", { name: "All files", exact: true }).waitFor();
  await page.getByText("Notes", { exact: true }).first().click();
  await page.getByRole("button", { name: "Start typing to create a new card" }).waitFor();
  // Real keyboard input crosses the production shortcut-to-textarea boundary.
  await page.keyboard.type("Rapid thought");
  const title = page.getByRole("textbox", { name: "New card title" });
  assert.equal(await title.inputValue(), "Rapid thought");
  await page.keyboard.type(" again");
  assert.equal(await title.inputValue(), "Rapid thought again");
  const body = page.getByRole("textbox", { name: "New card body" });
  await body.fill("Keep body focus");
  await page.keyboard.type(" while typing");
  assert.equal(await body.inputValue(), "Keep body focus while typing");
  assert.equal(await title.inputValue(), "Rapid thought again");
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({ path: path.join(dir, `draft-${theme}.png`) });
  }
  await page.getByRole("form", { name: "New card draft" }).getByRole("button", { name: "Finish", exact: true }).click();
  await page.getByRole("button", { name: "Open Rapid thought again", exact: true }).waitFor();
  const saved = await page.evaluate(() => window.saved());
  assert.equal(saved.length, 1);
  assert.equal(saved[0].content.title, "Rapid thought again");
  assert.equal(saved[0].content.body, "Keep body focus while typing");
  assert.deepEqual(errors, []);
  console.log(`PASS production shortcut rapid typing, correct first-character/caret order, body focus and exact saved title/body. Light/dark screenshots: ${dir}`);
} finally { await browser.close(); }
