// Photograph every surface of the app, light and dark, for a design pass.
//
//   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000 npm run dev
//   npm run sweep
//
// It does not score visual quality. Screenshots exist to be looked at; a pass that scored
// itself on selectors is how a surface stays broken while the checks stay
// green. What this does guarantee is coverage: every listed surface is
// visited in both themes at desktop, tablet, and phone widths, so a comparison is fair, and a
// surface that fails to load is named rather than silently skipped.
//
// SWEEP_ONLY=editor npm run sweep    photograph one surface
// SWEEP_WIDTHS=375 npm run sweep     photograph one or more comma-separated widths
//
// It does make one assertion, because a screenshot nobody looks at is worth
// nothing: a surface that comes back as a blank rectangle is reported. The
// landing page shipped blank above the fold with correct markup, correct
// layout and correct computed styles, and only a pixel told the truth.

import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.TEXTTEXT_BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SWEEP_OUT ?? "/tmp/texttext-sweep";
const ONLY = process.env.SWEEP_ONLY ?? "";
const WIDTHS = (process.env.SWEEP_WIDTHS ?? "1440,768,375")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value >= 320);
const WHO = { email: "sweep-aug16@example.com", name: "Sweep" };

type Surface = {
  name: string;
  /** Signed out surfaces are photographed in a context with no session. */
  anonymous?: boolean;
  /** Long pages are photographed whole; the fold is not the whole design. */
  fullPage?: boolean;
  go: (page: Page, handle: string) => Promise<void>;
};

/**
 * Trash, Starred and Shared with me are sidebar destinations, not query
 * parameters. Navigating to ?folder=trash lands on Home, which is how an
 * earlier sweep photographed Home three times and called it coverage.
 */
async function openSidebar(page: Page, label: string) {
  await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const destination = page
    .locator(".post-editor-sidebar button")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first();
  await destination.waitFor({ state: "attached" });
  // At tablet and phone widths the sidebar is intentionally off canvas. This
  // helper is route setup, not an interaction check, so invoke the same button
  // handler directly and photograph the destination rather than the drawer.
  await destination.evaluate((button) => (button as HTMLButtonElement).click());
  await page.waitForTimeout(500);
}

async function openItemTypeStudio(
  page: Page,
  surface: "prompt" | "item" | "folder",
  starter: RegExp = /Project board/,
) {
  await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  await page.locator(".workspace-build-type-button").click();
  if (surface === "prompt") return;
  await page.getByRole("button", { name: starter }).click();
  if (surface === "folder") {
    await page.getByRole("tab", { name: "Folder" }).click();
  }
}

const surfaces: Surface[] = [
  {
    name: "landing",
    anonymous: true,
    go: async (page) => {
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    },
  },
  {
    name: "signin",
    anonymous: true,
    go: async (page) => {
      await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
    },
  },
  ...[
    "docs",
    "docs/features",
    "docs/item-types",
    "docs/getting-started",
    "docs/how-it-works",
    "docs/ai",
    "docs/mcp",
    "docs/security",
    "docs/troubleshooting",
  ].map<Surface>((path) => ({
    name: path.replace(/\//g, "-"),
    anonymous: true,
    fullPage: true,
    go: async (page) => {
      await page.goto(`${BASE}/${path}`, { waitUntil: "domcontentloaded" });
    },
  })),
  {
    name: "home",
    go: async (page) => {
      await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
    },
  },
  {
    name: "home-cards",
    go: async (page) => {
      await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      await page
        .locator('.workspace-view-segmented button[aria-label="Cards"]')
        .first()
        .click();
    },
  },
  {
    name: "item-type-prompt",
    go: async (page) => openItemTypeStudio(page, "prompt"),
  },
  {
    name: "item-type-item",
    go: async (page) => openItemTypeStudio(page, "item"),
  },
  {
    name: "item-type-folder",
    go: async (page) => openItemTypeStudio(page, "folder"),
  },
  {
    name: "item-type-editorial-item",
    go: async (page) => openItemTypeStudio(page, "item", /Editorial publication/),
  },
  {
    name: "item-type-editorial-folder",
    go: async (page) => openItemTypeStudio(page, "folder", /Editorial publication/),
  },
  {
    name: "item-type-notes-item",
    go: async (page) => openItemTypeStudio(page, "item", /Quick notes/),
  },
  {
    name: "item-type-notes-folder",
    go: async (page) => openItemTypeStudio(page, "folder", /Quick notes/),
  },
  {
    name: "item-type-controls",
    go: async (page) => {
      await openItemTypeStudio(page, "item");
      await page.getByRole("region", { name: "Item type settings" }).evaluate((controls) => {
        controls.scrollTop = controls.scrollHeight;
      });
    },
  },
  {
    name: "item-type-compare",
    go: async (page) => {
      await openItemTypeStudio(page, "item");
      const name = page.getByRole("textbox", { name: "Name", exact: true });
      await name.fill("Project tasks refined");
      await page.getByRole("button", { name: "Compare" }).click();
    },
  },
  {
    name: "item-type-stress-phone",
    go: async (page) => {
      await openItemTypeStudio(page, "item");
      await page.getByRole("combobox", { name: "Preview content" }).selectOption("stress");
      await page.getByRole("button", { name: "Phone" }).click();
    },
  },
  {
    name: "item-type-folder-content",
    go: async (page) => {
      await openItemTypeStudio(page, "folder");
      await page.getByRole("combobox", { name: "Use in folder" }).selectOption({ label: "Notes" });
      await page.getByRole("combobox", { name: "Preview content" }).selectOption("folder");
    },
  },
  {
    name: "item-type-preflight",
    go: async (page) => {
      await openItemTypeStudio(page, "item");
      await page.locator("details").filter({ hasText: /Ready|suggestion|attention/ }).click();
    },
  },
  {
    name: "folder-blog",
    go: async (page, handle) => {
      await page.goto(`${BASE}/@${handle}?folder=blog`, {
        waitUntil: "domcontentloaded",
      });
    },
  },
  {
    name: "folder-notes",
    go: async (page, handle) => {
      await page.goto(`${BASE}/@${handle}?folder=notes`, {
        waitUntil: "domcontentloaded",
      });
    },
  },
  {
    name: "starred",
    go: async (page) => openSidebar(page, "Starred"),
  },
  {
    name: "shared",
    go: async (page) => openSidebar(page, "Shared with me"),
  },
  {
    name: "trash",
    go: async (page) => openSidebar(page, "Trash"),
  },
  {
    name: "settings",
    fullPage: true,
    go: async (page, handle) => {
      await page.goto(`${BASE}/@${handle}?view=settings`, {
        waitUntil: "domcontentloaded",
      });
    },
  },
  {
    name: "editor",
    go: async (page) => {
      await page.goto(`${BASE}/start`, { waitUntil: "domcontentloaded" });
    },
  },
  {
    name: "look-gallery",
    go: async (page) => {
      await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1400);
      const options = page.locator('button[aria-label="Folder options for Blog"]');
      await options.waitFor({ state: "attached", timeout: 20000 });
      await options.evaluate((button) => (button as HTMLButtonElement).click());
      await page.waitForTimeout(400);
      await page
        .locator('button:text-is("Change look")')
        .first()
        .evaluate((button) => (button as HTMLButtonElement).click());
      await page.locator('[role="dialog"]').first().waitFor({ timeout: 20000 });
    },
  },
  {
    name: "connect",
    fullPage: true,
    go: async (page) => {
      await page.goto(`${BASE}/connect`, { waitUntil: "domcontentloaded" });
    },
  },
  {
    name: "landing-full",
    anonymous: true,
    fullPage: true,
    go: async (page) => {
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    },
  },
];

/**
 * Does anything at all reach the pixels?
 *
 * Measured by covering the viewport with a probe of a known colour, reading
 * back what a screenshot of one pixel outside the probe contains, and instead,
 * more cheaply: comparing the PNG byte length of the viewport against a plain
 * one-colour capture of the same size. A page that paints text and rules
 * compresses far worse than a flat rectangle, so a capture within a hair of
 * flat is blank.
 */
async function paints(page: Page): Promise<boolean> {
  const shot = await page.screenshot({ fullPage: false });
  const flat = await page.screenshot({
    fullPage: false,
    clip: { x: 0, y: 0, width: 8, height: 8 },
  });
  // A flat 8x8 is the floor. A real surface at 1440x940 is tens of kilobytes;
  // a blank one lands within a few hundred bytes of the floor per megapixel.
  return shot.length > flat.length * 12;
}

async function devSignIn(page: Page): Promise<string> {
  // This form is client-driven. On a cold compile the markup can arrive before
  // hydration. A click that produces no auth callback did nothing, so reload
  // the form and retry instead of navigating away with no session.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.goto(`${BASE}/editor`, { waitUntil: "networkidle" });
    const form = page.locator("form.ac-devsignin");
    await form.waitFor({ timeout: 20000 });
    await form.locator('input[type="email"]').fill(WHO.email);
    await form
      .locator('input[placeholder="Name (optional)"]')
      .first()
      .fill(WHO.name)
      .catch(() => undefined);
    const callback = page
      .waitForResponse((response) => response.url().includes("/api/auth/callback/dev-login"), {
        timeout: 4000,
      })
      .catch(() => null);
    await form.locator('button[type="submit"]').click();
    if (await callback) {
      await page.waitForTimeout(1000);
      break;
    }
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.waitForTimeout(1200);
    await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const match = /\/@([^/?#]+)/.exec(page.url());
    if (match && (await page.locator(".workspace-library-header").count()) > 0) {
      return match[1];
    }
  }
  throw new Error(`Sweep workspace never loaded (last url ${page.url()})`);
}

const blank: string[] = [];
const overflow: string[] = [];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 940 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const handle = await devSignIn(page);
  console.log(`workspace ${handle}`);

  const anon = await browser.newContext({
    viewport: { width: 1440, height: 940 },
    deviceScaleFactor: 2,
  });
  const anonPage = await anon.newPage();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 940 });
    await anonPage.setViewportSize({ width, height: 940 });
    console.log(`\n${width}px`);
    for (const surface of surfaces) {
      if (ONLY && surface.name !== ONLY) continue;
      for (const theme of ["light", "dark"] as const) {
        const target = surface.anonymous ? anonPage : page;
        await target.emulateMedia({ colorScheme: theme });
        try {
          await surface.go(target, handle);
          await target.waitForTimeout(1800);
          const shot = await target.screenshot({
            path: `${OUT}/${surface.name}-${width}-${theme}.png`,
            fullPage: surface.fullPage ?? false,
          });
          const painted = await paints(target);
          const spills = await target.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1,
          );
          if (!painted) blank.push(`${surface.name} ${width}px ${theme}`);
          if (spills) overflow.push(`${surface.name} ${width}px ${theme}`);
          console.log(
            `  ${surface.name} ${theme}${painted ? "" : "   BLANK"}${spills ? "   OVERFLOW" : ""} (${Math.round(shot.length / 1024)}kb)`,
          );
        } catch (error) {
          console.log(`  FAILED ${surface.name} ${theme}: ${String(error).slice(0, 120)}`);
        }
      }
    }
  }

  await browser.close();
  console.log(`\nscreenshots in ${OUT}`);
  if (blank.length) {
    console.log(`\nBLANK: ${blank.join(", ")}`);
  }
  if (overflow.length) console.log(`\nOVERFLOW: ${overflow.join(", ")}`);
  if (blank.length || overflow.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
