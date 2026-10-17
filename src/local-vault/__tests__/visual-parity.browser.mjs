import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { buildLocalVault } from "../../../scripts/build-local-vault.mjs";

// Real shared VaultApp with a read-only fixture transport. These browser profiles
// isolate host stylesheet/default differences; they are not native host evidence.
const dir = process.env.TEXTTEXT_VISUAL_PARITY_BUNDLE || process.env.TEXTTEXT_VISUAL_PARITY_OUTPUT || await mkdtemp(path.join(tmpdir(), "texttext-visual-parity-"));
const root = process.cwd();
await mkdir(dir, { recursive:true });
await symlink(path.join(root, "node_modules"), path.join(dir, "node_modules")).catch(error => { if (error.code !== "EEXIST") throw error; });
await writeFile(path.join(dir, "entry.tsx"), `
import React from '${root}/node_modules/react/index.js';
import {createRoot} from '${root}/node_modules/react-dom/client.js';
import {VaultApp} from '${root}/src/local-vault/VaultApp';
import {setVaultTransport} from '${root}/src/local-vault/bridge';
const items = ['Projects/Field notes.textpack','Reading/On careful work.textpack','Projects/Next steps.textpack'];
window.fixtureCalls=[];
window.visualParityMetrics=()=>{
 const app=document.querySelector('.vault-app'),button=document.querySelector('.vault-primary-action');
 if(!app||!button)return null;
 const style=getComputedStyle(app);
 return {font:style.fontSize,lineHeight:style.lineHeight,background:style.backgroundColor,color:style.color,
  colorScheme:style.colorScheme,buttonFont:getComputedStyle(button).fontSize,buttonHeight:button.getBoundingClientRect().height,
  sidebarWidth:document.querySelector('.vault-sidebar').getBoundingClientRect().width,
  overflow:document.documentElement.scrollWidth>innerWidth,ready:document.querySelectorAll('.vault-document-grid>button').length===3};
};
setVaultTransport(async(method,params)=>{
 window.fixtureCalls.push(method);
 if(method==='list')return {root:'/fixture/My notes',name:'My notes',folders:['Projects','Projects/Research','Reading'],items:items.map(path=>({path})),fullAccess:true,canCreateContent:true};
 if(method==='folderViews'||method==='templates')return {files:[]};
 if(method==='connection')return {connected:false,available:true,root:'/fixture/My notes'};
 if(method==='collaborationConfig')return null;
 if(method==='preview')return {title:params.path.split('/').at(-1).replace('.textpack',''),excerpt:'A place for the ideas, references, and small observations worth keeping.'};
 if(method==='accountRead')return {accountId:'fixture',name:'Alex',email:'alex@example.test',workspaceName:'My notes',identities:[]};
 throw Error('Unexpected fixture method: '+method);
});
createRoot(document.getElementById('root')).render(<VaultApp/>);
`);
await buildLocalVault({ entry: path.join(dir, "entry.tsx"), output: dir });
const css = await readFile(path.join(dir, "app.css"), "utf8");
const script = await readFile(path.join(dir, "app.js"), "utf8");
const globals = await Promise.all(["tokens", "broadsheet", "talk", "apple", "artifact"].map(name => readFile(`src/styles/${name}.css`, "utf8")));
await writeFile(path.join(dir, "web-global.css"), globals.join("\n"));
const html=await readFile(path.join(dir,"index.html"),"utf8");
await writeFile(path.join(dir,"native.html"),html);
await writeFile(path.join(dir,"web.html"),html.replace('<link rel="stylesheet" href="app.css">','<link rel="stylesheet" href="web-global.css"><link rel="stylesheet" href="app.css">'));
const oldCSS = execFileSync("git", ["show", "HEAD:src/local-vault/style.css"], { encoding: "utf8" });
const browser = await chromium.launch();
const receipts = [];
try {
  for (const [profile, inheritedFont, webGlobals] of [["native-default", 16, false], ["web-global", 16, true], ["host-large-default", 22, false]]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://visual.test/**", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>' }));
    await page.goto("https://visual.test/");
    if (webGlobals) for (const content of globals) await page.addStyleTag({ content });
    await page.addStyleTag({ content: `body{font-size:${inheritedFont}px;line-height:normal}` });
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await page.getByRole("button", { name: "Field notes Projects Open →", exact: true }).waitFor();
    // Append the previous stylesheet to expose the missing inherited typography
    // baseline, while retaining the exact same production component fixture.
    if (profile === "host-large-default") {
      const previous = await page.addStyleTag({ content: oldCSS + ".vault-app{font-size:inherit;line-height:inherit}" });
      await page.emulateMedia({ colorScheme: "light" });
      await page.screenshot({ path: path.join(dir, "before-large-default-light.png") });
      assert.equal(await page.locator(".vault-primary-action").evaluate(node => getComputedStyle(node).fontSize), "22px");
      await previous.evaluate(node => node.remove());
    }
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
      const metrics = await page.evaluate(() => {
        const app = document.querySelector(".vault-app");
        const button = document.querySelector(".vault-primary-action");
        const summary = document.querySelector(".vault-folder > summary");
        const style = getComputedStyle(app);
        return { font: style.fontSize, lineHeight: style.lineHeight, background: style.backgroundColor,
          color: style.color, colorScheme: style.colorScheme, buttonFont: getComputedStyle(button).fontSize,
          buttonHeight: button.getBoundingClientRect().height, summaryFont: getComputedStyle(summary).fontSize,
          sidebarWidth: document.querySelector(".vault-sidebar").getBoundingClientRect().width,
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(metrics.font, "14px");
      assert.equal(metrics.lineHeight, "20.3px");
      assert.equal(metrics.buttonFont, "14px");
      assert.equal(metrics.buttonHeight, 34);
      assert.equal(metrics.sidebarWidth, 240);
      assert.equal(metrics.background, theme === "light" ? "rgb(255, 255, 255)" : "rgb(35, 35, 35)");
      assert.equal(metrics.colorScheme, theme);
      assert.equal(metrics.overflow, false);
      receipts.push({ profile, theme, ...metrics });
      await page.screenshot({ path: path.join(dir, `${profile}-${theme}.png`) });
      // Explicit appearance must win even when the system uses the other mode.
      await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      assert.equal(await page.locator(".vault-app").evaluate(node => getComputedStyle(node).backgroundColor), metrics.background);
      assert.equal(await page.locator(".vault-app").evaluate(node => getComputedStyle(node).colorScheme), theme);
    }
    await page.locator(".vault-folder > summary").first().focus();
    assert.equal(await page.locator(".vault-folder > summary").first().evaluate(node => getComputedStyle(node).outlineStyle), "solid");
    const wasOpen = await page.locator(".vault-folder").first().getAttribute("open");
    await page.keyboard.press("Enter");
    assert.notEqual(await page.locator(".vault-folder").first().getAttribute("open"), wasOpen);
    await page.setViewportSize({ width: 390, height: 760 });
    await page.getByRole("button", { name: "Show folders", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(dir, `${profile}-narrow-dark.png`) });
    // Browser zoom remains available; the app does not set CSS zoom or transforms.
    assert.equal(await page.locator(".vault-app").evaluate(node => getComputedStyle(node).zoom), "1");
    assert.equal(await page.locator(".vault-app").evaluate(node => getComputedStyle(node).transform), "none");
    assert.deepEqual(errors, []);
    await page.close();
  }
  for (const theme of ["light", "dark"]) {
    const values = receipts.filter(value => value.theme === theme).map(({ profile, ...value }) => value);
    assert.deepEqual(values[1], values[0]);
    assert.deepEqual(values[2], values[0]);
  }
  const touch = await browser.newPage({ viewport:{width:390,height:760}, isMobile:true, hasTouch:true, colorScheme:"dark" });
  await touch.route("https://visual.test/**", route => route.fulfill({contentType:"text/html",body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>'}));
  await touch.goto("https://visual.test/");
  await touch.addStyleTag({content:css});
  await touch.addScriptTag({content:script});
  await touch.locator(".vault-primary-action").waitFor();
  assert.equal(await touch.locator(".vault-primary-action").evaluate(node => node.getBoundingClientRect().height),44);
  assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
  await touch.screenshot({path:path.join(dir,"touch-narrow-dark.png")});
  await touch.close();
  await writeFile(path.join(dir, "receipt.json"), JSON.stringify({ evidence: "Chromium shared-component host CSS profiles, not native WK/WebView2", receipts }, null, 2) + "\n");
  console.log(`PASS shared shell: identical typography/control/sidebar metrics across native defaults, web globals, and large inherited defaults; light/dark, explicit appearance, keyboard folders, narrow overflow. Screenshots: ${dir}`);
} finally { await browser.close(); }
