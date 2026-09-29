/** Bounded production-preview baseline for the current workspace shell.
 * Run against a locally built server on :3131 with the visual-demo fixture.
 * It reads existing content and makes no persistent workspace mutations.
 */
import { chromium } from "playwright";

const origin = process.env.BENCH_ORIGIN ?? "http://localhost:3131";
const handle = process.env.BENCH_HANDLE ?? "visual-demo";
const email = process.env.BENCH_EMAIL ?? "visual-demo@texttext.local";
const rounds = Number(process.env.BENCH_ROUNDS ?? 20);
const homeRows = ".workspace-recent-list .workspace-item-option-main, .personal-home li button";

function report(name: string, values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  console.log(`${name}: n=${values.length} median=${sorted[Math.floor(sorted.length / 2)]}ms p95=${p95}ms max=${sorted.at(-1)}ms`);
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${origin}/editor`, { waitUntil: "domcontentloaded" });
    const form = page.locator("form.ac-devsignin");
    await form.waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => {
      const form = document.querySelector("form.ac-devsignin");
      return form && Object.keys(form).some((key) => key.startsWith("__reactProps$"));
    }, undefined, { timeout: 20_000 });
    await form.locator("input[type=email]").fill(email);
    await form.locator("button[type=submit]").click();
    await page.waitForURL((url) => !url.pathname.startsWith("/editor"), { timeout: 30_000, waitUntil: "domcontentloaded" });

    const coldStart = Date.now();
    await page.goto(`${origin}/@${handle}`, { waitUntil: "domcontentloaded" });
    await page.locator(homeRows).first().waitFor({ timeout: 30_000 });
    const coldHome = Date.now() - coldStart;
    console.log(`cold navigation to first Home item: ${coldHome}ms (one new page navigation, includes browser driver and server work)`);

    const command: number[] = [];
    for (let i = 0; i < rounds; i += 1) {
      const start = Date.now();
      await page.keyboard.press("Meta+k");
      await page.locator(".command-palette-input").waitFor({ state: "visible" });
      await page.waitForFunction(() => document.activeElement?.classList.contains("command-palette-input"));
      command.push(Date.now() - start);
      await page.keyboard.press("Escape");
      await page.locator(".command-palette-input").waitFor({ state: "hidden" });
    }
    report("warm Command-K focus (driver included)", command);

    const folder: number[] = [];
    for (let i = 0; i < rounds; i += 1) {
      const start = Date.now();
      await page.locator('[data-workspace-sidebar-path="notes"]').click();
      await page.locator(".post-folder-page").waitFor({ state: "visible" });
      await page.getByRole("heading", { name: "Notes", exact: true }).waitFor({ state: "visible" });
      await page.locator('[data-workspace-sidebar-path="notes"][aria-current="true"]').waitFor();
      folder.push(Date.now() - start);
      await page.locator('[data-workspace-sidebar-path="blog"]').click();
      await page.locator('[data-workspace-sidebar-path="blog"][aria-current="true"]').waitFor();
      await page.getByRole("heading", { name: "Blog", exact: true }).waitFor({ state: "visible" });
      await page.waitForFunction(() => !document.documentElement.hasAttribute("data-nav-transition"));
    }
    report("warm folder switch to Notes (driver included)", folder);

    await page.getByRole("button", { name: "All items", exact: true }).click();
    await page.locator(homeRows).first().waitFor();
    const itemRow = page.locator(homeRows).filter({ hasText: "Codex capture verification" }).first();
    // The first open may fetch its body and lazy reader code. Measure it
    // separately before the repeated, already loaded path.
    const firstOpenStart = Date.now();
    await itemRow.click();
    await page.locator(".tt-prose, .tt-md-surface, .bookmark-reader-view").first().waitFor({ state: "visible", timeout: 20_000 });
    console.log(`first-item open after Home: ${Date.now() - firstOpenStart}ms (driver included)`);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await itemRow.waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-nav-transition"));

    const item: number[] = [];
    const inPageItem: number[] = [];
    for (let i = 0; i < rounds; i += 1) {
      await page.evaluate(() => {
        const mark = { elapsed: -1, started: false };
        Reflect.set(window, "__ttItemOpenMark", mark);
        let startedAt = 0;
        const observer = new MutationObserver(() => {
          if (!startedAt || mark.elapsed >= 0) return;
          if (!document.querySelector(".tt-prose, .tt-md-surface, .bookmark-reader-view")) return;
          mark.elapsed = performance.now() - startedAt;
          observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        window.addEventListener("pointerdown", () => {
          mark.started = true;
          startedAt = performance.now();
        }, { capture: true, once: true });
      });
      const start = Date.now();
      await itemRow.click();
      await page.locator(".tt-prose, .tt-md-surface, .bookmark-reader-view").first().waitFor({ state: "visible", timeout: 20_000 });
      item.push(Date.now() - start);
      await page.waitForFunction(() => (Reflect.get(window, "__ttItemOpenMark") as { elapsed: number }).elapsed >= 0);
      inPageItem.push(Math.round((await page.evaluate(() => Reflect.get(window, "__ttItemOpenMark") as { elapsed: number })).elapsed));
      await page.goBack({ waitUntil: "domcontentloaded" });
      await itemRow.waitFor({ timeout: 20_000 });
      // Waiting for the return slide prevents Playwright's click-actionability
      // delay from being misreported as time spent opening the next item.
      await page.waitForFunction(() => !document.documentElement.hasAttribute("data-nav-transition"));
    }
    report("warm settled first-item open (driver included)", item);
    report("warm settled note click to reader DOM (in-page)", inPageItem);
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message.split("\n")[0] : "Browser benchmark failed");
  process.exitCode = 1;
});
