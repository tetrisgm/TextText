// Diagnostic: dev-login via NextAuth callback POST (hydration-proof), then dump
// the workspace home DOM so the benchmark can target real selectors.
import { chromium } from "playwright";
const BASE = process.env.BENCH_BASE || "http://localhost:3100";
const EMAIL = process.env.BENCH_EMAIL || "bench@example.com";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

// 1. CSRF
const csrf = await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json();
// 2. credentials callback (dev-login provider)
const cb = await ctx.request.post(`${BASE}/api/auth/callback/dev-login`, {
  form: { csrfToken: csrf.csrfToken, email: EMAIL, name: "Bench", callbackUrl: `${BASE}/editor`, json: "true" },
});
console.log("CALLBACK", cb.status(), (await cb.text()).slice(0, 120));
const cookies = await ctx.cookies();
console.log("SESSION_COOKIE:", cookies.some((c) => /session-token/.test(c.name)) ? "set" : "MISSING", cookies.map((c) => c.name).join(","));

// 3. provision + land on home
await page.goto(`${BASE}/start?to=home`, { waitUntil: "networkidle" });
console.log("HOME_URL:", page.url());

const info = await page.evaluate(() => {
  const pick = (sel) => Array.from(document.querySelectorAll(sel)).slice(0, 8).map((e) => ({
    tag: e.tagName.toLowerCase(),
    cls: (e.className || "").toString().slice(0, 70),
    href: e.getAttribute("href") || undefined,
    text: (e.textContent || "").trim().slice(0, 36),
  }));
  return {
    title: document.title,
    h1: (document.querySelector("h1")?.textContent || "").trim().slice(0, 60),
    sidebarLinks: pick("aside a, nav a, [class*=sidebar] a, [class*=folder] a, [class*=Folder] a"),
    mainLinks: pick("main a[href], article a[href]"),
    cards: pick("[class*=card], [class*=Card], article"),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
