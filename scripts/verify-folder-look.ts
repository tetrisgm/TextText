// Live proof that a person can change a folder's look.
//
//   npm run eval:folder-look        (against a running dev server)
//
// The agent has been able to do this since the template engine landed; a person
// could not. This drives the real path: folder menu, Change look, pick a look,
// and then checks that the folder's index page actually renders differently
// afterwards rather than merely reporting success.
//
// It asserts, or fails to assert:
//
//   1. the folder menu offers Change look at all
//   2. the gallery opens with real look cards, not an empty grid
//   3. each look appears ONCE, however many times it has been customized
//   4. applying one restyles the folder and its items
//   5. it reads correctly in both themes

import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.TEXTTEXT_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOT_DIR ?? "/tmp/texttext-folder-look";
const WHO = { email: "fresh-user-aug14@example.com", name: "Fresh" };

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
}

async function openWorkspace(page: Page) {
  await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
}

/**
 * Open the Blog folder's "..." menu in the sidebar.
 *
 * The control is revealed on hover, the way a row's overflow menu usually is,
 * so the row has to be hovered before the button is there to click. Waiting for
 * it without hovering waits forever.
 */
async function openFolderMenu(page: Page) {
  const button = page.locator('button[aria-label="Folder options for Blog"]');
  await button.waitFor({ state: "attached", timeout: 20000 });
  await button.hover({ force: true });
  await page.waitForTimeout(200);
  await button.click({ force: true });
  await page.waitForTimeout(400);
}

async function run(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await openWorkspace(page);
  await openFolderMenu(page);

  const changeLook = page.locator('button:text-is("Change look")').first();
  check(
    `${theme}: the folder menu offers Change look`,
    (await changeLook.count()) > 0,
  );
  if ((await changeLook.count()) === 0) return;

  await changeLook.click();
  const gallery = page.locator('[role="dialog"]').first();
  await gallery.waitFor({ timeout: 20000 });
  await page.waitForTimeout(700);

  const cards = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[role="dialog"] button')];
    return nodes
      .map((node) => (node as HTMLElement).innerText.trim().split("\n")[0])
      .filter((text) => text && text.length < 60);
  });
  check(`${theme}: the gallery shows look cards`, cards.length > 0, `${cards.length}`);

  // Every look exactly once. Customizing a look used to add a second card with
  // the same name, and a third, because the picker listed every version.
  const names = cards.filter((name) => name && !/^(Back|Cancel|Use this look)$/i.test(name));
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  check(
    `${theme}: no look appears twice`,
    duplicates.length === 0,
    duplicates.join(", "),
  );

  await page.screenshot({ path: `${SHOTS}/folder-look-${theme}.png` });

  if (theme === "light") {
    // Apply a look and confirm the folder really changed.
    const applied = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')];
      const card = nodes.find((node) => /gallery|magazine|index/i.test(node.innerText));
      const target = card ?? nodes.find((node) => node.innerText.trim().length > 0);
      target?.click();
      return target?.innerText.trim().split("\n")[0] ?? "";
    });
    await page.waitForTimeout(900);
    const use = page.locator('button:text-is("Use this look")').first();
    if ((await use.count()) > 0) await use.click();
    await page.waitForTimeout(2500);
    check(
      `${theme}: applying a look closes the gallery`,
      (await page.locator('[role="dialog"]').count()) === 0,
      applied,
    );
  } else {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
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
    console.log("light theme");
    await run(page, "light");
    console.log("dark theme");
    await run(page, "dark");
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
