// Live proof that a finished turn does not claim a change that never happened.
//
//   node scripts/mock-ai-provider.mjs &
//   TEXTTEXT_AI_BASE_URL=http://localhost:3999/v1 npm run dev
//   npm run eval:turn-receipt
//
// This is the DETERMINISTIC provider lane. It proves the receipt and label
// behavior of the rail, not that any real provider said anything; do not
// present its screenshots as evidence of a live model response.
//
// The turn asks for an item that does not exist. The command fails, the model
// is told and narrates the failure in its own prose, and the two things under
// test are whether the rail shows the EXECUTOR's message rather than that
// prose, and whether a turn that changed nothing still reads as Done.

import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.TEXTTEXT_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOT_DIR ?? "/tmp/texttext-turn-receipt";
const WHO = { email: "turn-receipt-aug26@example.com", name: "Receipt" };

// What the executor says, verbatim, when an id resolves to nothing.
const EXECUTOR_ERROR =
  'No item with id "00000000-0000-4000-8000-000000000000" exists in this workspace.';
// What the model says about the same failure. Never a receipt.
const MODEL_PROSE = "I could not open that item";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` (${detail})` : ""}`);
  }
}

async function devSignIn(page: Page) {
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
  }
  throw new Error("dev sign-in never took");
}

/** Point the workspace at the mock provider so the turn is repeatable. */
async function connectMockProvider(page: Page, handle: string) {
  await page.goto(`${BASE}/@${handle}?view=settings`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1500);
  // Idempotent: a workspace that already carries a key shows a connected state
  // instead of the field, and re-running the eval must not depend on which.
  const key = page.locator('input[placeholder="Paste a provider API key"]');
  if ((await key.count()) === 0) {
    console.log("    (provider already connected)");
    return;
  }
  await key.fill("sk-ant-mock-provider-key");
  await page.getByRole("button", { name: "Add key" }).click();
  await page.waitForTimeout(2500);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 940 },
  });
  const page = await context.newPage();

  try {
    await devSignIn(page);
    const handle = /\/@([^/?#]+)/.exec(page.url())?.[1] ?? "";
    check("signed in to a workspace", handle.length > 0, page.url());
    await connectMockProvider(page, handle);

    await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);

    const composer = page.locator('textarea[aria-label="Message assistant"]');
    await composer.waitFor({ timeout: 20000 });
    await composer.fill("Please open the missing item and tell me what it says");
    await composer.press("Enter");

    // The turn has to finish before the label means anything.
    await page
      .locator('[data-status="error"], [data-status="done"]')
      .first()
      .waitFor({ timeout: 45000 })
      .catch(() => undefined);
    await page.waitForTimeout(3000);

    const rail = await page.locator("body").innerText();

    check(
      "the rail shows the executor's own message",
      rail.includes(EXECUTOR_ERROR),
      rail.includes(MODEL_PROSE)
        ? "only the model's prose is on screen"
        : "neither message found",
    );

    const jobStatuses = await page
      .locator("[data-status]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-status")),
      );
    check(
      "the turn is not labelled done",
      !jobStatuses.includes("done"),
      jobStatuses.join(", ") || "no job row found",
    );
    check(
      "the turn is labelled as having changed nothing",
      rail.includes("Nothing changed"),
      jobStatuses.join(", "),
    );

    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/receipt-${theme}.png` });
    }
  } finally {
    await browser.close();
  }

  console.log(
    failures === 0
      ? `\npass. screenshots in ${SHOTS}`
      : `\n${failures} check(s) failed`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
