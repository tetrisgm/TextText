/**
 * Count IndexedDB writes across three opens of one document, broken down by
 * store.
 *
 *   npx tsx scripts/storage-writes.mts
 *
 * Deterministic where a stopwatch is not: a count does not care how loaded
 * the machine is, which is what made this measurable at all on an evening
 * when wall-clock swung by a factor of thirty. It found the workspace
 * writing an 8MB document to disk 180 times per open.
 */
import { chromium, type Page } from "playwright";
const ORIGIN = "http://localhost:3131";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  const w = window as unknown as { __puts: { store: string; bytes: number }[] };
  w.__puts = [];
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    let bytes = 0;
    try { bytes = JSON.stringify(value)?.length ?? 0; } catch { bytes = -1; }
    w.__puts.push({ store: this.name, bytes });
    return original.call(this, value as never, key as never);
  } as typeof original;
});
await page.goto(`${ORIGIN}/editor`, { waitUntil: "networkidle" });
const form = page.locator("form.ac-devsignin");
await form.waitFor({ timeout: 20000 });
await form.locator("input[type=email]").fill("visual-demo@texttext.local");
await form.locator("button[type=submit]").click();
await page.waitForSelector(".workspace-item-option", { timeout: 30000 });
await page.waitForTimeout(2500);
await page.evaluate("globalThis.__name = (fn) => fn");
const read = () => page.evaluate(() => (window as unknown as { __puts: { store: string; bytes: number }[] }).__puts.length);
const bytes = () => page.evaluate(() =>
  (window as unknown as { __puts: { store: string; bytes: number }[] }).__puts.reduce((s, p) => s + Math.max(p.bytes, 0), 0));
console.log(`after sign-in and warm: ${await read()} puts, ${((await bytes()) / 1048576).toFixed(1)} MB written`);
for (let r = 1; r <= 3; r += 1) {
  await page.locator('.workspace-item-option:has-text("Perf test 8MB")').first().click();
  await page.waitForFunction(() => {
    const s = document.querySelectorAll(".tt-prose, .tt-md-surface");
    return [...s].some((el) => (el.textContent?.length ?? 0) > 40);
  }, undefined, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.keyboard.press("Backspace");
  await page.waitForFunction(() => document.querySelectorAll(".workspace-item-option").length > 3,
    undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const breakdown = await page.evaluate(() => {
    const puts = (window as unknown as { __puts: { store: string; bytes: number }[] }).__puts;
    const by = new Map<string, { n: number; mb: number }>();
    for (const p of puts) {
      const e = by.get(p.store) ?? { n: 0, mb: 0 };
      e.n += 1; e.mb += Math.max(p.bytes, 0) / 1048576;
      by.set(p.store, e);
    }
    return [...by.entries()].map(([k, v]) => `${k}: ${v.n} puts / ${v.mb.toFixed(0)} MB`).join("  |  ");
  });
  console.log(`after open ${r}: ${await read()} puts, ${((await bytes()) / 1048576).toFixed(0)} MB  [${breakdown}]`);
}
await browser.close();
