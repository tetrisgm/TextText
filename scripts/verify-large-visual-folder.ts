/** Bounded local fixture and browser check for a visual-heavy folder. */
import { chromium } from "playwright";
import sharp from "sharp";
import { createDraftInFolder, createRootFolder, getFolderByPath, getFolderPosts } from "../src/lib/store";
import { validateDocumentSnapshot } from "../src/lib/documents/model";

const handle = "visual-demo";
const folderPath = "visual-scale-proof";
const count = 96;
const origin = process.env.VISUAL_ORIGIN ?? "http://localhost:3000";

function imageFor(index: number) {
  if (index % 29 === 0) return {
    src: "/travolta-looking-around.gif",
    poster: "/fixtures/content-first/gif-still.jpg",
    width: 480,
    height: 204,
    contentType: "image/gif",
  };
  if (index % 17 === 0) return {
    src: "/fixtures/content-first/square.jpg", width: 720, height: 720,
  };
  if (index % 12 === 0) return {
    src: "/fixtures/content-first/portrait.jpg", width: 900, height: 1600,
  };
  return {
    src: `/covers/cover-${String(((index - 1) % 24) + 1).padStart(3, "0")}.jpg`,
    width: 1600,
    height: 900,
  };
}

async function ensureFixture() {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("Requires local Postgres");
  const folder = await getFolderByPath(handle, folderPath) ?? await createRootFolder(handle, "Visual scale proof");
  if (folder.path !== folderPath) throw new Error(`Unexpected folder path: ${folder.path}`);
  const existing = new Set((await getFolderPosts(handle, folderPath)).map((post) => post.slug));
  for (let index = 1; index <= count; index += 1) {
    const slug = `visual-scale-${String(index).padStart(3, "0")}`;
    if (existing.has(slug)) continue;
    const image = imageFor(index);
    const title = `Visual scale ${String(index).padStart(3, "0")}`;
    const document = validateDocumentSnapshot({
      schemaVersion: 1,
      content: {
        title,
        body: "",
        fields: { cover: image.src },
        assets: [{ id: "original", kind: "image", ...image, alt: title, caption: title }],
      },
      presentation: { template: { id: "texttext.gallery", version: 1 }, theme: {} },
    });
    await createDraftInFolder(handle, folder.id, {
      document,
      template: { id: "texttext.gallery", version: 1 },
      initial: { type: "media_post", slug, title, cover: image.poster ?? image.src },
    });
  }
  const saved = await getFolderPosts(handle, folderPath);
  if (saved.filter((post) => post.slug.startsWith("visual-scale-")).length !== count) {
    throw new Error("The visual folder fixture did not save every item");
  }
}

async function checkBrowser() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${origin}/editor`, { waitUntil: "domcontentloaded" });
    const form = page.locator("form.ac-devsignin");
    await form.waitFor();
    await page.waitForFunction(() => {
      const form = document.querySelector("form.ac-devsignin");
      return form && Object.keys(form).some((key) => key.startsWith("__reactProps$"));
    });
    await form.locator("input[type=email]").fill("visual-demo@texttext.local");
    await form.locator("button[type=submit]").click();
    await page.waitForURL((url) => !url.pathname.startsWith("/editor"));

    await page.goto(`${origin}/@${handle}?folder=${folderPath}`, { waitUntil: "domcontentloaded" });
    const cards = page.locator(".post-folder-page-items [data-workspace-post-id]");
    await cards.first().waitFor();
    const cardMode = page.getByRole("button", { name: "Cards" });
    await cardMode.click();
    await page.waitForFunction(() => document.querySelectorAll(".post-folder-page-items [data-workspace-post-id]").length >= 60);
    const initial = await cards.count();
    if (initial > count || initial < 60) throw new Error(`Unexpected first card batch: ${initial}`);
    await page.locator(".post-editor-content").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.waitForFunction((expected) => document.querySelectorAll(".post-folder-page-items [data-workspace-post-id]").length === expected, count);
    const mountedAfterScroll = await cards.count();
    const layout = await page.evaluate(() => {
      const cards = [...document.querySelectorAll<HTMLElement>(".post-folder-page-items [data-workspace-post-id]")];
      const first = cards[0].getBoundingClientRect();
      const fourth = cards[3].getBoundingClientRect();
      const sources = [...document.querySelectorAll<HTMLImageElement>(".post-folder-page-items img")].map((image) => image.getAttribute("src") ?? "");
      return {
        masonryReady: Boolean(document.querySelector(".universal-item-collection[data-masonry-ready]")),
        fourthBeforePortraitEnd: fourth.top < first.bottom,
        gifOriginals: sources.filter((src) => src.endsWith(".gif")).length,
        gifStills: sources.filter((src) => src.includes("gif-still.jpg")).length,
      };
    });
    if (!layout.masonryReady || !layout.fourthBeforePortraitEnd || layout.gifOriginals || layout.gifStills < 3) {
      throw new Error(`Visual packing or GIF previews failed: ${JSON.stringify(layout)}`);
    }
    await page.waitForFunction(() => {
      const visible = [...document.querySelectorAll<HTMLImageElement>(".post-folder-page-items img")].filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
      });
      return visible.length > 0 && visible.every((image) => image.complete && image.naturalWidth > 0);
    });
    const loaded = await page.evaluate(() => {
      const images = [...document.querySelectorAll<HTMLImageElement>(".post-folder-page-items img")];
      const visible = images.filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
      });
      return { images: images.length, visible: visible.length, decoded: visible.filter((image) => image.complete && image.naturalWidth > 0).length };
    });
    if (loaded.images < count || loaded.visible === 0) throw new Error(`Visual cards did not render images: ${JSON.stringify(loaded)}`);
    await page.locator(".post-editor-content").evaluate((element) => { element.scrollTop = 0; });
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>(".post-folder-page-items [data-workspace-post-id] img");
      return image?.complete && image.naturalWidth > 0;
    });
    const firstTile = await cards.first().evaluate((card) => {
      const image = card.querySelector("img")!;
      const bounds = image.getBoundingClientRect();
      return { ratio: bounds.height / bounds.width, border: getComputedStyle(card).borderTopWidth };
    });
    if (firstTile.ratio < 1.5 || firstTile.border !== "0px") throw new Error(`Visual tile still crops or boxes its portrait: ${JSON.stringify(firstTile)}`);
    await page.screenshot({ path: "/tmp/texttext-ux-large-visual-desktop.png" });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => {
      const cards = document.querySelectorAll<HTMLElement>(".post-folder-page-items [data-workspace-post-id]");
      return cards.length > 1 && cards[1].getBoundingClientRect().top >= cards[0].getBoundingClientRect().bottom;
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) throw new Error(`Narrow visual folder overflow: ${overflow}px`);
    await page.screenshot({ path: "/tmp/texttext-ux-large-visual-narrow.png" });
    await cards.first().locator("a").first().click();
    const opener = page.locator(".tt-gallery-open").first();
    await opener.waitFor();
    await opener.click();
    const viewer = page.getByRole("dialog", { name: "Image viewer" });
    await viewer.waitFor();
    await page.keyboard.press("Escape");
    await viewer.waitFor({ state: "hidden" });
    console.log(JSON.stringify({ status: "pass", saved: count, initialCards: initial, mountedAfterScroll, loaded, layout, firstTile, narrowOverflow: overflow, viewerClosed: true }));
  } finally {
    await browser.close();
  }
}

async function main() {
  // Keep the fixture's declared dimensions honest before writing any item.
  const dimensions = await Promise.all(["public/covers/cover-001.jpg", "public/fixtures/content-first/portrait.jpg", "public/fixtures/content-first/square.jpg"].map((path) => sharp(path).metadata()));
  if (dimensions[0].width !== 1600 || dimensions[0].height !== 900 || dimensions[1].width !== 900 || dimensions[1].height !== 1600 || dimensions[2].width !== 720 || dimensions[2].height !== 720) throw new Error("Fixture image dimensions changed");
  await ensureFixture();
  await checkBrowser();
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : "Visual folder check failed"); process.exitCode = 1; });
