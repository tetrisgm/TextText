/**
 * Where the time goes at runtime, in Chromium where we can ask the engine
 * directly: style recalculations, layouts, and script, per interaction.
 * Frame gaps alone say something is slow; these say what.
 *
 *   npx tsx scripts/runtime-profile.mts
 *
 * Needs the same server as scripts/visual-surfaces.mts. Wall-clock on a busy
 * laptop cannot resolve a 15ms difference; these counters can, because they
 * count work rather than time. The click-to-readable figure is the one that
 * matters: everything after that moment is housekeeping.
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
  await page.waitForTimeout(1600);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await signIn(page);
const client = await page.context().newCDPSession(page);
await client.send("Performance.enable");

const counters = async () => {
  const { metrics } = await client.send("Performance.getMetrics");
  const get = (n: string) => metrics.find((m) => m.name === n)?.value ?? 0;
  return {
    recalcs: get("RecalcStyleCount"),
    recalcMs: get("RecalcStyleDuration") * 1000,
    layouts: get("LayoutCount"),
    layoutMs: get("LayoutDuration") * 1000,
    scriptMs: get("ScriptDuration") * 1000,
  };
};
const delta = (a: Record<string, number>, b: Record<string, number>) =>
  Object.fromEntries(
    Object.keys(a).map((k) => [k, Math.round((b[k] - a[k]) * 10) / 10]),
  );

// A hover sweep down the list, the interaction that was reported as heavy.
const rows = await page.locator(".workspace-item-option").all();
let before = await counters();
for (let pass = 0; pass < 3; pass += 1) {
  for (const row of rows) {
    const box = await row.boundingBox();
    if (!box) continue;
    await page.mouse.move(box.x + 200, box.y + box.height / 2);
  }
}
console.log("hover sweep (3 passes)", JSON.stringify(delta(before, await counters())));

// Scrolling the list.
before = await counters();
for (let i = 0; i < 12; i += 1) {
  await page.mouse.wheel(0, 180);
  await page.waitForTimeout(60);
}
console.log("scroll 12 ticks     ", JSON.stringify(delta(before, await counters())));

// The cost BETWEEN the click and the moment the reader is readable, which
// is the part anyone feels. Everything after that is housekeeping.
const criticalTotals = { recalcs: 0, recalcMs: 0, layouts: 0, layoutMs: 0, scriptMs: 0 };
for (let i = 0; i < 5; i += 1) {
  const at0 = await counters();
  await page.locator(".workspace-item-option").nth(i).click();
  await page.waitForFunction(() => {
    const s = document.querySelectorAll(".tt-prose, .tt-md-surface");
    return [...s].some((el) => (el.textContent?.length ?? 0) > 40);
  }, undefined, { timeout: 15000 }).catch(() => {});
  const d = delta(at0, await counters());
  for (const k of Object.keys(criticalTotals)) {
    (criticalTotals as Record<string, number>)[k] += (d as Record<string, number>)[k];
  }
  await page.waitForTimeout(900);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(900);
}
const per = Object.fromEntries(
  Object.entries(criticalTotals).map(([k, v]) => [k, Math.round((v / 5) * 10) / 10]),
);
console.log("click -> readable, per open", JSON.stringify(per));
await browser.close();
