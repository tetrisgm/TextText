// Hold /docs/features to its own house rule.
//
//   npm run dev
//   npm run eval:features
//
// The page names the claims covered by a running product eval. This script
// drives those claims, while behavior covered by narrower product evals or unit
// tests is named at the end instead of being presented as checked here.
//
// A claim fails here when the page says something the app does not do. It is
// not a design review; it does not care how any of it looks.

import { chromium, type Browser, type Page } from "playwright";

const BASE = process.env.TEXTTEXT_BASE_URL ?? "http://localhost:3000";
const WHO = { email: "features-doc-aug16@example.com", name: "Features" };

let failures = 0;

function check(claim: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${claim}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${claim}${detail ? ` (${detail})` : ""}`);
  }
}

async function devSignIn(page: Page) {
  // Retry the whole form submission. Retrying only the destination after a
  // bounce cannot create the missing session and makes every later claim fail
  // for an unrelated reason.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(`${BASE}/editor`, { waitUntil: "networkidle" });
    const form = page.locator("form.ac-devsignin");
    await form.waitFor({ timeout: 20000 }).catch(() => undefined);
    if ((await form.count()) === 0) return;
    await form.locator('input[type="email"]').fill(WHO.email);
    await form
      .locator('input[placeholder="Name (optional)"]')
      .first()
      .fill(WHO.name)
      .catch(() => undefined);
    await form.locator('button[type="submit"]').click();
    await page.waitForTimeout(2500);
    await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    if (!page.url().includes("/signin")) return;
    console.log(`    (sign-in bounced, retry ${attempt})`);
  }
  throw new Error("dev sign-in never took");
}

async function openHome(page: Page) {
  // A workspace is provisioned on the first visit, so the first /start can
  // land in the editor while it is still being made. Ask again until Home is
  // actually Home rather than photographing whatever answered first.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1600);
    if ((await page.locator(".workspace-view-segmented").count()) > 0) return;
  }
  throw new Error(`Home never loaded (last url ${page.url()})`);
}

/** The page's own text, so a claim cannot be checked against a stale copy. */
async function pageClaims(page: Page): Promise<string> {
  await page.goto(`${BASE}/docs/features`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
}

async function main() {
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 940 },
  });
  const page = await context.newPage();

  try {
    // Sign in first. Loading a public page into a fresh context before the
    // dev sign-in leaves the session on the wrong footing and every check
    // below fails for a reason that has nothing to do with the claims.
    await devSignIn(page);
    const claims = await pageClaims(page);
    check(
      "the page still makes the claims this verifier checks",
      claims.includes("Type a thought") &&
        claims.includes("Save as look") &&
        claims.includes("revocable bearer token") &&
        claims.includes("Build an item type") &&
        claims.includes("Look library is searchable") &&
        claims.includes("before/current comparison") &&
        claims.includes("guarded status workflows") &&
        claims.includes("several named views"),
      "the page was rewritten; update this verifier with it",
    );

    await openHome(page);

    // "Build an item type opens one focused studio from Home" and complete
    // starters work without connecting a provider.
    const buildItemType = page.locator(".workspace-build-type-button");
    check(
      "Home offers the item-type builder",
      (await buildItemType.count()) === 1,
    );
    await buildItemType.click();
    check(
      "the item-type builder is one focused studio with ready-made starters",
      (await page
        .getByRole("heading", { name: "What do you want to build?" })
        .count()) === 1 &&
        (await page
          .getByRole("button", { name: /Editorial publication/ })
          .count()) === 1 &&
        (await page.getByRole("button", { name: /Project board/ }).count()) ===
          1 &&
        (await page.getByRole("button", { name: /Quick notes/ }).count()) === 1,
    );
    await page.getByRole("button", { name: /Project board/ }).click();
    check(
      "the studio previews both the item and its folder",
      (await page.getByRole("tab", { name: "Item" }).count()) === 1 &&
        (await page.getByRole("tab", { name: "Folder" }).count()) === 1,
    );
    check(
      "the studio exposes the exercised history, responsive content and preflight controls",
      (await page.getByRole("combobox", { name: "Design version" }).count()) ===
        1 &&
        (await page.getByRole("group", { name: "Preview device" }).count()) ===
          1 &&
        (await page
          .getByRole("combobox", { name: "Preview content" })
          .count()) === 1 &&
        (await page
          .locator("details")
          .filter({ hasText: /Ready|suggestion|attention/ })
          .count()) === 1,
    );
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });

    // "Type a thought, a title, or paste a link into the box at the top of
    //  your Library and it becomes an item immediately."
    const capture = page.locator(
      '[placeholder="Type a title, or paste a link"]',
    );
    check(
      "the Library has the capture box the page describes",
      (await capture.count()) > 0,
    );

    // "filters for articles, notes, and bookmarks and a sort control"
    const filters = await page
      .locator(
        '[aria-label="Filter library items"] button, .workspace-library-filters button',
      )
      .allInnerTexts();
    const joined = filters.join(" ");
    check(
      "the Library offers the filters the page names",
      ["Articles", "Notes", "Bookmarks"].every((label) =>
        joined.includes(label),
      ),
      joined.slice(0, 60),
    );
    check(
      "the Library offers a sort control",
      (await page.locator('select[aria-label="Sort library items"]').count()) >
        0,
    );

    // "How Home lays out ... list, one column, or cards."
    const views = await page
      .locator(".workspace-view-segmented button")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("aria-label")),
      );
    check(
      "Home offers exactly the three layouts the page names",
      JSON.stringify(views) === JSON.stringify(["List", "One column", "Cards"]),
      views.join(", "),
    );

    // "Starred keeps the items you pin. Trash keeps what you delete."
    const sidebar = await page.locator(".post-editor-sidebar").innerText();
    check(
      "Starred and Trash are where the page says they are",
      sidebar.includes("Starred") && sidebar.includes("Trash"),
    );

    // "the Look control in the editor" and "the save state is always visible"
    await page.goto(`${BASE}/start`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);
    const editor = await page.locator("body").innerText();
    check("the editor carries the Look control", editor.includes("Look"));
    check("the editor shows its save state", /Saved|Saving/.test(editor));

    // "Save as look in the editor takes the document's own presentation"
    await page
      .locator('summary[aria-label="More actions"]')
      .first()
      .click()
      .catch(() => undefined);
    await page.waitForTimeout(500);
    const menu = await page.locator("body").innerText();
    check(
      "the editor offers Save as look",
      /Save as look|Save this document as a look/i.test(menu),
    );
    // Close the menu before touching the document: an open <details> sits over
    // the text and swallows the click that makes the selection.
    await page.evaluate(() => {
      document
        .querySelectorAll("details.tt-editor-more[open]")
        .forEach((node) => node.removeAttribute("open"));
    });
    await page.waitForTimeout(300);

    // "Rewrite, Summarize, and Excerpt appear above the selection"
    const documentBody = page.getByRole("textbox", { name: "Document body" });
    await documentBody.click();
    await page.keyboard.type(
      "A passage worth rewriting, summarizing and excerpting.",
    );
    const selectionActions = page.getByRole("toolbar", {
      name: "AI actions for the selected text",
    });
    let selectionReady = false;
    for (let attempt = 0; attempt < 3 && !selectionReady; attempt += 1) {
      await documentBody.click();
      await page.keyboard.press("Meta+A");
      selectionReady = await selectionActions
        .waitFor({ state: "visible", timeout: 2500 })
        .then(() => true)
        .catch(() => false);
    }
    const selectionLabels = selectionReady
      ? await selectionActions.getByRole("button").allInnerTexts()
      : [];
    check(
      "selecting text offers Rewrite, Summarize and Excerpt",
      ["Rewrite", "Summarize", "Excerpt"].every((label) =>
        selectionLabels.includes(label),
      ),
      selectionLabels.join(", "),
    );

    // "Closed, the rail folds into a small round avatar at the bottom right."
    const close = page.locator('[aria-label="Hide assistant"]').first();
    if ((await close.count()) > 0) await close.click();
    await page.waitForTimeout(800);
    check(
      "closing the rail leaves the launcher behind",
      (await page
        .locator(
          'button[aria-label^="Open assistant"], button[aria-label^="Chat with"]',
        )
        .count()) > 0,
    );

    // "Remote MCP clients use ... a revocable bearer token created at /connect."
    await page.goto(`${BASE}/connect`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1600);
    const advancedConnections = page.getByText("Advanced connections", {
      exact: true,
    });
    if (await advancedConnections.isVisible().catch(() => false)) {
      await advancedConnections.click();
    }
    const connect = await page.locator("body").innerText();
    check(
      "/connect is where a remote MCP bearer token is created",
      connect.includes("Manual access tokens") && !/OAuth/i.test(connect),
      /OAuth/i.test(connect) ? "the page still mentions OAuth" : "",
    );
  } finally {
    await browser.close();
  }

  console.log(
    "\nnot checked here, and checked elsewhere instead:\n" +
      "  looks are immutable and pin a version   -> unit tests on the template store\n" +
      "  a folder's look governs its index       -> npm run eval:home-layout\n" +
      "  an added MCP server is saved switched off -> npm run eval:mcp:outbound\n" +
      "  agent edits appear as a live collaborator -> npm run eval:collaboration:browser\n" +
      "  item-type save, inheritance and folder rendering -> npm run eval:item-type",
  );
  console.log(failures === 0 ? "\npass" : `\n${failures} claim(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
