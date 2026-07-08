// Navigation latency benchmark for the write app (PRODUCTION build only).
// Measures click-to-rendered ms for the hot owner actions. Not shipped.
//   node bench/nav-bench.mjs         (label defaults to "baseline")
//   BENCH_LABEL=after-ws1 node bench/nav-bench.mjs
import { chromium } from "playwright";

const BASE = process.env.BENCH_BASE || "http://localhost:3100";
const EMAIL = process.env.BENCH_EMAIL || "bench@example.com";
const SAMPLES = Number(process.env.BENCH_SAMPLES || 7);
const LABEL = process.env.BENCH_LABEL || "baseline";
const HANDLE = "/@bench";

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

// click-to-rendered: stamp in-page, trigger, wait for the destination signal
async function measure(page, trigger, ready) {
  await page.waitForLoadState("networkidle").catch(() => {});
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
    try {
      await prep();
      times.push(await measure(page, trigger, ready));
    } catch (e) {
      lastErr = String(e).split("\n")[0].slice(0, 80);
    }
  }
  const r = times.length ? { action: name, ...stats(times) } : { action: name, error: "all failed: " + lastErr };
  console.log("  •", name, "->", times.length ? `median ${r.median}ms p95 ${r.p95}ms (n=${r.n})` : r.error);
  return r;
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await login(ctx);
const page = await ctx.newPage();
await page.goto(`${BASE}${HANDLE}`, { waitUntil: "networkidle" });

const results = [];

// 1. Open a post: home -> click a card -> reader visible
results.push(await run(page, "open post",
  async () => { await page.goto(`${BASE}${HANDLE}`, { waitUntil: "networkidle" }); },
  async () => { await page.locator("a.tvcard").first().click(); },
  "article.reader"));

// 2. Back to blog root: post -> Back -> card grid visible
results.push(await run(page, "back to root",
  async () => { await page.goto(`${BASE}${HANDLE}/bench-article-05`, { waitUntil: "networkidle" }); },
  async () => { await page.locator('a.post-detail-nav[aria-label="Back"]').first().click(); },
  "a.tvcard"));

// 3. Folder switch: home (Blog) -> Bookmarks folder -> its content
results.push(await run(page, "folder switch (Bookmarks)",
  async () => { await page.goto(`${BASE}${HANDLE}`, { waitUntil: "networkidle" }); },
  async () => { await page.locator(".post-editor-folder-name", { hasText: "Bookmarks" }).first().click(); },
  "a.tvcard, .tvcard, article"));

// 4. Open a bookmark: in Bookmarks folder -> open the card -> reader
results.push(await run(page, "open bookmark",
  async () => {
    await page.goto(`${BASE}${HANDLE}`, { waitUntil: "networkidle" });
    await page.locator(".post-editor-folder-name", { hasText: "Bookmarks" }).first().click();
    await page.waitForLoadState("networkidle").catch(() => {});
  },
  async () => { await page.locator("a.tvcard").first().click(); },
  "article, .reader"));

// 5. Enter editor: post -> Edit -> ProseMirror mounted
results.push(await run(page, "enter editor",
  async () => { await page.goto(`${BASE}${HANDLE}/bench-article-05`, { waitUntil: "networkidle" }); },
  async () => { await page.locator("a.post-owner-edit").first().click(); },
  ".ProseMirror", 5));

// 6. Exit editor: editor -> Escape/Done -> reader
results.push(await run(page, "exit editor",
  async () => {
    await page.goto(`${BASE}${HANDLE}/bench-article-05?edit=1`, { waitUntil: "networkidle" });
    await page.waitForSelector(".ProseMirror", { state: "visible", timeout: 30000 }).catch(() => {});
  },
  async () => {
    const done = page.getByRole("button", { name: /done/i });
    if (await done.count()) await done.first().click();
    else await page.keyboard.press("Escape");
  },
  "article.reader", 5));

console.log(`\n=== NAV BENCHMARK [${LABEL}] (ms, prod build, ${SAMPLES} samples) ===`);
console.table(results);
console.log(JSON.stringify({ label: LABEL, results }));
await browser.close();
