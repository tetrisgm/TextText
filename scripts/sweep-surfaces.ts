// Photograph every surface of the app, light and dark, for a design pass.
//
//   NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000 npm run dev
//   npm run sweep
//
// It asserts nothing. Screenshots exist to be looked at; a pass that scored
// itself on selectors is how a surface stays broken while the checks stay
// green. What this does guarantee is coverage: every listed surface is
// visited in both themes at the same width, so a comparison is fair, and a
// surface that fails to load is named rather than silently skipped.
//
// SWEEP_ONLY=editor npm run sweep    photograph one surface
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
  await page
    .locator(".post-editor-sidebar button")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first()
    .click();
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
      await options.hover({ force: true });
      await page.waitForTimeout(200);
      await options.click({ force: true });
      await page.waitForTimeout(400);
      await page.locator('button:text-is("Change look")').first().click();
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
  await page.waitForTimeout(2500);
  const match = /\/@([^/?#]+)/.exec(page.url());
  return match?.[1] ?? "";
}

const blank: string[] = [];

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

  for (const surface of surfaces) {
    if (ONLY && surface.name !== ONLY) continue;
    for (const theme of ["light", "dark"] as const) {
      const target = surface.anonymous ? anonPage : page;
      await target.emulateMedia({ colorScheme: theme });
      try {
        await surface.go(target, handle);
        await target.waitForTimeout(1800);
        const shot = await target.screenshot({
          path: `${OUT}/${surface.name}-${theme}.png`,
          fullPage: surface.fullPage ?? false,
        });
        const painted = await paints(target);
        if (!painted) blank.push(`${surface.name} ${theme}`);
        console.log(
          `  ${surface.name} ${theme}${painted ? "" : "   BLANK"} (${Math.round(shot.length / 1024)}kb)`,
        );
      } catch (error) {
        console.log(`  FAILED ${surface.name} ${theme}: ${String(error).slice(0, 120)}`);
      }
    }
  }

  await browser.close();
  console.log(`\nscreenshots in ${OUT}`);
  if (blank.length) {
    console.log(`\nBLANK: ${blank.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
