import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildLocalVault } from "../../../scripts/build-local-vault.mjs";

const output = await mkdtemp(path.join(tmpdir(), "texttext-editor-image-paste-"));
let browser;
try {
  await buildLocalVault({ entry: "src/local-vault/__tests__/editor-image-paste-entry.tsx", output });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const failures = [];
  page.on("pageerror", error => failures.push(error.message));
  await page.goto(pathToFileURL(path.join(output, "index.html")).href);
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.waitFor();
  await body.focus();
  await body.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element); range.collapse(false);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  await page.evaluate(({ png, gif }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(png), character => character.charCodeAt(0))], "Pasted.png", { type: "image/png" }));
    transfer.items.add(new File([Uint8Array.from(atob(gif), character => character.charCodeAt(0))], "Animated.gif", { type: "image/gif" }));
    document.querySelector('[aria-label="Document body"]').dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
    );
  }, { png: png.toString("base64"), gif: gif.toString("base64") });
  await page.waitForFunction(() => Boolean(window.__editorImagePasteResult));
  const result = await page.evaluate(() => window.__editorImagePasteResult);
  assert.equal(result.body, "Before after![Pasted](assets/Pasted.png)\n\n![Animated](assets/Animated.gif)");
  assert.deepEqual(result.assets, [
    ["assets/Pasted.png", "image/png"],
    ["assets/Animated.gif", "image/gif"],
  ]);
  assert.deepEqual(Buffer.from(result.png), png);
  assert.deepEqual(Buffer.from(result.gif), gif);
  await page.waitForFunction(() => document.querySelector('[aria-label="Document body"]')?.textContent?.includes("assets/Animated.gif"));
  assert.deepEqual(failures, []);
  console.log("Editor image paste browser check passed: Markdown insertion and original PNG/GIF bytes stayed in one TextPack.");
} finally {
  await browser?.close();
  await rm(output, { recursive: true, force: true });
}
