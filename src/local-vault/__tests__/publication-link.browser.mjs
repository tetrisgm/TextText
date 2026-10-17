import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = await mkdtemp(path.join(tmpdir(), "texttext-publication-link-"));
const bundle = await build({ stdin: { contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{VaultPublishDialog}from'./src/local-vault/VaultPublishDialog';import{setVaultTransport}from'./src/local-vault/bridge';
window.requests=[];window.copied=[];window.mountCount=0;
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copied.push(text)}});
const root=createRoot(document.getElementById('root'));
window.mountPublication=(workspaceId,publication,webURL)=>{
setVaultTransport(async(method)=>{window.requests.push(method);if(method==='publicationRead')return publication;if(method==='connection')return{webURL};throw Error('Unexpected mutation '+method)});
root.render(<VaultPublishDialog key={++window.mountCount} workspaceId={workspaceId} itemId={publication.itemId} label="Field notes" beforeChange={async()=>false} onClose={()=>{}}/>);
};
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outdir: dir, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const html = '<!doctype html><html><body><div class="vault-app" id="root"></div></body></html>';
await writeFile(path.join(dir, "index.html"), html);
const workspaceId = "11111111-1111-4111-8111-111111111111";
const base = `https://staging.example:8443/vault/${workspaceId}`;
const publicURL = `https://staging.example:8443/v/${workspaceId}/item-1`;
const publication = { itemId: "item-1", revision: "a".repeat(64), published: true, publishedAt: "2026-10-17T00:00:00Z", publicPath: `/v/${workspaceId}/item-1`, canPublish: true };
const browser = await chromium.launch();
try {
  for (const [pageURL, state, connection] of [
    [pathToFileURL(path.join(dir, "index.html")).href, { ...publication, publicURL }, null],
    ["https://texttext.local/index.html", publication, base],
    [base, publication, null],
  ]) {
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    await page.context().route(/^https:/, route => route.fulfill({ contentType: "text/html", body: html }));
    await page.goto(pageURL); await page.addScriptTag({ content: script });
    await page.evaluate(({ workspaceId, state, connection }) => window.mountPublication(workspaceId, state, connection), { workspaceId, state, connection });
    await page.getByRole("button", { name: "Copy link", exact: true }).click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.copied), [publicURL]);
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("link", { name: "Open page", exact: true }).click();
    const popup = await popupPromise; await popup.waitForURL(publicURL, { timeout: 5000 }); await popup.close();
    assert((await page.evaluate(() => window.requests)).every(method => ["publicationRead", "connection"].includes(method)));
    if (pageURL.includes("texttext.local")) {
      for (const invalid of [null, "https://texttext.local/vault/" + workspaceId, "https://staging.example:8443/vault/other"]) {
        await page.evaluate(({ workspaceId, publication, invalid }) => window.mountPublication(workspaceId, publication, invalid), { workspaceId, publication, invalid });
        await page.getByText("The public web address is unavailable.", { exact: false }).waitFor();
        assert.equal(await page.getByRole("button", { name: "Copy link", exact: true }).count(), 0);
        assert.equal(await page.getByRole("link", { name: "Open page", exact: true }).count(), 0);
      }
    }
    await page.close();
  }
  console.log("PASS production Publish component: file/native URL, synthetic Windows connection, and hosted web yield identical public Copy/Open targets. Invalid connection hides actions, no publication mutation. Clipboard payload is stubbed; popup navigation is observed.");
} finally { await browser.close(); }
