// Live proof that a running turn reports itself where it was started.
//
//   node scripts/mock-ai-provider.mjs &
//   TEXTTEXT_AI_BASE_URL=http://localhost:3999/v1 npm run dev
//   npm run eval:turn-progress
//
// This is the DETERMINISTIC provider lane. It proves where the signal is and
// whether it stays on screen, not that any real provider said anything.
//
// The rail used to scroll only when a message was added, so a streamed answer
// grew past the bottom edge and carried the working line off screen with it.
// What was left was the jobs strip above the conversation, which announced the
// turn at the top of the panel while the person watched the bottom.
//
// The prompt carries SLOW_STREAM, the mock provider's marker for a turn held
// open long enough to be photographed. It is visible in the screenshots; that
// is the marker, not product copy.

import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.TEXTTEXT_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOT_DIR ?? "/tmp/texttext-turn-progress";
const WHO = { email: "turn-progress-aug26@example.com", name: "Progress" };

/** Long enough that the transcript must scroll to keep the end in view. */
const PROMPT = [
  "Create a note about: Project Requirements",
  "",
  ...Array.from(
    { length: 12 },
    (_, index) =>
      `Requirement ${index + 1}: the project must install and run consistently on the platform it is intended for, and must behave as the description says it does.`,
  ),
  "",
  "SLOW_STREAM",
].join("\n");

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
  const key = page.locator('input[placeholder="Paste a provider API key"]');
  if ((await key.count()) === 0) {
    console.log("    (provider already connected)");
    return;
  }
  await key.fill("sk-ant-mock-provider-key");
  await page.getByRole("button", { name: "Add key" }).click();
  await page.waitForTimeout(2500);
}

type Reading = {
  /** The working line is on screen at all. */
  present: boolean;
  /** It sits after the last thing the person said, not above it. */
  belowTheMessage: boolean;
  /** It is inside the visible part of the panel, not scrolled past. */
  inView: boolean;
  /** How far the transcript is from its own end. */
  fromBottom: number;
  /** What the strip above the conversation is announcing, if anything. */
  strip: string | null;
  text: string;
};

/** Read the rail the way a person looks at it: what is on screen, and where. */
async function readRail(page: Page): Promise<Reading> {
  return page.evaluate(() => {
    const thread = document.querySelector<HTMLElement>('[role="log"]');
    const working = thread?.querySelector<HTMLElement>('[role="status"]') ?? null;
    // Every turn in the transcript renders as userTurn, assistantTurn or
    // errorTurn; the working line is not one of them.
    const messages = thread
      ? [...thread.querySelectorAll<HTMLElement>('[class*="Turn"]')]
      : [];
    const last = messages[messages.length - 1] ?? null;
    let scroller = thread?.parentElement ?? null;
    while (scroller) {
      const overflowY = getComputedStyle(scroller).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") break;
      scroller = scroller.parentElement;
    }
    const strip = document.querySelector<HTMLElement>(
      '[aria-label="Assistant jobs"]',
    );
    const workingBox = working?.getBoundingClientRect();
    const scrollerBox = scroller?.getBoundingClientRect();
    return {
      present: Boolean(working),
      belowTheMessage: Boolean(
        working &&
          last &&
          last.compareDocumentPosition(working) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      inView: Boolean(
        workingBox &&
          scrollerBox &&
          workingBox.top >= scrollerBox.top - 2 &&
          workingBox.bottom <= scrollerBox.bottom + 2,
      ),
      fromBottom: scroller
        ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
        : -1,
      strip: strip ? strip.innerText.replace(/\s+/g, " ") : null,
      text: working?.textContent?.trim() ?? "",
    };
  });
}

async function watchOneTurn(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(`${BASE}/start?to=home`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);

  const composer = page.locator('textarea[aria-label="Message assistant"]');
  await composer.waitFor({ timeout: 20000 });
  await composer.fill(PROMPT);
  await composer.press("Enter");

  // Sample the whole time the turn is open, not one lucky instant. The old
  // behavior showed the line and then let it drift off within a second.
  const readings: Reading[] = [];
  for (let sample = 0; sample < 5; sample += 1) {
    await page.waitForTimeout(800);
    const reading = await readRail(page);
    if (!reading.present) break;
    readings.push(reading);
    if (sample === 2) {
      await page.screenshot({ path: `${SHOTS}/working-${theme}.png` });
    }
  }

  check(
    `${theme}: the running turn says so in the conversation`,
    readings.length > 0,
    "no working line was ever on screen",
  );
  check(
    `${theme}: it sits below the message that started it`,
    readings.length > 0 && readings.every((reading) => reading.belowTheMessage),
  );
  check(
    `${theme}: it stays on screen for the whole turn`,
    readings.length > 0 && readings.every((reading) => reading.inView),
    readings.map((reading) => (reading.inView ? "in" : "out")).join(" "),
  );
  check(
    `${theme}: the transcript follows the answer as it arrives`,
    readings.every((reading) => reading.fromBottom <= 32),
    readings.map((reading) => reading.fromBottom).join(", "),
  );
  check(
    `${theme}: nothing announces this turn above the conversation`,
    readings.every((reading) => reading.strip === null),
    readings.find((reading) => reading.strip)?.strip?.slice(0, 80) ?? "",
  );
  if (readings.length > 0) {
    console.log(`    (${readings.length} samples, saying "${readings[0].text}")`);
  }

  // Leave the thread settled so the next theme starts from a quiet rail.
  await page.waitForTimeout(6000);
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
    await watchOneTurn(page, "light");
    await watchOneTurn(page, "dark");
  } finally {
    await browser.close();
  }

  console.log(
    "\nnot checked here, and checked elsewhere instead:\n" +
      "  work started elsewhere still lists in the strip -> unit tests on jobsForOtherThreads\n" +
      "  a refused command reaches the rail              -> npm run eval:turn-receipt",
  );
  console.log(
    failures === 0 ? `\npass. screenshots in ${SHOTS}` : `\n${failures} check(s) failed`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
