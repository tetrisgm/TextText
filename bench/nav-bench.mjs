// Navigation latency benchmark for the write app (PRODUCTION build only).
// Measures click-to-rendered ms for the hot owner actions. Not shipped.
//   node bench/nav-bench.mjs
//   BENCH_LABEL=after node bench/nav-bench.mjs
import { chromium } from "playwright";

const BASE = process.env.BENCH_BASE || "http://localhost:3100";
const EMAIL = process.env.BENCH_EMAIL || "bench@example.com";
const SAMPLES = Number(process.env.BENCH_SAMPLES || 6);
const LABEL = process.env.BENCH_LABEL || "baseline";
const H = "/@bench";
const BOOKMARK = "Texttext AI setup guide"; // seed bookmark title, unique to Bookmarks folder

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: Math.round(s[0]), median: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(s[s.length - 1]) };
}
async function login(ctx) {
  const csrf = await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json();
  await ctx.request.post(`${BASE}/api/auth/callback/dev-login`, {
    form: { csrfToken: csrf.csrfToken, email: EMAIL, name: "Bench", callbackUrl: `${BASE}/editor`, json: "true" },
  });
}
// domcontentloaded avoids the collab long-poll that stops the editor route ever
// reaching networkidle
async function goto(page, url, startSel) {
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  if (startSel) await page.waitForSelector(startSel, { state: "visible", timeout: 8000 });
}
async function measure(page, trigger, ready) {
  const t0 = await page.evaluate(() => performance.now());
  await trigger();
  await page.waitForSelector(ready, { state: "visible", timeout: 8000 });
  const t1 = await page.evaluate(() => performance.now());
  return t1 - t0;
}
async function run(page, name, prep, trigger, ready, samples = SAMPLES) {
  const times = [];
  let lastErr = "";
  for (let i = 0; i < samples; i++) {
    try { await prep(); times.push(await measure(page, trigger, ready)); }
    catch (e) { lastErr = String(e).split("\n")[0].slice(0, 70); }
  }
  const r = times.length ? { action: name, ...stats(times) } : { action: name, error: "all failed: " + lastErr };
  console.log("  -", name, "->", times.length ? `median ${r.median}ms  p95 ${r.p95}ms  (n=${r.n})` : r.error);
  return r;
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await login(ctx);
const page = await ctx.newPage();
await goto(page, H, "a.tvcard");
const results = [];

results.push(await run(page, "open post",
  () => goto(page, H, "a.tvcard"),
  () => page.locator("a.tvcard").first().click(),
  "article.reader"));

results.push(await run(page, "back to root",
  () => goto(page, `${H}/bench-article-05`, "article.reader"),
  () => page.locator('a.post-detail-nav[aria-label="Back"]').first().click(),
  "a.tvcard"));

results.push(await run(page, "folder switch (Bookmarks)",
  () => goto(page, H, "button.post-editor-folder-main"),
  () => page.locator("button.post-editor-folder-main", { hasText: "Bookmarks" }).first().click(),
  `a.tvcard:has-text("${BOOKMARK}")`));

results.push(await run(page, "open bookmark",
  async () => {
    await goto(page, H, "button.post-editor-folder-main");
    await page.locator("button.post-editor-folder-main", { hasText: "Bookmarks" }).first().click();
    await page.waitForSelector(`a.tvcard:has-text("${BOOKMARK}")`, { state: "visible", timeout: 8000 });
  },
  () => page.locator(`a.tvcard:has-text("${BOOKMARK}")`).first().click(),
  "article, .reader"));

results.push(await run(page, "enter editor",
  () => goto(page, `${H}/bench-article-05`, "a.post-owner-edit"),
  () => page.locator("a.post-owner-edit").first().click(),
  ".ProseMirror", 5));

results.push(await run(page, "exit editor",
  () => goto(page, `${H}/bench-article-05?edit=1`, ".ProseMirror"),
  async () => {
    const done = page.getByRole("button", { name: /done/i });
    if (await done.count()) await done.first().click(); else await page.keyboard.press("Escape");
  },
  "article.reader", 5));

console.log(`\n=== NAV BENCHMARK [${LABEL}] (ms, prod build, ${SAMPLES} samples) ===`);
console.table(results);
console.log("JSON " + JSON.stringify({ label: LABEL, results }));
await browser.close();
