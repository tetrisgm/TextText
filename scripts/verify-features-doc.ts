// Hold /docs/features to its own house rule.
//
//   npm run dev
//   npm run eval:features
//
// The page promises that every behavior on it has been exercised in a running
// build. That promise was a habit, kept by whoever wrote the page, which is
// the kind of promise that quietly stops being true: this session found the
// page still describing a Layout control that had been deleted from the Blog
// page hours earlier. So the claims that can be driven are driven here, and
// the ones that cannot are named at the end rather than left to look checked.
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
  // The dev sign-in occasionally needs a second beat before the session cookie
  // is on the context; landing on /signin means it has not arrived yet.
  for (let attempt = 0; attempt < 3 && page.url().includes("/signin"); attempt += 1) {
    await page.waitForTimeout(1200);
    await page.goto(`${BASE}/editor`, { waitUntil: "domcontentloaded" });
  }
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
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
        claims.includes("workspace token"),
      "the page was rewritten; update this verifier with it",
    );

    await openHome(page);

    // "Type a thought, a title, or paste a link into the box at the top of
    //  your Library and it becomes an item immediately."
    const capture = page.locator('[placeholder="Type a title, or paste a link"]');
    check("the Library has the capture box the page describes", (await capture.count()) > 0);

    // "filters for articles, notes, and bookmarks and a sort control"
    const filters = await page
      .locator('[aria-label="Filter library items"] button, .workspace-library-filters button')
      .allInnerTexts();
    const joined = filters.join(" ");
    check(
      "the Library offers the filters the page names",
      ["Articles", "Notes", "Bookmarks"].every((label) => joined.includes(label)),
      joined.slice(0, 60),
    );
    check(
      "the Library offers a sort control",
      (await page.locator('select[aria-label="Sort library items"]').count()) > 0,
    );

    // "How Home lays out ... list, one column, or cards."
    const views = await page
      .locator(".workspace-view-segmented button")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
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
    await page.locator(".applecms [contenteditable], textarea").first().click().catch(() => undefined);
    await page.keyboard.type("A passage worth rewriting, summarizing and excerpting.");
    await page.waitForTimeout(600);
    await page.keyboard.press("Meta+A");
    await page.waitForTimeout(900);
    const selection = await page.locator("body").innerText();
    check(
      "selecting text offers Rewrite, Summarize and Excerpt",
      ["Rewrite", "Summarize", "Excerpt"].every((label) => selection.includes(label)),
    );

    // "Closed, the rail folds into a small round avatar at the bottom right."
    const close = page.locator('[aria-label="Hide assistant"]').first();
    if ((await close.count()) > 0) await close.click();
    await page.waitForTimeout(800);
    check(
      "closing the rail leaves the launcher behind",
      (await page.locator('button[aria-label^="Open assistant"], button[aria-label^="Chat with"]').count()) > 0,
    );

    // "An agent authenticates with a workspace token you create at /connect."
    await page.goto(`${BASE}/connect`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1600);
    const connect = await page.locator("body").innerText();
    check(
      "/connect is where a workspace token is created",
      /token/i.test(connect) && !/OAuth/i.test(connect),
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
      "  agent edits appear as a live collaborator -> npm run eval:collaboration:browser",
  );
  console.log(failures === 0 ? "\npass" : `\n${failures} claim(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
