/**
 * RETAINED heap, which is the only heap number that means anything: force
 * collection twice before each sample, or you are measuring garbage that has
 * not been swept rather than memory that is held.
 *
 *   npx tsx scripts/memory-retention.mts
 *
 * Needs the same server as scripts/visual-surfaces.mts. Reading
 * JSHeapUsedSize WITHOUT forcing collection first produced numbers that
 * swung between 400MB and 1.7GB for the same code and sent two separate
 * investigations down the wrong path. The settled figure is steady to a
 * megabyte or so.
 */
import { chromium, type Page } from "playwright";
const ORIGIN = "http://localhost:3131";
async function signIn(page: Page) {
  await page.goto(`${ORIGIN}/editor`, { waitUntil: "networkidle" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor({ timeout: 20000 });
  await form.locator("input[type=email]").fill("visual-demo@texttext.local");
  await form.locator("button[type=submit]").click();
  await page.waitForSelector(".workspace-item-option", { timeout: 30000 });
  await page.waitForTimeout(1500);
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await signIn(page);
const client = await page.context().newCDPSession(page);
await client.send("Performance.enable");
await client.send("HeapProfiler.enable");
const retained = async () => {
  await client.send("HeapProfiler.collectGarbage");
  await client.send("HeapProfiler.collectGarbage");
  await new Promise((r) => setTimeout(r, 250));
  const { metrics } = await client.send("Performance.getMetrics");
  return (metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0) / 1048576;
};
console.log(`settled at start:      ${(await retained()).toFixed(1)} MB`);
for (let round = 1; round <= 3; round += 1) {
  for (let i = 0; i < 6; i += 1) {
    await page.locator(".workspace-item-option").nth(i).click();
    await page.waitForFunction(() => {
      const s = document.querySelectorAll(".tt-prose, .tt-md-surface");
      return [...s].some((el) => (el.textContent?.length ?? 0) > 40);
    }, undefined, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.keyboard.press("Backspace");
    await page.waitForFunction(
      () => document.querySelectorAll(".workspace-item-option").length > 3,
      undefined, { timeout: 15000 },
    ).catch(() => {});
    await page.waitForTimeout(400);
  }
  console.log(`after ${round * 6} open+backs:  ${(await retained()).toFixed(1)} MB`);
}
await browser.close();
