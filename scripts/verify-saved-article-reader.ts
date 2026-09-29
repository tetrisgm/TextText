/** Read-only browser proof for an extracted article and an unusable source. */
import { chromium } from "playwright";

const origin = process.env.VISUAL_ORIGIN ?? "http://localhost:3000";

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${origin}/editor`, { waitUntil: "domcontentloaded" });
    const signIn = page.locator("form.ac-devsignin");
    await signIn.waitFor();
    await page.waitForFunction(() => {
      const form = document.querySelector("form.ac-devsignin");
      return form && Object.keys(form).some((key) => key.startsWith("__reactProps$"));
    });
    await signIn.locator("input[type=email]").fill("visual-demo@texttext.local");
    await signIn.locator("button[type=submit]").click();
    await page.waitForURL((url) => !url.pathname.startsWith("/editor"));

    await page.goto(`${origin}/@visual-demo/notes/mixed-workspace-check/probe-bookmark-capture`, { waitUntil: "domcontentloaded" });
    await page.getByText("Choose where the conversation lives").waitFor();
    const source = page.getByRole("link", { name: /Open original/ }).first();
    if (await source.getAttribute("href") !== "https://texttext.app/docs/ai") throw new Error("Captured article lost its source URL");
    if (await source.getAttribute("target") !== "_blank") throw new Error("Source does not open separately");
    await page.screenshot({ path: "/tmp/texttext-ux-saved-article-reader.png", fullPage: true });

    await page.goto(`${origin}/@visual-demo/notes/untitled-muhf7u99`, { waitUntil: "domcontentloaded" });
    await page.getByText("The readable copy could not be captured.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Retry capture" }).first().waitFor();
    const failedSource = page.getByRole("link", { name: /Open original/ }).first();
    if (!(await failedSource.getAttribute("href"))?.startsWith("https://example.invalid")) throw new Error("Failed capture lost its original URL");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: "/tmp/texttext-ux-failed-link-reader-narrow.png", fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) throw new Error(`Failed link reader overflowed by ${overflow}px`);
    console.log("PASS: captured article body and source; failed extraction retains original and visible retry; narrow reader fits");
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
