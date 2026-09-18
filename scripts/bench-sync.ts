// Two people, one document: how fast does a word travel, and do both sides
// end up with the same text.
//
// Everything else measures one client. This opens two, puts them in the same
// item, and watches what happens between them. It answers the two questions
// that decide whether collaboration works at all:
//
//   HOW LONG. From a keystroke in one window to the same characters in the
//   other. Reported as median and 95th percentile, against a budget.
//
//   DO THEY AGREE. After both sides type at once, with no coordination, both
//   windows must settle on the same text, and it must contain what each of
//   them wrote. Converging on something neither person typed is worse than
//   being slow, and a fixed wait would call a slow merge a broken one, so
//   this waits for the two windows to stop changing and then compares.
//
// It types into a note it made for itself and destroys afterwards. A
// benchmark that edits the workspace's real notes is a benchmark that damages
// them, which is how this one started.
//
//   npm run bench:sync
//   npx tsx scripts/bench-sync.ts --origin http://localhost:3100 --runs 8
//
// Needs a production build served with AUTH_DEV_LOGIN=1:
//   AUTH_DEV_LOGIN=1 npm run build && AUTH_DEV_LOGIN=1 npx next start -p 3100

import { loadEnvConfig } from "@next/env";
import { chromium, type BrowserContext, type Page } from "playwright";

loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

const argOf = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);
  return at > 0 ? process.argv[at + 1] : undefined;
};

const ORIGIN = argOf("--origin") ?? "http://localhost:3100";
const HANDLE = argOf("--handle") ?? "showcase";
const RUNS = Number(argOf("--runs") ?? 8);
const BUDGET_MS = Number(argOf("--budget") ?? 2000);
/** How long a word may take to cross before the run is called a failure. */
const GIVE_UP_MS = 20_000;
/** How long the two windows may keep changing before they must have agreed. */
const SETTLE_MS = 30_000;
/** Long enough that both queues are empty before a measured keystroke. */
const QUIET_MS = 600;
/**
 * One-character markers, each appearing nowhere else in the document, so a
 * single keystroke can be waited for without a word's worth of typing around
 * it. Run out of them and the runs simply reuse one, which is harmless: the
 * far window is waiting for a character it does not yet have either way.
 */
const MARKS = [..."§¶µ¥¤‡†°±÷×¬¦«»‹›„‚…‰©®™"];

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

async function signIn(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}/api/auth/csrf`, { waitUntil: "domcontentloaded" });
  const csrfToken = JSON.parse(await page.locator("body").first().innerText()).csrfToken as string;
  const answer = await page.request.post(`${ORIGIN}/api/auth/callback/dev-login`, {
    form: { csrfToken, email: `${HANDLE}@texttext.dev`, name: HANDLE, callbackUrl: "/" },
  });
  if (!answer.ok() && answer.status() !== 302) {
    throw new Error(`dev login refused (${answer.status()}). Serve the build with AUTH_DEV_LOGIN=1.`);
  }
}

/**
 * The document body, and only the body. The title beside it is a textarea and
 * the assistant below it is another, so a selector that takes the first
 * editable thing on the page types into the wrong one, which is how an
 * earlier version of this benchmark rewrote a note's title.
 */
const BODY = `document.querySelector('[aria-label="Document body"]')`;
const BODY_TEXT = `(${BODY} ? ${BODY}.textContent : null)`;

/** Put the caret at the end of the body, where a person typing would be. */
const FOCUS_BODY_END = `(() => {
  const body = ${BODY};
  if (!body) return false;
  body.focus();
  const range = document.createRange();
  range.selectNodeContents(body);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
})()`;

async function openNote(page: Page, path: string): Promise<void> {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[aria-label="Document body"]', { timeout: 60_000 });
  // The collaborative session connects after the body paints. Typing before
  // it does measures the reconnect, not the sync.
  await page.waitForTimeout(2500);
}

/**
 * Type into the body. The delay is part of the measurement, not a detail: a
 * marker typed a character at a time takes as long to type as it does to
 * cross, and the two cannot then be told apart. Zero means the clock that
 * starts when this returns is measuring the sync and nothing else.
 */
async function type(page: Page, marker: string, delay = 0): Promise<void> {
  const focused = await page.evaluate(FOCUS_BODY_END);
  if (!focused) throw new Error("the document body is not on the page");
  await page.keyboard.type(marker, { delay });
}

async function bodyOf(page: Page): Promise<string> {
  return ((await page.evaluate(BODY_TEXT)) as string | null) ?? "";
}

/** Wait until the other window's body contains the marker. */
async function waitForMarker(page: Page, marker: string): Promise<number | null> {
  const started = Date.now();
  while (Date.now() - started < GIVE_UP_MS) {
    if ((await bodyOf(page)).includes(marker)) return Date.now() - started;
    await page.waitForTimeout(25);
  }
  return null;
}

/**
 * Wait for both windows to stop changing and hold the same text.
 *
 * Comparing after a fixed delay reports a merge that is still travelling as a
 * merge that failed. Convergence has a shape: the text settles, and then the
 * two agree. Waiting for that shape is the only way to tell the two apart.
 */
async function waitUntilAgreed(left: Page, right: Page): Promise<number | null> {
  const started = Date.now();
  while (Date.now() - started < SETTLE_MS) {
    const here = await bodyOf(left);
    const there = await bodyOf(right);
    if (here === there && here.length > 0) return Date.now() - started;
    await left.waitForTimeout(50);
  }
  return null;
}

/** A note of this benchmark's own, and the path both windows open it at. */
async function makeScratchNote(): Promise<{ id: string; path: string; remove: () => Promise<void> }> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Local Postgres only. This writes and destroys a note, and is not for the production database.");
  }
  const store = await import("../src/lib/store");
  const folders = await store.getFolders(HANDLE);
  const notes = folders.find((folder) => folder.mode === "notes");
  if (!notes) throw new Error(`@${HANDLE} has no notes folder`);
  const note = await store.createDraftInFolder(HANDLE, notes.id, {
    initial: { type: "note", title: "Sync benchmark scratch", body: "The benchmark types after this line.\n" },
  });
  const id = note.id!;
  return {
    id,
    path: `/t/${HANDLE}/${notes.path}/${note.slug}?edit=1&id=${id}`,
    remove: async () => {
      await store.deletePost(HANDLE, id);
      await store.permanentlyDeletePost(HANDLE, id);
    },
  };
}

async function main() {
  const scratch = await makeScratchNote();
  const browser = await chromium.launch();
  const contexts: BrowserContext[] = [];
  let failed = true;
  try {
    const open = async (): Promise<Page> => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      contexts.push(context);
      const page = await context.newPage();
      await signIn(page);
      await openNote(page, scratch.path);
      return page;
    };
    const left = await open();
    const right = await open();

    console.log(`\n  ${ORIGIN}, @${HANDLE}, one note, two windows, ${RUNS} runs, budget ${BUDGET_MS}ms\n`);

    const leftToRight: number[] = [];
    const rightToLeft: number[] = [];
    let lost = 0;
    for (let run = 0; run < RUNS; run += 1) {
      // One character, after a pause: the moment the far window learns that
      // anybody is writing at all. A longer marker would measure how long it
      // takes to type it as much as how long it takes to arrive.
      const outward = MARKS[(run * 2) % MARKS.length];
      // After a pause means after a pause. Without one the previous round's
      // batch is still in the queue and this measures that, not this keystroke.
      await left.waitForTimeout(QUIET_MS);
      await type(left, outward);
      const there = await waitForMarker(right, outward);
      if (there === null) lost += 1;
      else leftToRight.push(there);
      if (process.env.BENCH_SYNC_VERBOSE === "1") console.log(`    key ${run} L->R: ${there}ms`);

      const back = MARKS[(run * 2 + 1) % MARKS.length];
      await right.waitForTimeout(QUIET_MS);
      await type(right, back);
      const home = await waitForMarker(left, back);
      if (home === null) lost += 1;
      else rightToLeft.push(home);
    }

    // Somebody writing a sentence, at the speed a person writes one. A burst
    // batches deliberately, so this is slower than a word arriving on its own
    // and is the honest number for what the far window sees while you type.
    const sustained: number[] = [];
    for (let run = 0; run < Math.min(RUNS, 4); run += 1) {
      const sentence = ` S${run}${Math.random().toString(36).slice(2, 6)} and the rest of a sentence typed at speaking pace `;
      await type(left, sentence, 55);
      const there = await waitForMarker(right, sentence.trim());
      if (there === null) lost += 1;
      else sustained.push(there);
      if (process.env.BENCH_SYNC_VERBOSE === "1") console.log(`    sentence ${run}: ${there}ms`);
    }

    // Both at once, with no coordination. This is the part that decides
    // whether the merge is a merge or a race.
    const bothLeft = ` SIMUL-L-${Math.random().toString(36).slice(2, 7)} `;
    const bothRight = ` SIMUL-R-${Math.random().toString(36).slice(2, 7)} `;
    await Promise.all([type(left, bothLeft), type(right, bothRight)]);
    const agreedAfter = await waitUntilAgreed(left, right);
    const settled = await bodyOf(left);
    const keptBoth = settled.includes(bothLeft.trim()) && settled.includes(bothRight.trim());

    const row = (label: string, samples: number[]) =>
      samples.length === 0
        ? `  ${label.padEnd(24)}  not measured`
        : `  ${label.padEnd(24)}  ${percentile(samples, 50).toString().padStart(6)}ms  ${percentile(samples, 95)
            .toString()
            .padStart(6)}ms  ${Math.max(...samples).toString().padStart(6)}ms`;
    console.log("  what crosses              median     p95   worst");
    console.log("  ------------------------  ------  ------  ------");
    console.log(row("first key, left to right", leftToRight));
    console.log(row("first key, right to left", rightToLeft));
    console.log(row("a sentence, as typed", sustained));

    console.log(
      `\n  typing at once: ${agreedAfter === null ? `THE WINDOWS NEVER AGREED within ${SETTLE_MS / 1000}s` : `both windows agree, after ${agreedAfter}ms`}`,
    );
    console.log(`                  ${keptBoth ? "both edits survived" : "AN EDIT WAS LOST"}`);
    if (lost > 0) console.log(`\n  ${lost} edits never crossed within ${GIVE_UP_MS / 1000}s.`);

    const slowest = Math.max(percentile(leftToRight, 95) || 0, percentile(rightToLeft, 95) || 0);
    failed = lost > 0 || agreedAfter === null || !keptBoth || slowest > BUDGET_MS || leftToRight.length === 0;
    console.log(
      failed
        ? `\n  Sync is not healthy: see above.\n`
        : `\n  A keystroke crosses in ${percentile(leftToRight, 95)}ms at the 95th, a sentence as it is typed in ${percentile(sustained, 95)}ms, and both windows agree.\n`,
    );
    for (const context of contexts) await context.close();
  } finally {
    await browser.close();
    // Whatever happened, the workspace gets its scratch note taken back.
    await scratch.remove();
    const { closeDatabaseConnections } = await import("../src/lib/db/client");
    await closeDatabaseConnections();
  }
  process.exit(failed ? 1 : 0);
}

void main();
