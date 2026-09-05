/**
 * Walk every workspace surface in both themes and write a screenshot per
 * (surface, theme). Run before a change and after, then compare with
 * scripts/visual-diff.mjs: anything that moves is either the change you
 * meant or the one you did not.
 *
 *   npx tsx scripts/visual-surfaces.mts <outDir>
 *
 * Needs a production server on :3131 with AUTH_DEV_LOGIN=1 and the
 * visual-demo fixture workspace. Two runs of the same build are
 * pixel-identical, so any difference at all is the change you made.
 */
import { webkit, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const ORIGIN = process.env.VISUAL_ORIGIN ?? "http://localhost:3131";
const OUT = process.argv[2];
if (!OUT) throw new Error("usage: visual-surfaces.mts <outDir>");
mkdirSync(OUT, { recursive: true });

/**
 * Nothing outside the app under test.
 *
 * A workspace bookmark of texttext.app renders that site's favicon, so the
 * walk was racing a request to production: the image arrived in time on some
 * runs and not on others, and one row flickered. A screenshot suite that
 * depends on the network is measuring the network. Aborting off-origin
 * requests makes the walk deterministic and faster, and every fixture's own
 * fallback is what a reader would see offline anyway.
 */
async function blockOffOrigin(page: Page) {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(ORIGIN) || url.startsWith("data:") || url.startsWith("blob:")) {
      return route.continue();
    }
    return route.abort();
  });
}

async function signIn(page: Page) {
  // domcontentloaded, not networkidle: once a workspace is open the collab
  // relay and the changes feed both hold a long poll, so the network never
  // goes idle and the sign-in form is never waited for. Same reason as the
  // published-page load below.
  await page.goto(`${ORIGIN}/editor`, { waitUntil: "domcontentloaded" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor({ timeout: 20000 });
  await form.locator("input[type=email]").fill("visual-demo@texttext.local");
  await form.locator("button[type=submit]").click();
  await page.waitForSelector("[data-workspace-post-id]", { timeout: 30000 });
  await page.waitForTimeout(1800);
}

const shot = async (page: Page, name: string, theme: string) => {
  await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
};

const browser = await webkit.launch();
for (const theme of ["light", "dark"] as const) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await blockOffOrigin(page);
  await signIn(page);

  await shot(page, "01-home", theme);

  await page
    .locator("[data-workspace-post-id]")
    .nth(2)
    .click({ position: { x: 500, y: 18 } });
  await page.waitForTimeout(1400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(900);
  await page.keyboard.press("Meta+a");
  await page.waitForTimeout(700);
  await shot(page, "02-selection", theme);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  const modes = await page.locator('[aria-label="View mode"] button').count();
  for (let i = 0; i < Math.min(modes, 3); i += 1) {
    await page.locator('[aria-label="View mode"] button').nth(i).click();
    await page.waitForTimeout(900);
    await shot(page, `03-view-${i}`, theme);
  }
  if (modes > 0) {
    await page.locator('[aria-label="View mode"] button').first().click();
    await page.waitForTimeout(700);
  }

  await page.locator("[data-workspace-post-id]").first().click();
  await page.waitForTimeout(2500);
  await shot(page, "04-item-read", theme);
  await page.keyboard.press("e");
  await page.waitForTimeout(2000);
  await shot(page, "05-item-edit", theme);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);

  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(900);
  await shot(page, "06-palette", theme);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await page.keyboard.press("Shift+Slash");
  await page.waitForTimeout(900);
  await shot(page, "07-shortcuts", theme);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  await page.keyboard.press("Backspace");
  await page.waitForTimeout(1500);
  for (const [name, path] of [
    ["08-starred", "__starred__"],
    ["09-shared", "__shared__"],
    ["10-trash", "__trash__"],
    ["11-collection", "notes"],
  ] as const) {
    const row = page.locator(`[data-workspace-sidebar-path="${path}"]`).first();
    if ((await row.count()) === 0) continue;
    await row.click();
    await page.waitForTimeout(1800);
    await shot(page, name, theme);
  }

  await page.keyboard.press("Slash");
  await page.waitForTimeout(700);
  await page.keyboard.type("test");
  await page.waitForTimeout(1600);
  await shot(page, "12-search", theme);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // domcontentloaded, not networkidle: the published page keeps a poll open
  // and networkidle never settles.
  await page.goto(`${ORIGIN}/t/visual-demo`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await shot(page, "13-published", theme);
  await ctx.close();
}
await browser.close();
console.log(`surfaces written to ${OUT}`);
