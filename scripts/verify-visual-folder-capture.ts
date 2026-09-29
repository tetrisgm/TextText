/** One bounded local-browser proof; writes two private items to visual-demo. */
import { readFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import sharp from "sharp";
import { getPostById } from "../src/lib/store";

const origin = process.env.VISUAL_ORIGIN ?? "http://localhost:3000";
const handle = "visual-demo";

async function dispatchFile(page: Page, kind: "drop" | "paste", name: string, mime: string, bytes: Buffer) {
  await page.evaluate(({ kind, name, mime, encoded }) => {
    const decoded = atob(encoded);
    const buffer = Uint8Array.from(decoded, (letter) => letter.charCodeAt(0));
    const file = new File([buffer], name, { type: mime });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const page = document.querySelector(".post-folder-page");
    if (!page) throw new Error("Folder page missing");
    const event = kind === "drop"
      ? new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer })
      : new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer });
    if (!page.dispatchEvent(event)) return;
    throw new Error(`${kind} was not handled by the folder`);
  }, { kind, name, mime, encoded: bytes.toString("base64") });
}

async function verifySaved(id: string, expected: Buffer, mime: string) {
  const post = await getPostById(handle, id);
  if (!post || post.visibility !== "private" || post.type !== "media_post") throw new Error("Private visual item was not saved");
  const asset = post.document?.content.assets?.[0];
  if (!asset || asset.kind !== "image" || asset.contentType !== mime || !asset.poster) throw new Error("Original or preview missing");
  const original = await fetch(asset.src);
  if (!original.ok || !Buffer.from(await original.arrayBuffer()).equals(expected)) throw new Error("Original binary changed");
  const preview = await fetch(asset.poster);
  if (!preview.ok) throw new Error("Preview could not be loaded");
  const metadata = await sharp(Buffer.from(await preview.arrayBuffer())).metadata();
  if (metadata.format !== "webp" || !metadata.width || metadata.width > 960 || !metadata.height || metadata.height > 960) {
    throw new Error("Preview is not bounded WebP");
  }
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("Requires local Postgres");
  const portrait = await readFile("public/fixtures/content-first/portrait.jpg");
  const animated = await readFile("public/travolta-looking-around.gif");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${origin}/editor`, { waitUntil: "domcontentloaded" });
    const form = page.locator("form.ac-devsignin");
    await form.waitFor();
    await page.waitForFunction(() => {
      const form = document.querySelector("form.ac-devsignin");
      return form && Object.keys(form).some((key) => key.startsWith("__reactProps$"));
    });
    await form.locator("input[type=email]").fill("visual-demo@texttext.local");
    await form.locator("button[type=submit]").click();
    await page.waitForURL((url) => !url.pathname.startsWith("/editor"), { timeout: 30000 });
    await page.goto(`${origin}/@visual-demo?folder=blog`, { waitUntil: "domcontentloaded" });
    try {
      await page.locator(".visual-folder-add").waitFor({ timeout: 10000 });
    } catch {
      await page.screenshot({ path: "/tmp/texttext-ux-folder-capture-route-debug.png", fullPage: true });
      throw new Error(`Folder capture missing at ${page.url()}: ${(await page.locator("body").innerText()).slice(0, 500)}`);
    }

    let attempts = 0;
    await page.route("**/api/workspace/visual-capture", async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary upload interruption" }) });
      } else {
        await route.continue();
      }
    });
    await dispatchFile(page, "drop", "Folder portrait.jpg", "image/jpeg", portrait);
    await page.getByText("Temporary upload interruption").waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Retry" }).waitFor();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === "Retry");
      return button && Object.keys(button).some((key) => key.startsWith("__reactProps$"));
    });
    const recovered = page.waitForResponse((response) => response.url().endsWith("/api/workspace/visual-capture"));
    await page.getByRole("button", { name: "Retry" }).click();
    const firstResponse = await recovered;
    if (firstResponse.status() !== 201) throw new Error(`Recovery upload failed: ${firstResponse.status()} ${JSON.stringify(await firstResponse.json())}`);
    const first = await firstResponse.json() as { id: string };
    await verifySaved(first.id, portrait, "image/jpeg");

    const saved = page.waitForResponse((response) => response.url().endsWith("/api/workspace/visual-capture") && response.status() === 201);
    await dispatchFile(page, "paste", "Folder animation.gif", "image/gif", animated);
    const second = await (await saved).json() as { id: string };
    await verifySaved(second.id, animated, "image/gif");
    await page.locator(".visual-folder-pending-item").waitFor({ state: "hidden" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Folder portrait").first().waitFor();
    await page.getByText("Folder animation").first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.post-folder-page-items img')]
      .filter((image) => image.alt === "Folder portrait" || image.alt === "Folder animation")
      .every((image) => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: "/tmp/texttext-ux-folder-capture-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(700);
    await page.screenshot({ path: "/tmp/texttext-ux-folder-capture-narrow-dark.png", fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) throw new Error(`Narrow folder overflow: ${overflow}px`);
    await page.locator(`[data-workspace-post-id="${second.id}"] a`).click();
    const opener = page.locator(".tt-gallery-open").first();
    await opener.waitFor();
    await opener.click();
    const viewer = page.getByRole("dialog", { name: "Image viewer" });
    await viewer.waitFor();
    const source = await viewer.locator("img").first().getAttribute("src");
    if (!source?.includes(".gif")) throw new Error("Viewer did not open the original animation");
    await page.keyboard.press("Escape");
    await viewer.waitFor({ state: "hidden" });
    console.log("PASS: drop, interrupted upload recovery after reload, paste, original bytes, bounded previews, saved cards, narrow width, viewer close");
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
