// Owned isolated production editor fixture; exact authored render spec stays unchanged.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { buildLocalVault } from "../../../scripts/build-local-vault.mjs";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
const repository = process.cwd(), dir = await mkdtemp(path.join(tmpdir(), "texttext-custom-gallery-title-"));
// Matches the owned v2's actual cover-only authored item, without assigning it an experience.
const template = validateTemplateDefinition({
  "schemaVersion": 1,
  "engineVersion": 1,
  "id": "local.7594b42a-b8cd-412e-8d16-8b80333e4c10",
  "version": 2,
  "name": "Acceptance gallery look 20261018 f994 version two",
  "description": "A set of photos that leads with the images.",
  "fields": [
    {
      "id": "cover",
      "label": "Cover",
      "required": false,
      "visibility": "public",
      "type": "image",
      "allowedContentTypes": []
    }
  ],
  "item": {
    "type": "stack",
    "direction": "vertical",
    "gap": "lg",
    "align": "stretch",
    "children": [
      {
        "id": "gallery-media",
        "type": "gallery",
        "bind": "content.assets",
        "columns": 4,
        "showCaptions": false
      }
    ]
  },
  "collection": {
    "layout": "cards",
    "columns": 4,
    "gap": "md",
    "sort": [
      {
        "field": "updatedAt",
        "direction": "desc"
      }
    ],
    "filters": [],
    "views": [],
    "item": {
      "type": "gallery",
      "bind": "content.assets",
      "columns": 1,
      "showCaptions": false
    }
  },
  "theme": {
    "accent": "#336699",
    "typography": "system",
    "measure": "full",
    "alignment": "start",
    "media": "full"
  }
});
await symlink(path.join(repository, "node_modules"), path.join(dir, "node_modules"));
await writeFile(path.join(dir, "entry.tsx"), `
import React,{useState} from '${repository}/node_modules/react/index.js';import{createRoot}from'${repository}/node_modules/react-dom/client.js';
import * as Y from '${repository}/node_modules/yjs/dist/yjs.mjs';import{Awareness}from'${repository}/node_modules/y-protocols/awareness.js';
import{UnifiedDocumentEditor}from'${repository}/src/components/document/UnifiedDocumentEditor';
import{applyDocumentSnapshot}from'${repository}/src/lib/collab/document';
import{emptyDocumentSnapshot}from'${repository}/src/lib/documents/model';
import{asPost,localBlog}from'${repository}/src/local-vault/model';import{DocumentEngineStyles}from'${repository}/src/components/document/DocumentEngineStyles';
import '${repository}/src/local-vault/style.css';
const seed=${JSON.stringify(template)};
const variant=new URL(location.href).searchParams.get('variant');
const template=variant==='experience'?{...seed,experience:'gallery'}:variant==='hidden'?{...seed,item:{type:'stack',direction:'vertical',gap:'lg',align:'stretch',children:[{type:'stack',direction:'vertical',gap:'lg',align:'stretch',showWhen:'content.title',children:[{type:'text',bind:'content.title',role:'title'}]},...seed.item.children]}}:variant==='bound'?{...seed,item:{type:'stack',direction:'vertical',gap:'lg',align:'stretch',children:[{type:'text',bind:'content.title',role:'title'},...seed.item.children]}}:seed;
const initial=emptyDocumentSnapshot({id:template.id,version:template.version});
const doc=new Y.Doc();applyDocumentSnapshot(doc,initial);const awareness=new Awareness(doc);
window.fixtureTemplate=template;window.fixtureInitial=initial;window.fixtureChanges=[];
function App(){const[snapshot,setSnapshot]=useState(initial);return <div className="vault-app"><main style={{gridColumn:'1 / -1'}}><DocumentEngineStyles/><UnifiedDocumentEditor transport="local" localDocument={doc} localPresence={{awareness,peers:[]}} externalDocument={snapshot}
 blog={localBlog} post={asPost(snapshot,'Owned.textpack')} template={template} availableTemplates={[template]} focusNewNote={variant!=='readonly'} focusNewNoteTitle collab={{postId:'owned-custom-gallery',userName:'Owned',color:'#3970c5',canEdit:variant!=='readonly'}}
 onDocumentChange={next=>{window.fixtureChanges.push(next);window.fixtureCurrent=next;setSnapshot(next)}} onDone={()=>{}}/></main></div>}
createRoot(document.getElementById('root')).render(<App/>);
`);
await buildLocalVault({ entry: path.join(dir, "entry.tsx"), output: dir });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(), errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("https://custom-gallery.test/**", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  const observations: unknown[] = [];
  for (const variant of ["actual", "experience", "bound", "hidden", "readonly"]) {
    await page.goto("https://custom-gallery.test/?variant=" + variant);
    await page.addStyleTag({ content: await readFile(path.join(dir, "app.css"), "utf8") });
    await page.addScriptTag({ content: await readFile(path.join(dir, "app.js"), "utf8") });
    await page.getByRole("main", { name: "Edit item" }).waitFor();
    const before = await page.evaluate(() => ({ template: (window as any).fixtureTemplate, initial: (window as any).fixtureInitial,
      titleInputs: [...document.querySelectorAll('input[aria-label="Title"],input[aria-label="Image title"],textarea[aria-label="Title"]')].length,
      hint: [...document.querySelectorAll('.workspace-post-body-status')].map(node => node.textContent), bodyCount: document.querySelectorAll('[aria-label="Document body"]').length }));
    observations.push({ variant, before });
    await writeFile(path.join(dir, "observation.json"), JSON.stringify({ observations, errors }, null, 2));
    if (variant === "hidden" || variant === "readonly") {
      assert.equal(before.titleInputs, 0, "Conditional authored title ownership and readonly controls are not broadened");
      assert.ok(!before.hint.some(text => /write below/i.test(text!)));
      continue;
    }
    assert.equal(before.titleInputs, 1, "A statically unbound authored gallery has exactly one editable core Title");
    assert.ok(before.bodyCount > 0 || !before.hint.some(text => /write below/i.test(text!)), "Blank guidance cannot promise an unavailable body");
    const title = page.locator('input[aria-label="Title"],input[aria-label="Image title"],textarea[aria-label="Title"]');
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Title");
    const original = await title.elementHandle();
    await page.keyboard.type("nabc");
    assert.equal(await title.inputValue(), "nabc", "The real next character lands in the focused core Title");
    assert.equal(await title.evaluate((node, prior) => node === prior, original), true);
    await title.fill("Owned custom gallery title");
    await page.waitForFunction(() => (window as any).fixtureCurrent?.content.title === "Owned custom gallery title");
    assert.deepEqual(await page.evaluate(() => (window as any).fixtureTemplate), before.template, "Editing never changes authored template");
    const saved = await page.evaluate(() => (window as any).fixtureCurrent);
    assert.deepEqual(saved.presentation.template, before.initial.presentation.template);
    assert.deepEqual(saved.content.fields, before.initial.content.fields);
    if (variant !== "bound") {
      const geometry = await title.evaluate(node => {
        const mirror = node.parentElement!.querySelector("pre")!;
        return { mirrorPosition: getComputedStyle(mirror).position, mirrorColor: getComputedStyle(mirror).color,
          titleColor: getComputedStyle(node).color, height: node.getBoundingClientRect().height,
          width: node.getBoundingClientRect().width, clipped: node.scrollHeight > node.clientHeight + 1 };
      });
      assert.equal(geometry.mirrorPosition, "absolute"); assert.equal(geometry.mirrorColor, "rgba(0, 0, 0, 0)");
      assert.notEqual(geometry.titleColor, "rgba(0, 0, 0, 0)"); assert.ok(geometry.height >= 40 && geometry.width > 100); assert.equal(geometry.clipped, false);
      observations.push({ variant, geometry });
    }
    assert.equal(saved.content.body, before.initial.content.body); assert.deepEqual(saved.content.assets, before.initial.content.assets);
    for (const colorScheme of ["light", "dark"] as const) { await page.emulateMedia({ colorScheme }); await title.scrollIntoViewIfNeeded(); await title.locator(variant === "bound" ? "xpath=ancestor::section[1]" : "xpath=ancestor::details[1]").screenshot({ path: path.join(dir, variant + "-" + colorScheme + ".png") }); }
  }
  await writeFile(path.join(dir, "observation.json"), JSON.stringify({ observations, errors }, null, 2));
  assert.deepEqual(errors, []); console.log("PASS authored gallery core Title parity and truthful blank guidance. Evidence: " + dir);
} finally { await browser.close(); }
