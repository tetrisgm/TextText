/**
 * GrowingGrid smoke: the 300-note folder must mount a first page of cards,
 * then grow to the full set as the scroller reaches the sentinel.
 */
import { chromium, type Page } from "playwright";

const ORIGIN = "http://localhost:3131";

async function signIn(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}/editor`, { waitUntil: "networkidle" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor({ timeout: 20000 });
  await form.locator("input[type=email]").fill("scale-test@texttext.local");
  await form.locator("button[type=submit]").click();
  await page.waitForTimeout(1500);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await signIn(page);
  await page.goto(`${ORIGIN}/@scale-test?folder=notes`);
  await page.waitForSelector(".post-folder-list", { timeout: 20000 });
  const listRows = await page
    .locator(".post-folder-list [data-workspace-post-id]")
    .count();
  console.log("list rows mounted (windowed):", listRows);
  if (listRows >= 300) {
    console.log("FAIL: list layout mounted the whole set");
    process.exit(1);
  }
  await page.getByLabel("Cards", { exact: true }).click();
  await page.waitForSelector(".universal-item-card", { timeout: 20000 });
  const initial = await page.locator(".universal-item-card").count();
  console.log("initial cards:", initial);
  if (initial >= 300) {
    console.log("FAIL: whole set mounted up front");
    process.exit(1);
  }
  // Scroll the workspace scroller to the bottom until growth stops.
  let last = initial;
  for (let i = 0; i < 30; i += 1) {
    await page.evaluate(() => {
      const scroller = document.querySelector(".post-editor-content");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    await page.waitForTimeout(250);
    const now = await page.locator(".universal-item-card").count();
    if (now === last && now >= 300) break;
    last = now;
  }
  console.log("after scroll:", last);
  console.log(last >= 300 ? "PASS" : "FAIL");
  await browser.close();
  process.exit(last >= 300 ? 0 : 1);
}

void main();
