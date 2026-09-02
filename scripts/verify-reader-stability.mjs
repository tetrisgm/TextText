// Reproduce the "everything blinks on any action" report: open the read view
// of an image-bearing document, interact (click, keypress), and check whether
// img/text DOM nodes are recreated, layout shifts fire, or images re-fetch.
import { chromium } from "playwright";

const ORIGIN = "http://localhost:3131";
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const imageHits = [];
page.on("request", (r) => {
  if (r.url().includes("img-")) imageHits.push(r.url().split("/").pop());
});

await page.goto(`${ORIGIN}/editor`, { waitUntil: "networkidle" });
const form = page.locator("form.ac-devsignin");
await form.waitFor({ timeout: 20000 });
await form.locator("input[type=email]").fill("visual-demo@texttext.local");
await form.locator("button[type=submit]").click();
await page.waitForTimeout(1500);
await page.goto(`${ORIGIN}/@visual-demo`);
await page.waitForSelector(".workspace-item-option", { timeout: 20000 });
await page.waitForTimeout(1500);
await page.locator(".workspace-item-option", { hasText: "Reader images fixture" }).first().click();
await page.waitForSelector("img[alt=first]", { timeout: 20000 });
await page.waitForTimeout(2000);

await page.evaluate("globalThis.__name = (fn) => fn");
const instrument = () =>
  page.evaluate(() => {
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) window.__shifts.push(e.value);
      }
    }).observe({ type: "layout-shift", buffered: false });
    document.querySelectorAll("img").forEach((img, i) => {
      img.__mark = `img-${i}`;
    });
    const walker = document.createTreeWalker(
      document.querySelector(".workspace-post-reader, .unified-document-reader, main") ?? document.body,
      NodeFilter.SHOW_TEXT,
    );
    let n = 0;
    let node = walker.nextNode();
    while (node && n < 50) {
      node.__mark = `t-${n}`;
      n += 1;
      node = walker.nextNode();
    }
    return { imgs: document.querySelectorAll("img").length, texts: n };
  });

const audit = () =>
  page.evaluate(() => {
    const imgs = [...document.querySelectorAll("img")];
    const keptImgs = imgs.filter((img) => img.__mark).length;
    const walker = document.createTreeWalker(
      document.querySelector(".workspace-post-reader, .unified-document-reader, main") ?? document.body,
      NodeFilter.SHOW_TEXT,
    );
    let kept = 0;
    let total = 0;
    let node = walker.nextNode();
    while (node && total < 50) {
      if (node.__mark) kept += 1;
      total += 1;
      node = walker.nextNode();
    }
    return {
      imgs: imgs.length,
      keptImgs,
      keptTexts: `${kept}/${total}`,
      shifts: window.__shifts.length,
      shiftSum: window.__shifts.reduce((a, b) => a + b, 0),
    };
  });

console.log("baseline:", JSON.stringify(await instrument()));
imageHits.length = 0;

// Action 1: click on body text.
await page.locator("p").first().click();
await page.waitForTimeout(600);
console.log("after click:", JSON.stringify(await audit()), "img refetch:", imageHits.join(",") || "none");

// Action 2: press a key (arrow down).
await instrument();
imageHits.length = 0;
await page.keyboard.press("ArrowDown");
await page.waitForTimeout(600);
console.log("after key:", JSON.stringify(await audit()), "img refetch:", imageHits.join(",") || "none");

// Action 3: click in a blank area of the page chrome.
await instrument();
imageHits.length = 0;
await page.mouse.click(400, 80);
await page.waitForTimeout(600);
console.log("after chrome click:", JSON.stringify(await audit()), "img refetch:", imageHits.join(",") || "none");

await browser.close();
