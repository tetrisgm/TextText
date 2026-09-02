/**
 * Chromium devtools trace of a typing burst on the editor: aggregates native
 * work (style recalc, layout, paint, DOM GC etc.) so the non-JS share of
 * keystroke latency is attributable. Server on :3131 with dev sign-in.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const ORIGIN = "http://localhost:3131";
const OWNER_EMAIL = "visual-demo@texttext.local";
const TRACE_PATH = "/tmp/tt-editor-trace.json";

async function run(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/editor`, { waitUntil: "networkidle" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor({ timeout: 20000 });
  await form.locator("input[type=email]").fill(OWNER_EMAIL);
  await form.locator("button[type=submit]").click();
  await page.waitForTimeout(1500);
  await page.goto(`${ORIGIN}/@visual-demo/perf-1mb`);
  const surface = page.locator(".tt-document-editor .tt-md-surface").first();
  await surface.waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  await surface.click({ position: { x: 200, y: 100 } });

  await browser.startTracing(page, {
    path: TRACE_PATH,
    categories: [
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "blink.user_timing",
    ],
  });
  await page.keyboard.type(
    "The quick brown fox jumps over the lazy dog 0123456789",
    { delay: 40 },
  );
  await page.waitForTimeout(300);
  await browser.stopTracing();
  await browser.close();

  const trace = JSON.parse(readFileSync(TRACE_PATH, "utf8")) as {
    traceEvents: Array<{
      name: string;
      ph: string;
      dur?: number;
      args?: { data?: { type?: string } };
    }>;
  };
  const byName = new Map<string, { micros: number; count: number }>();
  for (const event of trace.traceEvents) {
    if (event.ph !== "X" || !event.dur) continue;
    const key =
      event.name === "EventDispatch"
        ? `EventDispatch:${event.args?.data?.type ?? "?"}`
        : event.name;
    const entry = byName.get(key) ?? { micros: 0, count: 0 };
    entry.micros += event.dur;
    entry.count += 1;
    byName.set(key, entry);
  }
  const top = [...byName.entries()]
    .sort((a, b) => b[1].micros - a[1].micros)
    .slice(0, 22);
  for (const [name, { micros, count }] of top) {
    console.log(
      `${(micros / 1000).toFixed(1).padStart(8)}ms  x${String(count).padStart(4)}  ${name}`,
    );
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
