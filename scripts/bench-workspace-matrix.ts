/**
 * The whole-app interaction matrix: every major workspace interaction, timed
 * from trigger to painted result, in Chromium and WebKit. This is the lane
 * behind the owner ruling that no interaction may unfold a performance
 * surprise: run it after workspace changes and compare the table.
 *
 * Node-side timing includes ~5-15ms of driver overhead (the no-op row
 * calibrates it); judge rows relative to that floor, not to zero.
 *
 * Server on :3131 with dev sign-in (npm run build && PORT=3131 npm start).
 */
import { chromium, webkit, type Browser, type Page } from "playwright";

const ORIGIN = "http://localhost:3131";
const HANDLE = process.env.BENCH_HANDLE ?? "visual-demo";
const OWNER_EMAIL = process.env.BENCH_EMAIL ?? "visual-demo@texttext.local";
const REPS = 3;

type Row = { name: string; samples: number[] };

async function signIn(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}/editor`, { waitUntil: "networkidle" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor({ timeout: 30000 });
  await form.locator("input[type=email]").fill(OWNER_EMAIL);
  await form.locator("button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/editor"), {
    timeout: 20000,
  });
  await page.waitForTimeout(800);
}

async function settled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function goHome(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}/@${HANDLE}`);
  await page.locator(".workspace-item-option").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(900);
}

async function measure(
  page: Page,
  rows: Row[],
  name: string,
  act: () => Promise<void>,
  ready: () => Promise<void>,
  reset?: () => Promise<void>,
): Promise<void> {
  const row: Row = { name, samples: [] };
  for (let i = 0; i < REPS; i += 1) {
    const start = Date.now();
    await act();
    await ready();
    await settled(page);
    row.samples.push(Date.now() - start);
    if (reset) await reset();
  }
  rows.push(row);
}

async function run(): Promise<void> {
  for (const [engineName, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ] as const) {
    const browser: Browser = await engine.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setViewportSize({ width: 1400, height: 900 });
    await signIn(page);
    await goHome(page);
    await page.evaluate("globalThis.__name = (fn) => fn");
    const rows: Row[] = [];
    const visible = (selector: string) => async () => {
      await page.locator(selector).first().waitFor({ state: "visible", timeout: 10000 });
    };
    const hidden = (selector: string) => async () => {
      await page
        .locator(selector)
        .first()
        .waitFor({ state: "hidden", timeout: 10000 })
        .catch(() => {});
    };

    // Calibration: driver + double-rAF floor.
    await measure(page, rows, "(driver floor)", async () => {}, async () => {});

    await measure(
      page,
      rows,
      "folder switch (sidebar)",
      async () => {
        await page.locator("[data-workspace-sidebar-path=notes]").click();
      },
      visible(
        "[data-workspace-sidebar-path=notes][aria-current=true]",
      ),
      async () => {
        await page.locator("[data-workspace-sidebar-path=blog]").click();
        await page.waitForTimeout(250);
      },
    );

    await measure(
      page,
      rows,
      "home (sidebar)",
      async () => {
        await page.getByRole("button", { name: "Home" }).first().click().catch(async () => {
          await page.locator("[data-workspace-sidebar-path=blog]").click();
        });
      },
      visible(".workspace-item-option"),
    );

    await measure(
      page,
      rows,
      "open item (read view)",
      async () => {
        await page
          .locator(".workspace-item-option", { hasText: "Reader images fixture" })
          .first()
          .click();
      },
      visible(".tt-prose"),
      async () => {
        await page.evaluate(() => history.back());
        await visible(".workspace-item-option")();
        await page.waitForTimeout(250);
      },
    );

    await measure(
      page,
      rows,
      "open item (editor)",
      async () => {
        await page
          .locator(".workspace-item-option", { hasText: "Perf test 100kB" })
          .first()
          .click();
      },
      visible(".tt-md-surface"),
      async () => {
        await page.evaluate(() => history.back());
        await visible(".workspace-item-option")();
        await page.waitForTimeout(250);
      },
    );

    await measure(
      page,
      rows,
      "history back to list",
      async () => {
        await page
          .locator(".workspace-item-option", { hasText: "Reader images fixture" })
          .first()
          .click();
        await visible(".tt-prose")();
        await page.evaluate(() => history.back());
      },
      visible(".workspace-item-option"),
      async () => {
        await page.waitForTimeout(200);
      },
    );

    await measure(
      page,
      rows,
      "history forward to item",
      async () => {
        await page.evaluate(() => history.forward());
      },
      visible(".tt-prose"),
      async () => {
        await page.evaluate(() => history.back());
        await visible(".workspace-item-option")();
        await page.waitForTimeout(200);
      },
    );

    await measure(
      page,
      rows,
      "search open (/) + first char",
      async () => {
        await page.keyboard.press("/");
        await page.keyboard.type("perf");
      },
      visible(".workspace-item-option"),
      async () => {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(250);
      },
    );

    await measure(
      page,
      rows,
      "command palette open",
      async () => {
        await page.keyboard.press("Meta+k");
      },
      visible("[role=dialog], [class*=palette]"),
      async () => {
        await page.keyboard.press("Escape");
        await hidden("[role=dialog], [class*=palette]")();
        await page.waitForTimeout(200);
      },
    );

    // Settings opens client-side from the workspace-name menu.
    await measure(
      page,
      rows,
      "settings open (menu)",
      async () => {
        await page.locator("[aria-haspopup=menu]").first().click();
        await page.getByRole("menuitem", { name: "Settings" }).click().catch(async () => {
          await page.getByText("Settings", { exact: true }).first().click();
        });
      },
      visible("#workspace-settings-title"),
      async () => {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        await goHome(page);
      },
    );

    await measure(
      page,
      rows,
      "escape from item to list",
      async () => {
        await page
          .locator(".workspace-item-option", { hasText: "Reader images fixture" })
          .first()
          .click();
        await visible(".tt-prose")();
        await page.keyboard.press("Escape");
      },
      visible(".workspace-item-option"),
      async () => {
        await page.waitForTimeout(200);
      },
    );

    // Wide windows pin the rail by default; measure the hide/show pair.
    await measure(
      page,
      rows,
      "assistant hide",
      async () => {
        await page.locator("[aria-label='Hide assistant']").click();
      },
      visible("[aria-label^='Open assistant'], [aria-label^='Chat with']"),
      async () => {
        await page
          .locator("[aria-label^='Open assistant'], [aria-label^='Chat with']")
          .first()
          .click();
        await visible("[aria-label='Hide assistant']")();
        await page.waitForTimeout(200);
      },
    );

    await measure(
      page,
      rows,
      "assistant show",
      async () => {
        await page.locator("[aria-label='Hide assistant']").click();
        await visible("[aria-label^='Open assistant'], [aria-label^='Chat with']")();
        await page
          .locator("[aria-label^='Open assistant'], [aria-label^='Chat with']")
          .first()
          .click();
      },
      visible("[aria-label='Hide assistant']"),
      async () => {
        await page.waitForTimeout(200);
      },
    );

    const fmt = (samples: number[]) => {
      const sorted = [...samples].sort((a, b) => a - b);
      return `${sorted[Math.floor(sorted.length / 2)]}ms [${samples.join(",")}]`;
    };
    console.log(`\n=== ${engineName}`);
    for (const row of rows) {
      console.log(`${row.name.padEnd(28)} ${fmt(row.samples)}`);
    }
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
