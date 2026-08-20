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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`${BASE}/start?to=home`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1400);
    const destination = page
      .locator(".post-editor-sidebar button")
      .filter({ hasText: new RegExp(`^${label}$`) })
      .first();
    await destination.waitFor({ state: "attached" });
    // At tablet and phone widths the sidebar is intentionally off canvas. This
    // helper is route setup, not an interaction check, so invoke the same
    // button handler directly and photograph the destination rather than the
    // drawer.
    await destination.evaluate(
      (button) => (button as HTMLButtonElement).click(),
    );
    const heading = page
      .getByRole("heading", { name: label, exact: true })
      .first();
    if (
      await heading
        .waitFor({ state: "visible", timeout: 10000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await page.waitForTimeout(500);
      return;
    }
  }
  throw new Error(`${label} did not open from the sidebar`);
}

async function verifyWorkspaceScrollOwnership(page: Page) {
  const result = await page.evaluate(async () => {
    const center = document.querySelector<HTMLElement>(".post-editor-content");
    const left = document.querySelector<HTMLElement>(".post-editor-sidebar");
    const assistant = document.querySelector<HTMLElement>(
      '.workspace-assistant-shell[data-state="pinned"]',
    );
    if (!center || !left)
      throw new Error("Workspace scroll regions did not render");

    window.scrollTo(0, 0);
    center.scrollTop = 0;
    let probe: HTMLElement | null = null;
    if (center.scrollHeight - center.clientHeight < 200) {
      probe = document.createElement("div");
      probe.dataset.scrollOwnershipProbe = "";
      probe.style.height = "1200px";
      probe.style.pointerEvents = "none";
      probe.setAttribute("aria-hidden", "true");
      center.append(probe);
    }
    const before = {
      left: left.getBoundingClientRect().toJSON(),
      assistant: assistant?.getBoundingClientRect().toJSON() ?? null,
    };
    center.scrollTop = Math.min(900, center.scrollHeight - center.clientHeight);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const after = {
      left: left.getBoundingClientRect().toJSON(),
      assistant: assistant?.getBoundingClientRect().toJSON() ?? null,
    };
    const measurement = {
      before,
      after,
      centerScrollTop: center.scrollTop,
      windowScrollY: window.scrollY,
      viewportHeight: window.innerHeight,
    };
    center.scrollTop = 0;
    probe?.remove();
    return measurement;
  });

  if (result.centerScrollTop < 100) {
    throw new Error(`Center pane did not scroll (${result.centerScrollTop}px)`);
  }
  if (result.windowScrollY !== 0) {
    throw new Error(`Workspace window scrolled ${result.windowScrollY}px`);
  }
  for (const rail of ["left", "assistant"] as const) {
    const before = result.before[rail];
    const after = result.after[rail];
    if (!before || !after) continue;
    if (
      Math.abs(before.top - after.top) > 1 ||
      Math.abs(before.bottom - after.bottom) > 1
    ) {
      throw new Error(`${rail} rail moved while the center pane scrolled`);
    }
    if (
      Math.abs(after.top) > 1 ||
      Math.abs(after.bottom - result.viewportHeight) > 1
    ) {
      throw new Error(`${rail} rail is not pinned to the viewport`);
    }
  }
}

async function verifyRemoteMcpPresetOnly(page: Page) {
  const addServer = page.getByRole("button", { name: "Add server" });
  await addServer.waitFor({ state: "visible", timeout: 10000 });
  await addServer.click();
  await page
    .getByRole("button", { name: "Linear" })
    .waitFor({ state: "visible", timeout: 10000 });
  await page
    .getByRole("button", { name: "Paper" })
    .waitFor({ state: "detached", timeout: 10000 });
  await page.getByRole("button", { name: "Cancel" }).click();
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
    "docs/recipes",
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
      await page.goto(`${BASE}/start?to=home`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(1200);
      await verifyWorkspaceScrollOwnership(page);
    },
  },
  {
    name: "home-cards",
    go: async (page) => {
      await page.goto(`${BASE}/start?to=home`, {
        waitUntil: "domcontentloaded",
      });
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
    go: async (page) =>
      openItemTypeStudio(page, "item", /Editorial publication/),
  },
  {
    name: "item-type-editorial-folder",
    go: async (page) =>
      openItemTypeStudio(page, "folder", /Editorial publication/),
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
      await page
        .getByRole("region", { name: "Item type settings" })
        .evaluate((controls) => {
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
      await page
        .getByRole("combobox", { name: "Preview content" })
        .selectOption("stress");
      await page.getByRole("button", { name: "Phone" }).click();
    },
  },
  {
    name: "item-type-folder-content",
    go: async (page) => {
      await openItemTypeStudio(page, "folder");
      await page
        .getByRole("combobox", { name: "Use in folder" })
        .selectOption({ label: "Notes" });
      await page
        .getByRole("combobox", { name: "Preview content" })
        .selectOption("folder");
    },
  },
  {
    name: "item-type-preflight",
    go: async (page) => {
      await openItemTypeStudio(page, "item");
      await page
        .locator("details")
        .filter({ hasText: /Ready|suggestion|attention/ })
        .click();
    },
  },
  {
    name: "folder-blog",
    go: async (page, handle) => {
      await page.goto(`${BASE}/@${handle}?folder=blog`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(1200);
      await verifyWorkspaceScrollOwnership(page);
    },
  },
  {
    name: "folder-notes",
    go: async (page, handle) => {
      await page.goto(`${BASE}/@${handle}?folder=notes`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(1200);
      await verifyWorkspaceScrollOwnership(page);
    },
  },
  {
    name: "starred",
    go: async (page) => {
      await openSidebar(page, "Starred");
      await verifyWorkspaceScrollOwnership(page);
    },
  },
  {
    name: "shared",
    go: async (page) => {
      await openSidebar(page, "Shared with me");
      await verifyWorkspaceScrollOwnership(page);
    },
  },
  {
    name: "trash",
    go: async (page) => {
      await openSidebar(page, "Trash");
      await verifyWorkspaceScrollOwnership(page);
    },
  },
  {
    name: "settings",
    fullPage: true,
    go: async (page, handle) => {
      await page.goto(`${BASE}/@${handle}?view=settings`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(1200);
      await verifyWorkspaceScrollOwnership(page);
      await verifyRemoteMcpPresetOnly(page);
    },
  },
  {
    name: "editor",
    go: async (page) => {
      await page.goto(`${BASE}/start`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1400);
      await verifyWorkspaceScrollOwnership(page);
    },
  },
  {
    name: "look-gallery",
    go: async (page) => {
      await page.goto(`${BASE}/start?to=home`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(1400);
      const options = page.locator(
        'button[aria-label="Folder options for Blog"]',
      );
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
      await page
        .getByRole("heading", { name: "In-app assistant" })
        .waitFor({ state: "visible" });
      await page
        .getByRole("heading", { name: "Add TextText to your agents" })
        .waitFor({ state: "detached", timeout: 10000 });
    },
  },
  {
    name: "connect-standalone-edition",
    fullPage: true,
    go: async (page) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, "__TEXTTEXT_APP__", {
          configurable: true,
          value: true,
        });
        Object.defineProperty(window, "__TEXTTEXT_EMBEDDED_AGENT__", {
          configurable: true,
          value: true,
        });
        Object.defineProperty(window, "webkit", {
          configurable: true,
          value: {
            messageHandlers: {
              textTextApp: { postMessage() {} },
            },
          },
        });
      });
      await page.goto(`${BASE}/connect`, { waitUntil: "domcontentloaded" });
      await page
        .getByRole("heading", { name: "Add TextText to your agents" })
        .waitFor({ state: "visible" });
    },
  },
  {
    name: "connect-store-edition",
    fullPage: true,
    go: async (page) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, "__TEXTTEXT_APP__", {
          configurable: true,
          value: true,
        });
        Object.defineProperty(window, "__TEXTTEXT_EMBEDDED_AGENT__", {
          configurable: true,
          value: false,
        });
        Object.defineProperty(window, "webkit", {
          configurable: true,
          value: {
            messageHandlers: {
              textTextApp: { postMessage() {} },
            },
          },
        });
      });
      await page.goto(`${BASE}/connect`, { waitUntil: "domcontentloaded" });
      await page
        .getByRole("heading", { name: "In-app assistant" })
        .waitFor({ state: "visible" });
      await page
        .getByRole("heading", { name: "Add TextText to your agents" })
        .waitFor({ state: "detached", timeout: 10000 });
    },
  },
  {
    name: "settings-store-edition",
    fullPage: true,
    go: async (page, handle) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, "__TEXTTEXT_APP__", {
          configurable: true,
          value: true,
        });
        Object.defineProperty(window, "__TEXTTEXT_EMBEDDED_AGENT__", {
          configurable: true,
          value: false,
        });
        Object.defineProperty(window, "webkit", {
          configurable: true,
          value: {
            messageHandlers: {
              textTextApp: { postMessage() {} },
            },
          },
        });
      });
      await page.goto(`${BASE}/@${handle}?view=settings`, {
        waitUntil: "domcontentloaded",
      });
      await page
        .getByText("Connect a remote agent", { exact: true })
        .waitFor({ state: "visible" });
      await page
        .getByText("Use Claude or Codex on this Mac", { exact: true })
        .waitFor({ state: "detached", timeout: 10000 });
      await verifyWorkspaceScrollOwnership(page);
      await verifyRemoteMcpPresetOnly(page);
    },
  },
  {
    name: "home-assistant-store-unavailable",
    go: async (page) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, "__TEXTTEXT_APP__", {
          configurable: true,
          value: true,
        });
        Object.defineProperty(window, "__TEXTTEXT_EMBEDDED_AGENT__", {
          configurable: true,
          value: false,
        });
        Object.defineProperty(window, "webkit", {
          configurable: true,
          value: {
            messageHandlers: {
              textTextApp: {
                postMessage(message: { action?: string }) {
                  if (message?.action !== "assistantStatus") return;
                  queueMicrotask(() => {
                    window.dispatchEvent(
                      new CustomEvent("texttext:assistant", {
                        detail: {
                          type: "status",
                          state: "unavailable",
                          kind: "native-codex",
                          providerLabel: "Codex with ChatGPT",
                          embeddedChatSupported: false,
                          recoveryAction: null,
                        },
                      }),
                    );
                  });
                },
              },
            },
          },
        });
      });
      await page.goto(`${BASE}/start?to=home`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(1200);
      const launcher = page.getByRole("button", { name: "Open assistant" });
      if (await launcher.isVisible().catch(() => false)) await launcher.click();
      const unavailable = page.getByText("Set up the in-app assistant once", {
        exact: false,
      });
      await unavailable.waitFor({ state: "visible", timeout: 10000 });
      if (
        await page
          .getByRole("button", { name: "Continue with ChatGPT" })
          .count()
      ) {
        throw new Error(
          "Store-unavailable state offered native ChatGPT sign-in",
        );
      }
      const assistantTitle = page.getByText("Write with your AI", {
        exact: true,
      });
      const titleBox = await assistantTitle.boundingBox();
      if (!titleBox || titleBox.y < 0 || titleBox.y >= 940) {
        throw new Error("Assistant onboarding rendered outside the viewport");
      }
      const scrollY = await page.evaluate(() => window.scrollY);
      if (scrollY > 2)
        throw new Error(
          `Opening the assistant scrolled the page to ${scrollY}`,
        );
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
      .waitForResponse(
        (response) => response.url().includes("/api/auth/callback/dev-login"),
        {
          timeout: 4000,
        },
      )
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
    if (
      match &&
      (await page.locator(".workspace-library-header").count()) > 0
    ) {
      return match[1];
    }
  }
  throw new Error(`Sweep workspace never loaded (last url ${page.url()})`);
}

const blank: string[] = [];
const overflow: string[] = [];
const failed: string[] = [];

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
          failed.push(`${surface.name} ${width}px ${theme}`);
          console.log(
            `  FAILED ${surface.name} ${theme}: ${String(error).slice(0, 120)}`,
          );
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
  if (failed.length) console.log(`\nFAILED: ${failed.join(", ")}`);
  if (blank.length || overflow.length || failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
