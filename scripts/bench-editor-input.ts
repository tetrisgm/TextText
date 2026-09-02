/**
 * Editor input-latency and scroll-FPS benchmark.
 *
 * Compares a plain <textarea> baseline against the TextText editor surface at
 * a given buffer size, in Chromium and WebKit. Latency is measured per
 * keystroke as input-event timestamp to the second requestAnimationFrame (the
 * frame after the one that paints the edit); scroll FPS as rAF gap statistics
 * during a continuous programmatic scroll.
 *
 * Usage:
 *   npm run build && PORT=3131 npm start &        # editor, with dev sign-in
 *   python3 -m http.server 3132 -d <bench dir> &  # textarea baseline page
 *   node --import tsx scripts/bench-editor-input.ts [mb] [handle] [slug]
 */
import { chromium, webkit, type Browser, type Page } from "playwright";

const MB = Number(process.argv[2] ?? "1");
const HANDLE = process.argv[3] ?? "visual-demo";
const SLUG = process.argv[4] ?? "perf-1mb";
const EDITOR_ORIGIN = "http://localhost:3131";
const BENCH_ORIGIN = "http://localhost:3132";
const OWNER_EMAIL = "visual-demo@texttext.local";
const TYPE_BURST = "The quick brown fox jumps over the lazy dog 0123456789";

type LatencyStats = {
  n: number;
  p50: number;
  p95: number;
  max: number;
};

type ScrollStats = {
  fps: number;
  p95gap: number;
  maxgap: number;
};

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

async function installProbes(page: Page): Promise<void> {
  // tsx's esbuild transform decorates serialized functions with a __name
  // helper; give the page world a no-op so evaluate bodies survive it.
  await page.evaluate("globalThis.__name = (fn) => fn");
  await page.evaluate(() => {
    const w = window as unknown as {
      __lat: number[];
      __frames: number[] | null;
      __startFrames: () => void;
      __stopFrames: () => number[] | null;
    };
    w.__lat = [];
    document.addEventListener(
      "input",
      (event) => {
        const start = event.timeStamp;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            w.__lat.push(performance.now() - start);
          });
        });
      },
      true,
    );
    w.__frames = null;
    w.__startFrames = () => {
      w.__frames = [];
      const tick = (ts: number) => {
        if (!w.__frames) return;
        w.__frames.push(ts);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    w.__stopFrames = () => {
      const frames = w.__frames;
      w.__frames = null;
      return frames;
    };
  });
}

async function readLatency(page: Page): Promise<LatencyStats> {
  const raw = await page.evaluate(
    () => (window as unknown as { __lat: number[] }).__lat,
  );
  const sorted = [...raw].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? NaN,
  };
}

async function typeBurst(page: Page): Promise<void> {
  // Realistic typing cadence; per-key delay keeps keystrokes as separate
  // input events instead of one composed insert.
  await page.keyboard.type(TYPE_BURST, { delay: 40 });
  await page.waitForTimeout(300);
}

async function measureScroll(
  page: Page,
  scroller: string,
): Promise<ScrollStats> {
  const frames = await page.evaluate(async (sel) => {
    const w = window as unknown as {
      __startFrames: () => void;
      __stopFrames: () => number[] | null;
    };
    const el = sel === "window" ? null : document.querySelector(sel);
    const target = el ?? document.scrollingElement!;
    target.scrollTop = 0;
    w.__startFrames();
    const start = performance.now();
    // Continuous scroll for ~2s, one step per frame.
    await new Promise<void>((resolve) => {
      const step = () => {
        target.scrollTop += 24;
        if (performance.now() - start < 2000) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    return w.__stopFrames();
  }, scroller);
  if (!frames || frames.length < 3) return { fps: NaN, p95gap: NaN, maxgap: NaN };
  const gaps: number[] = [];
  for (let i = 1; i < frames.length; i++) gaps.push(frames[i] - frames[i - 1]);
  gaps.sort((a, b) => a - b);
  return {
    fps: (frames.length - 1) / ((frames[frames.length - 1] - frames[0]) / 1000),
    p95gap: quantile(gaps, 0.95),
    maxgap: gaps[gaps.length - 1],
  };
}

function report(label: string, lat: LatencyStats, scroll: ScrollStats): void {
  console.log(
    `${label.padEnd(26)} keystroke p50 ${lat.p50?.toFixed(1)}ms p95 ${lat.p95?.toFixed(1)}ms max ${lat.max?.toFixed(1)}ms (n=${lat.n})  scroll ${scroll.fps.toFixed(0)}fps p95gap ${scroll.p95gap.toFixed(1)}ms maxgap ${scroll.maxgap.toFixed(1)}ms`,
  );
}

async function benchTextarea(browser: Browser, label: string): Promise<void> {
  const page = await browser.newPage();
  await page.goto(`${BENCH_ORIGIN}/textarea.html?mb=${MB}`);
  await page.waitForSelector("#stats:has-text('ready')");
  await installProbes(page);
  await page.click("#t", { position: { x: 200, y: 40 } });
  await typeBurst(page);
  const lat = await readLatency(page);
  const scroll = await measureScroll(page, "#t");
  report(`${label} textarea`, lat, scroll);
  await page.close();
}

async function benchEditor(browser: Browser, label: string): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Dev sign-in as the fixture owner; the dev-login form lives on /editor.
  await page.goto(`${EDITOR_ORIGIN}/editor`, { waitUntil: "networkidle" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor({ timeout: 20000 });
  await form.locator("input[type=email]").fill(OWNER_EMAIL);
  await form.locator("button[type=submit]").click();
  await page.waitForTimeout(1500);
  await page.goto(`${EDITOR_ORIGIN}/@${HANDLE}/${SLUG}`);
  const surface = page
    .locator(".tt-document-editor .tt-md-surface, [contenteditable]")
    .first();
  await surface.waitFor({ timeout: Number(process.env.BENCH_LOAD_TIMEOUT ?? "20000") });
  // Let the document settle (pool hydration, collab bootstrap).
  await page.waitForTimeout(2500);
  await installProbes(page);
  await surface.click({ position: { x: 200, y: 100 } });
  await typeBurst(page);
  const lat = await readLatency(page);
  const scrollerSel = await page.evaluate(() => {
    // Find the element that actually scrolls the editor.
    let el: HTMLElement | null = document.querySelector("[contenteditable]");
    while (el) {
      if (el.scrollHeight > el.clientHeight + 100) {
        el.setAttribute("data-bench-scroller", "1");
        return "[data-bench-scroller]";
      }
      el = el.parentElement;
    }
    return "window";
  });
  const scroll = await measureScroll(page, scrollerSel);
  report(`${label} editor`, lat, scroll);
  await context.close();
}

async function benchStructure(
  browser: Browser,
  label: string,
  mode: string,
): Promise<void> {
  const page = await browser.newPage();
  await page.goto(`${BENCH_ORIGIN}/structure.html?mb=${MB}&mode=${mode}`);
  await page.waitForSelector("#stats:has-text('ready')");
  await installProbes(page);
  await page.click("#e", { position: { x: 200, y: 40 } });
  await typeBurst(page);
  const lat = await readLatency(page);
  const scroll = await measureScroll(page, "#scroller");
  report(`${label} ce-${mode}`, lat, scroll);
  await page.close();
}

async function run(): Promise<void> {
  const suite = process.env.BENCH_SUITE ?? "all";
  console.log(`buffer ${MB}MB, doc /@${HANDLE}/${SLUG}, suite ${suite}\n`);
  for (const [engineName, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ] as const) {
    const browser = await engine.launch();
    try {
      if (suite === "all" || suite === "baseline") {
        await benchTextarea(browser, engineName);
      }
      if (suite === "all" || suite === "structure") {
        for (const mode of ["flat", "rows", "cv"]) {
          await benchStructure(browser, engineName, mode);
        }
      }
      if (suite === "all" || suite === "editor") {
        await benchEditor(browser, engineName);
      }
    } finally {
      await browser.close();
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
