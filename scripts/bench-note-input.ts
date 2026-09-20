/** Compare typing and scrolling in an owned 1 MB scratch note.
 * TEXTTEXT_BASE_URL=http://localhost:3109 npx tsx scripts/bench-note-input.ts
 * Optional TEXTTEXT_BASELINE_URL compares an earlier local production build.
 * Uses the existing showcase dev fixture and local Postgres; removes its notes.
 */
import { chromium, webkit, type Page } from "playwright";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
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


async function main() {
 const origins = [process.env.TEXTTEXT_BASELINE_URL, process.env.TEXTTEXT_BASE_URL ?? "http://localhost:3100"].filter((value): value is string => Boolean(value));
 const local = (value: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
 if (!process.env.DATABASE_URL || !local(process.env.DATABASE_URL) || !origins.every(local)) throw Error("Local app and Postgres only");
 const store = await import("../src/lib/store");
 const { closeDatabaseConnections } = await import("../src/lib/db/client");
 const folder = (await store.getFolders("showcase")).find((entry) => entry.mode === "notes");
 if (!folder) throw Error("The existing showcase fixture needs a Notes folder");
 const body = "A performance note with a full page of ordinary text, links, and ideas.\n".repeat(15000);
 const baseline = new Map<string, {latency: number; fps: number}>();
 try {
  for (const [index, origin] of origins.entries()) for (const engine of [chromium, webkit]) {
   const note = await store.createDraftInFolder("showcase", folder.id, {initial:{type:"note",title:"Input benchmark scratch",body}});
   const browser = await engine.launch();
   try {
    const context = await browser.newContext({viewport:{width:1280,height:900}});
    const page = await context.newPage();
    await page.goto(`${origin}/api/auth/csrf`, {waitUntil:"domcontentloaded"});
    const csrfToken = JSON.parse(await page.locator("body").innerText()).csrfToken;
    await page.request.post(`${origin}/api/auth/callback/dev-login`, {form:{csrfToken,email:"showcase@texttext.dev",name:"Showcase",callbackUrl:"/"}});
    await page.addInitScript("window.__ttEditorInspect = true");
    await page.goto(`${origin}/t/showcase/${folder.path}/${note.slug}?edit=1&id=${note.id}`, {waitUntil:"domcontentloaded"});
    await page.waitForFunction("window.__ttEditor && window.__ttEditor().ready", undefined, {timeout:60000});
    await page.waitForTimeout(1500);
    await installProbes(page);
    await page.getByRole("textbox", {name:"Document body",exact:true}).click({position:{x:200,y:100}});
    await typeBurst(page);
    const lat = await readLatency(page);
    const scroller = await page.evaluate(() => {
      let el = document.querySelector('[aria-label="Document body"]') as HTMLElement | null;
      while (el) {
        if (el.scrollHeight > el.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(el).overflowY)) {
          el.dataset.benchScroller = "1";
          return '[data-bench-scroller="1"]';
        }
        el = el.parentElement;
      }
      return "window";
    });
    const scroll = await measureScroll(page, scroller);
    report(`${new URL(origin).port} ${engine.name()} 1MB`, lat, scroll);
    if (lat.n !== TYPE_BURST.length || !Number.isFinite(lat.p95)) throw Error("Typing lost focus or input events; incomplete measurement");
    const previous = baseline.get(engine.name());
    if (previous && (lat.p95 > Math.max(40, previous.latency * 1.2) || scroll.fps < previous.fps * 0.8)) throw Error("Editor performance regressed by more than 20 percent");
    if (index === 0) baseline.set(engine.name(), {latency:lat.p95,fps:scroll.fps});
    await context.close();
   } finally {
    await browser.close();
    await store.deletePost("showcase", note.id!);
    await store.permanentlyDeletePost("showcase", note.id!);
   }
  }
 } finally { await closeDatabaseConnections(); }
}
void main();
