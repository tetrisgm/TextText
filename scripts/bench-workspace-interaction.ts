/**
 * Workspace interaction benchmark: hover-sweep FPS over the item list and
 * click-to-content latency for opening a document. Chromium and WebKit.
 * Server on :3131 with dev sign-in.
 */
import { chromium, webkit, type Browser, type Page } from "playwright";

const ORIGIN = "http://localhost:3131";
const OWNER_EMAIL = "visual-demo@texttext.local";

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

async function signIn(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}/editor`, { waitUntil: "networkidle" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor({ timeout: 20000 });
  await form.locator("input[type=email]").fill(OWNER_EMAIL);
  await form.locator("button[type=submit]").click();
  await page.waitForTimeout(1500);
}

async function installFrameProbe(page: Page): Promise<void> {
  await page.evaluate("globalThis.__name = (fn) => fn");
  await page.evaluate(() => {
    const w = window as unknown as {
      __frames: number[] | null;
      __startFrames: () => void;
      __stopFrames: () => number[] | null;
    };
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

async function hoverSweep(page: Page, label: string): Promise<void> {
  const rows = page.locator(".workspace-item-option");
  const count = await rows.count();
  if (count < 2) {
    console.log(`${label}: not enough rows (${count})`);
    return;
  }
  const first = await rows.first().boundingBox();
  const last = await rows.nth(Math.min(count - 1, 10)).boundingBox();
  if (!first || !last) return;
  await page.evaluate(() => (window as unknown as { __startFrames: () => void }).__startFrames());
  // Sweep up and down the list for ~2s with fine steps, like a real mouse.
  const steps = 60;
  const x = first.x + first.width / 2;
  for (let pass = 0; pass < 4; pass += 1) {
    const from = pass % 2 === 0 ? first.y + 4 : last.y + last.height - 4;
    const to = pass % 2 === 0 ? last.y + last.height - 4 : first.y + 4;
    for (let i = 0; i <= steps; i += 1) {
      await page.mouse.move(x, from + ((to - from) * i) / steps);
      await page.waitForTimeout(8);
    }
  }
  const frames = await page.evaluate(() =>
    (window as unknown as { __stopFrames: () => number[] | null }).__stopFrames(),
  );
  if (!frames || frames.length < 3) {
    console.log(`${label}: no frames`);
    return;
  }
  const gaps: number[] = [];
  for (let i = 1; i < frames.length; i += 1) gaps.push(frames[i] - frames[i - 1]);
  gaps.sort((a, b) => a - b);
  const seconds = (frames[frames.length - 1] - frames[0]) / 1000;
  console.log(
    `${label.padEnd(30)} ${((frames.length - 1) / seconds).toFixed(0)}fps  p95gap ${quantile(gaps, 0.95).toFixed(1)}ms  maxgap ${gaps[gaps.length - 1].toFixed(1)}ms`,
  );
}

async function openLatency(page: Page, label: string): Promise<void> {
  // Click each of the first rows once (cold), measuring click to the moment
  // the editor surface carries real body text.
  const samples: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    await page.goto(`${ORIGIN}/@visual-demo`);
    await page.locator(".workspace-item-option").first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200);
    const row = page.locator(".workspace-item-option").nth(i);
    const title = (await row.innerText()).split("\n")[0]?.trim();
    const t0 = Date.now();
    await row.click();
    await page
      .waitForFunction(
        () => {
          const surface = document.querySelector(
            ".tt-md-surface, .workspace-post-reader, .unified-document-reader",
          );
          const status = document.querySelector(".workspace-post-body-status");
          return Boolean(surface && surface.textContent && surface.textContent.length > 0) && !status;
        },
        undefined,
        { timeout: 20000 },
      )
      .catch(() => {});
    samples.push(Date.now() - t0);
    void title;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  console.log(
    `${label.padEnd(30)} open click-to-content ms: ${samples.map((s) => s.toFixed(0)).join(", ")} (p50 ${quantile(sorted, 0.5).toFixed(0)})`,
  );
}

async function run(): Promise<void> {
  for (const [engineName, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ] as const) {
    const browser: Browser = await engine.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page);
    await page.goto(`${ORIGIN}/@visual-demo`);
    await page.locator(".workspace-item-option").first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    await installFrameProbe(page);
    await hoverSweep(page, `${engineName} list hover sweep`);
    await openLatency(page, `${engineName}`);
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
