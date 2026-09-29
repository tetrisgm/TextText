/** Local visual proof. Seeds one private item in the existing visual-demo fixture. */
import { chromium } from "playwright";
import { createDraftInFolder, getFolderByPath, getPost } from "../src/lib/store";
import { validateDocumentSnapshot } from "../src/lib/documents/model";

const origin = process.env.VISUAL_ORIGIN ?? "http://localhost:3000";
const handle = "visual-demo";
const slug = "content-first-visual-proof-2026-09-28";

async function ensureFixture(): Promise<string> {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("Requires local Postgres");
  const existing = await getPost(handle, slug);
  if (existing?.id) return existing.id;
  const folder = await getFolderByPath(handle, "blog");
  if (!folder) throw new Error("Visual demo Blog folder is missing");
  const document = validateDocumentSnapshot({
    schemaVersion: 1,
    content: {
      title: "Images for the content-first gallery",
      subtitle: "Landscape, portrait, square, and animated reference",
      body: "A small local visual fixture for checking proportions and the image viewer.",
      fields: { cover: "/covers/cover-016.jpg" },
      tags: ["visual-fixture"],
      assets: [
        { id: "landscape", kind: "image", src: "/covers/cover-016.jpg", alt: "Landscape photograph", caption: "Landscape photograph", width: 1600, height: 900 },
        { id: "portrait", kind: "image", src: "/fixtures/content-first/portrait.jpg", alt: "Portrait photograph of autumn leaves", caption: "Autumn leaves in portrait", width: 900, height: 1600 },
        { id: "square", kind: "image", src: "/fixtures/content-first/square.jpg", alt: "Square photograph through a window", caption: "Square reference", width: 720, height: 720 },
        { id: "gif", kind: "image", src: "/travolta-looking-around.gif", poster: "/fixtures/content-first/gif-still.jpg", alt: "Animated film reference", caption: "Animated reference", width: 480, height: 204, contentType: "image/gif" },
      ],
    },
    presentation: { template: { id: "texttext.gallery", version: 1 }, theme: {} },
  });
  const created = await createDraftInFolder(handle, folder.id, {
    document,
    template: { id: "texttext.gallery", version: 1 },
    initial: { type: "media_post", slug, title: document.content.title },
  });
  if (!created.id) throw new Error("Fixture was not persisted");
  return created.id;
}

async function checkPage(page: import("playwright").Page, suffix: string, postId: string) {
  await page.goto(`${origin}/t/${handle}/blog/${slug}?id=${postId}`, { waitUntil: "domcontentloaded" });
  await page.evaluate("globalThis.__name = (fn) => fn");
  const openers = page.locator(".tt-gallery-open");
  await openers.first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => {
    const button = document.querySelector(".tt-gallery-open");
    return button && Object.keys(button).some((key) => key.startsWith("__reactProps$"));
  });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.tt-gallery figure img')].every((image) => image.complete && image.naturalWidth > 0));
  const grid = await page.locator('.tt-gallery').first().evaluate((root) => {
    const images = [...root.querySelectorAll('figure img')];
    return images.map((image) => ({
      src: image.getAttribute('src'),
      ratio: Number((image.getBoundingClientRect().height / image.getBoundingClientRect().width).toFixed(2)),
    }));
  });
  if (grid.length !== 4 || grid[1].ratio < 1.5 || grid[2].ratio < .9 || grid[2].ratio > 1.1 || !grid[3].src?.includes('gif-still.jpg')) {
    throw new Error(`Gallery proportions or still preview incorrect: ${JSON.stringify(grid)}`);
  }
  await page.screenshot({ path: `/tmp/texttext-ux-gallery-${suffix}.png`, fullPage: true });
  await openers.nth(1).click();
  const viewer = page.getByRole('dialog', { name: 'Image viewer' });
  await viewer.waitFor({ state: 'visible' });
  if (!(await viewer.getByText('Autumn leaves in portrait').isVisible())) throw new Error('Caption missing');
  if (!(await viewer.getByText('900 × 1600 px').isVisible())) throw new Error('Dimensions missing');
  await viewer.getByRole('button', { name: 'Zoom' }).click();
  if (!(await viewer.locator('.tt-gallery-viewer-stage.is-zoomed').count())) throw new Error('Zoom missing');
  await page.screenshot({ path: `/tmp/texttext-ux-viewer-${suffix}.png` });
  await page.keyboard.press('ArrowRight');
  if (!(await viewer.getByText('Square reference').isVisible())) throw new Error('Keyboard navigation missing');
  await page.keyboard.press('Escape');
  await viewer.waitFor({ state: 'hidden' });
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => ({
    focusRestored: document.activeElement?.getAttribute('aria-label') === 'View Portrait photograph of autumn leaves',
    overflowRestored: document.body.style.overflow !== 'hidden',
    horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
    itemStillOpen: location.pathname.endsWith('content-first-visual-proof-2026-09-28') && document.querySelectorAll('.tt-gallery-open').length === 4,
  }));
  if (!result.focusRestored || !result.overflowRestored || !result.itemStillOpen || result.horizontalOverflow > 0) {
    throw new Error(`Viewer cleanup or width incorrect: ${JSON.stringify(result)}`);
  }
  console.log(`PASS ${suffix}: intrinsic ratios, still preview, viewer, zoom, keyboard navigation, focus and scroll lock cleanup; overflow ${result.horizontalOverflow}px`);
}

async function main() {
  const postId = await ensureFixture();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const login = await context.newPage();
    await login.goto(`${origin}/editor`, { waitUntil: "domcontentloaded" });
    const form = login.locator('form.ac-devsignin');
    await form.waitFor();
    await login.waitForFunction(() => {
      const form = document.querySelector('form.ac-devsignin');
      return form && Object.keys(form).some((key) => key.startsWith('__reactProps$'));
    });
    await form.locator('input[type=email]').fill('visual-demo@texttext.local');
    await form.locator('button[type=submit]').click();
    await login.waitForURL((url) => !url.pathname.startsWith('/editor'), { timeout: 30000 });
    await login.close();
    const desktop = await context.newPage();
    await checkPage(desktop, 'desktop-light', postId);
    await desktop.close();
    const phone = await context.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.emulateMedia({ colorScheme: 'dark' });
    await checkPage(phone, 'narrow-dark', postId);
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
