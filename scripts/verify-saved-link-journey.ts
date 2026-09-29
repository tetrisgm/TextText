/** Browser proof for a folder link capture interrupted before its server receipt. */
import { chromium } from "playwright";
import { getPostById } from "../src/lib/store";

const origin = process.env.VISUAL_ORIGIN ?? "http://localhost:3000";
const handle = "visual-demo";

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("Requires local Postgres");
  }
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
    await page.goto(`${origin}/@${handle}?folder=blog`, { waitUntil: "domcontentloaded" });
    const composer = page.locator(".universal-item-composer");
    try {
      await composer.waitFor({ timeout: 10000 });
    } catch {
      await page.screenshot({ path: "/tmp/texttext-ux-saved-link-folder-debug.png", fullPage: true });
      throw new Error(`Folder composer missing at ${page.url()}: ${(await page.locator("body").innerText()).slice(0, 500)}`);
    }
    await page.waitForFunction(() => {
      const form = document.querySelector(".universal-item-composer");
      return form && Object.keys(form).some((key) => key.startsWith("__reactProps$"));
    });
    const url = `https://example.invalid/texttext-recovery-${crypto.randomUUID()}`;
    let interrupted = 0;
    await page.route("**/api/ai/tools", async (route) => {
      const request = route.request().postDataJSON() as { name?: string };
      if (request.name === "create_item") {
        interrupted += 1;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary interruption" }) });
      } else {
        await route.continue();
      }
    });
    await composer.locator("textarea").fill(url);
    await composer.locator("button[type=submit]").click();
    const queueKey = `texttext:capture-queue:${handle}`;
    const queued = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]") as Array<{ raw: string; idempotencyKey: string; status: string }>, queueKey);
    const capture = queued.find((entry) => entry.raw === url);
    if (!capture?.idempotencyKey || capture.status !== "saving") throw new Error("Input was not queued before the request");
    await page.getByRole("button", { name: /Retry saving/ }).waitFor({ timeout: 20000 });
    if (interrupted !== 3) throw new Error(`Expected three bounded attempts, got ${interrupted}`);
    await page.reload({ waitUntil: "domcontentloaded" });
    const retry = page.getByRole("button", { name: /Retry saving/ });
    await retry.waitFor();
    const recovered = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]") as Array<{ raw: string; idempotencyKey: string; status: string }>, queueKey);
    if (!recovered.some((entry) => entry.raw === url && entry.idempotencyKey === capture.idempotencyKey && entry.status === "failed")) {
      throw new Error("Retry key and original input were not recovered");
    }
    await page.unrouteAll();
    const savedResponse = page.waitForResponse((response) => response.url().endsWith("/api/ai/tools") && response.request().postDataJSON().name === "create_item" && response.ok());
    await retry.click();
    const payload = await (await savedResponse).json() as { result?: { item?: { id?: string }; receipt?: { item_id?: string } } };
    const id = payload.result?.item?.id;
    if (!id || payload.result?.receipt?.item_id !== id) throw new Error("Missing exact server receipt");
    await page.waitForURL((location) => location.pathname.startsWith(`/@${handle}/blog/`), { timeout: 30000 });
    const post = await getPostById(handle, id);
    if (!post || post.type !== "bookmark" || post.visibility !== "private" || post.links?.[0]?.href !== url) {
      throw new Error("One private Link item was not saved with its source URL");
    }
    await page.getByRole("link", { name: /Open original/ }).first().waitFor();
    const duplicate = await page.evaluate(async ({ handle, url, key }) => {
      const response = await fetch("/api/ai/tools", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ handle, name: "create_item", args: { capture: url, folder_path: "blog", idempotency_key: key } }),
      });
      return { status: response.status, payload: await response.json() };
    }, { handle, url, key: capture.idempotencyKey });
    if (duplicate.status !== 200 || duplicate.payload.result?.item?.id !== id) {
      throw new Error("Retry with the same key created a different item");
    }
    await page.screenshot({ path: "/tmp/texttext-ux-saved-link-recovered.png", fullPage: true });
    await page.goto(`${origin}/@${handle}?folder=blog`, { waitUntil: "domcontentloaded" });
    const prose = `A useful article for the next draft\nhttps://example.com/article-${crypto.randomUUID()}`;
    const noteSaved = page.waitForResponse((response) => response.url().endsWith("/api/ai/tools") && response.request().postDataJSON().name === "create_item" && response.ok());
    await page.locator(".universal-item-composer textarea").fill(prose);
    await page.locator(".universal-item-composer button[type=submit]").click();
    const notePayload = await (await noteSaved).json() as { result?: { item?: { id?: string } } };
    const noteId = notePayload.result?.item?.id;
    const note = noteId ? await getPostById(handle, noteId) : null;
    if (!note || note.type !== "note" || !note.document?.content.body.includes("https://example.com/article-")) {
      throw new Error("Prose containing a URL did not remain a Note with its text");
    }
    console.log("PASS: folder link queued before request, bounded failure, reload recovery, exact receipt, one private item, same-key retry, URL in prose stays a Note");
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
