// Live proof of where a layout choice lives now.
//
//   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000 npm run dev
//   npm run eval:home-layout
//
// The root domain matters: the published Blog page is a workspace subdomain,
// and without it {handle}.localhost:3000 is not a tenant and the checks below
// read the marketing landing instead.
//
// The workspace used to answer "how does this render" in three places: a
// localStorage view mode on Home, a saved layout on the blog row that governed
// the Blog page, and the look on the folder. Now there are two, and neither
// overlaps the other: a folder's look governs that folder's index, and Home's
// control governs Home.
//
// It asserts, or fails to assert:
//
//   1. Home offers the layout control
//   2. choosing Cards persists to the WORKSPACE, not to this browser: a second
//      browser, with its own empty localStorage, opens on Cards
//   4. the published Blog page no longer carries a Layout control of its own
//   5. changing the Blog folder's look changes how the published Blog page
//      renders, which is the whole claim: the look governs the page
//   6. it reads correctly in both themes

import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.TEXTTEXT_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOT_DIR ?? "/tmp/texttext-home-layout";
const WHO = { email: "home-layout-aug15@example.com", name: "Home" };

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` (${detail})` : ""}`);
  }
}

async function devSignIn(page: Page) {
  await page.goto(`${BASE}/editor`, { waitUntil: "domcontentloaded" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor({ timeout: 20000 });
  await form.locator('input[type="email"]').fill(WHO.email);
  await form
    .locator('input[placeholder="Name (optional)"]')
    .first()
    .fill(WHO.name)
    .catch(() => undefined);
  await form.locator('button[type="submit"]').click();
  await page.waitForTimeout(1500);
  // The dev sign-in occasionally needs a second beat before the session cookie
  // is on the context; landing on /signin means it has not arrived yet.
  for (let attempt = 0; attempt < 3 && page.url().includes("/signin"); attempt += 1) {
    await page.waitForTimeout(1200);
    await page.goto(`${BASE}/editor`, { waitUntil: "domcontentloaded" });
  }
}

async function openHome(page: Page) {
  await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
}

async function workspaceHandle(page: Page): Promise<string> {
  await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const match = /\/t\/([^/?#]+)|\/@([^/?#]+)/.exec(page.url());
  return match?.[1] ?? match?.[2] ?? "";
}

function viewButton(page: Page, label: string) {
  return page.locator(`.workspace-view-segmented button[aria-label="${label}"]`);
}

async function activeView(page: Page): Promise<string> {
  return page.evaluate(() => {
    const pressed = document.querySelector(
      '.workspace-view-segmented button[aria-pressed="true"]',
    );
    return pressed?.getAttribute("aria-label") ?? "";
  });
}

async function run(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await openHome(page);

  check(
    `${theme}: Home offers the layout control`,
    (await page.locator(".workspace-view-segmented").count()) > 0,
  );

  await viewButton(page, "Cards").first().click();
  await page.waitForTimeout(1200);
  check(`${theme}: Cards is the active view`, (await activeView(page)) === "Cards");
  await page.screenshot({ path: `${SHOTS}/home-cards-${theme}.png` });

  await viewButton(page, "List").first().click();
  await page.waitForTimeout(1000);
  check(`${theme}: List is the active view`, (await activeView(page)) === "List");
  await page.screenshot({ path: `${SHOTS}/home-list-${theme}.png` });

  // Back to Cards, so the persistence check below has something to find.
  await viewButton(page, "Cards").first().click();
  await page.waitForTimeout(1200);
}

/**
 * The published Blog page, which is where BlogHomeShell renders. Inside the
 * workspace the Blog folder is a folder page; the public page is the surface
 * that used to carry the Layout popover.
 */
async function publicBlogHome(page: Page, handle: string) {
  await page.goto(`http://${handle}.localhost:3000/`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1200);
}

async function emptyCopy(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document.querySelector(".blog-home-empty")?.textContent?.trim() ??
      (document.querySelector(".blog-timeline") ? "(timeline)" : ""),
  );
}

async function checkBlogPage(page: Page, handle: string, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await publicBlogHome(page, handle);
  check(
    `${theme}: the published Blog page has no Layout control of its own`,
    (await page.locator('button:text-is("Layout")').count()) === 0,
  );
  await page.screenshot({ path: `${SHOTS}/blog-${theme}.png` });
}

/**
 * Change the Blog folder's look and watch the published page follow it. The
 * empty state names the layout it is standing in for, so this reads the change
 * without needing published posts.
 *
 * Which look it applies depends on which one the folder is wearing, so the
 * check proves a change either way round and can be run twice.
 */
const CARDS_COPY = "Nothing published in this collection yet.";
const INDEX_COPY = "No pages published in this index yet.";
const TIMELINE_COPY = "Nothing published in this timeline yet.";

async function applyLook(page: Page, name: string): Promise<boolean> {
  await openHome(page);
  const button = page.locator('button[aria-label="Folder options for Blog"]');
  await button.waitFor({ state: "attached", timeout: 20000 });
  await button.hover({ force: true });
  await page.waitForTimeout(200);
  await button.click({ force: true });
  await page.waitForTimeout(400);
  await page.locator('button:text-is("Change look")').first().click();
  await page.locator('[role="dialog"]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(700);
  const picked = await page.evaluate((target) => {
    const card = [
      ...document.querySelectorAll<HTMLElement>('[role="dialog"] button'),
    ].find((node) => (node.getAttribute("aria-label") ?? "").startsWith(target));
    card?.click();
    return Boolean(card);
  }, name);
  if (!picked) return false;
  await page.waitForTimeout(700);
  const use = page.locator('button:text-is("Use this look")').first();
  if ((await use.count()) > 0) await use.click();
  await page.waitForTimeout(2500);
  return true;
}

async function checkLookGovernsTheBlogPage(page: Page, handle: string) {
  await publicBlogHome(page, handle);
  const before = await emptyCopy(page);
  check(
    "the Blog page renders the layout of the look its folder wears",
    before === CARDS_COPY || before === INDEX_COPY,
    before,
  );

  // Article's look is cards, Page's is a list which the page renderers call an
  // index, Timeline's is a timeline. Walking all three proves the derivation
  // rather than one hop of it, and leaves the folder back where it started.
  for (const [target, expected] of [
    ["Page", INDEX_COPY],
    ["Timeline", TIMELINE_COPY],
    ["Article", CARDS_COPY],
  ] as const) {
    check(`the look gallery offers ${target}`, await applyLook(page, target));
    await publicBlogHome(page, handle);
    const after = await emptyCopy(page);
    check(
      `the folder wearing ${target} makes the published page render that way`,
      after === expected,
      after,
    );
    await page.screenshot({ path: `${SHOTS}/blog-look-${target.toLowerCase()}.png` });
  }
}

/**
 * The point of the whole change: the layout comes back from the workspace, not
 * from this browser. Clearing local storage and reloading would take a
 * localStorage-backed control back to its default of List; a workspace-backed
 * one comes back on Cards.
 */
async function checkPersistedForTheWorkspace(page: Page) {
  await openHome(page);
  const keys = await page.evaluate(() => {
    const stored = Object.keys(window.localStorage).filter((key) =>
      key.startsWith("texttext:workspace-view"),
    );
    window.localStorage.clear();
    return stored;
  });
  check(
    "nothing about Home's layout is kept in localStorage",
    keys.length === 0,
    keys.join(", "),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  const view = await activeView(page);
  check(
    "Home comes back on the saved layout with local storage emptied",
    view === "Cards",
    view,
  );
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  try {
    await devSignIn(page);
    const handle = await workspaceHandle(page);
    console.log(`workspace ${handle}`);
    console.log("light theme");
    await run(page, "light");
    await checkBlogPage(page, handle, "light");
    console.log("dark theme");
    await run(page, "dark");
    await checkBlogPage(page, handle, "dark");
    console.log("the look governs the page");
    await page.emulateMedia({ colorScheme: "light" });
    await checkLookGovernsTheBlogPage(page, handle);
    console.log("persistence");
    await page.emulateMedia({ colorScheme: "light" });
    await checkPersistedForTheWorkspace(page);
  } finally {
    await browser.close();
  }
  console.log(
    failures === 0 ? `\npass. screenshots in ${SHOTS}` : `\n${failures} check(s) failed`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
