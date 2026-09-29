/** Local browser proof that a quote comment attaches to a saved article. */
import { chromium } from "playwright";
import { getPostById } from "../src/lib/store";

const origin = process.env.VISUAL_ORIGIN ?? "http://localhost:3000";
const handle = "visual-demo";
const postId = "11111111-2222-4333-8444-555555555501";
const path = `/@${handle}/notes/mixed-workspace-check/probe-bookmark-capture`;
const quote = "Choose where the conversation lives";

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("Requires local Postgres");
  const original = await getPostById(handle, postId);
  if (!original?.document?.content.body.includes(quote)) throw new Error("Article fixture is missing");
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
    await page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
    const prose = page.locator('.tt-prose[data-tt-bind="content.body"]');
    await prose.waitFor();
    await page.waitForFunction(() => {
      const layer = document.querySelector("[data-reader-comments]");
      return layer && Object.keys(layer).some((key) => key.startsWith("__reactProps$"));
    });
    // React attaches the document-level selection listener just after hydration.
    await page.waitForTimeout(100);
    await page.evaluate((text) => {
      const body = document.querySelector<HTMLElement>('.tt-prose[data-tt-bind="content.body"]');
      if (!body) throw new Error("Bound article body missing");
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.textContent?.includes(text)) node = walker.nextNode();
      if (!node) throw new Error("Quote absent from rendered body");
      const start = node.textContent!.indexOf(text);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    }, quote);
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    const composer = page.getByRole("dialog", { name: "Comment on selection" });
    await composer.waitFor();
    if (!(await composer.locator("blockquote").innerText()).includes(quote)) throw new Error("Quoted excerpt was not attached");
    const comment = `This passage explains where the conversation lives. Keep it beside the original source. ${crypto.randomUUID()}`;
    await composer.getByRole("textbox", { name: "Add a comment" }).fill(comment);
    await composer.getByRole("button", { name: "Post" }).click();
    await page.getByRole("status").filter({ hasText: "Comment posted." }).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const layer = document.querySelector("[data-reader-comments]");
      return layer && Object.keys(layer).some((key) => key.startsWith("__reactProps$"));
    });
    await page.waitForTimeout(100);
    await page.getByRole("button", { name: "Comments", exact: true }).click();
    const comments = page.getByRole("dialog", { name: "Comments" });
    try {
      await comments.getByRole("button").filter({ hasText: comment }).click({ timeout: 5000 });
    } catch {
      throw new Error(`Posted comment absent from reopened list: ${(await comments.innerText()).slice(0, 800)}`);
    }
    const thread = page.getByRole("dialog", { name: "Comment thread" });
    await thread.getByText(comment).waitFor();
    if (!(await thread.locator("blockquote").innerText()).includes(quote)) throw new Error("Quoted excerpt did not survive reload");
    const saved = await getPostById(handle, postId);
    if (saved?.document?.content.body !== original.document.content.body || saved.links?.[0]?.href !== original.links?.[0]?.href) {
      throw new Error("Annotation changed the article body or original URL");
    }
    await page.screenshot({ path: "/tmp/texttext-ux-article-annotation.png", fullPage: true });
    console.log("PASS: quote selection, same-item comment, persisted thread after reload, original source and body intact");
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
