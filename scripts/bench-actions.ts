// How long the app takes to answer, for the things a person actually does.
//
// The number that matters is click to rendered: from the moment someone acts
// to the moment the screen shows the result. Not server time, which floors
// out at a few round trips however clean the queries are, and not a
// development server, whose per-request recompile makes every measurement
// fiction. This drives the real surfaces against a production build and
// reports the median and the 95th percentile of each action.
//
// The budget is 200ms per action. Anything over it is a defect.
//
//   npm run bench
//   npx tsx scripts/bench-actions.ts --origin http://localhost:3100 --runs 12
//
// Needs a production build served with AUTH_DEV_LOGIN=1:
//   AUTH_DEV_LOGIN=1 npm run build && AUTH_DEV_LOGIN=1 npx next start -p 3100

import { chromium, type Page } from "playwright";

const argOf = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);
  return at > 0 ? process.argv[at + 1] : undefined;
};

const ORIGIN = argOf("--origin") ?? "http://localhost:3100";
const HANDLE = argOf("--handle") ?? "showcase";
const RUNS = Number(argOf("--runs") ?? 10);
const BUDGET_MS = Number(argOf("--budget") ?? 200);

/** An action, and what it means for the screen to have answered. */
type Action = {
  name: string;
  /** Put the page where the action starts. Not measured. */
  setUp: (page: Page) => Promise<void>;
  /** Source for an expression returning the element to click, evaluated in
   * the page so a target can be chosen by its text. */
  click: string;
  /**
   * Read before the click, and available to `settled` as `before`. A
   * presence check is the trap this exists to avoid: "is there an h1" was
   * already true on the page the action starts from, so the clock stopped on
   * the same frame and reported seven milliseconds for a page load.
   */
  before?: string;
  /**
   * A request path this action must complete before it counts as answered.
   * Comparing rendered text is not enough when two channels share their top
   * story: the predicate never becomes true and the run is silently dropped.
   */
  awaitsRequest?: string;
  /** Evaluated in the page until true. The clock stops here. */
  settled: string;
};

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[at];
}

/**
 * Click and wait for the answer, timed inside the page.
 *
 * Timing from the driver would fold in a CDP round trip each way, which is
 * tens of milliseconds of the instrument rather than the app. The click and
 * the poll both run in the page, so what comes back is what a person waits.
 */
async function timeAction(page: Page, action: Action): Promise<number | null> {
  // Sent as source, not as a closure: the TypeScript runner annotates compiled
  // functions with a helper that does not exist in the page.
  const source = `new Promise((resolve) => {
    const target = (${action.click});
    if (!target) { resolve(null); return; }
    const before = ${action.before ? `(${action.before})()` : "undefined"};
    const answered = (${action.settled});
    const wanted = ${action.awaitsRequest ? JSON.stringify(action.awaitsRequest) : "null"};
    let arrived = wanted === null;
    const originalFetch = window.fetch;
    if (wanted !== null) {
      window.fetch = function () {
        const url = String((arguments[0] && arguments[0].url) || arguments[0] || "");
        const answer = originalFetch.apply(this, arguments);
        if (url.indexOf(wanted) !== -1) { answer.then(function () { arrived = true; }, function () { arrived = true; }); }
        return answer;
      };
    }
    const finish = (value) => { window.fetch = originalFetch; resolve(value); };
    const started = performance.now();
    target.click();
    const deadline = started + 10000;
    const look = () => {
      let done = false;
      try { done = arrived && answered(); } catch (error) { done = false; }
      if (done) { finish(performance.now() - started); return; }
      if (performance.now() > deadline) { finish(null); return; }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  })`;
  return (await page.evaluate(source)) as number | null;
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

const home = async (page: Page) => {
  await page.goto(`${ORIGIN}/t/${HANDLE}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-home-news] ol > li", { timeout: 60_000 });
  await page.waitForTimeout(400);
};

const ACTIONS: Action[] = [
  {
    name: "open an article",
    setUp: home,
    click: `document.querySelector("[data-home-news] ol > li")`,
    before: `() => location.pathname`,
    // The reader's own title, which the Home does not have, AND a URL that
    // moved. Either alone can be true without the other having happened.
    settled: `() => Boolean(document.querySelector("h1.tt-text-title")) && location.pathname !== before`,
  },
  {
    name: "back to the news",
    setUp: async (page) => {
      await home(page);
      await page.click("[data-home-news] ol > li");
      await page.waitForSelector("h1.tt-text-title", { timeout: 60_000 });
      await page.waitForTimeout(300);
    },
    click: `Array.from(document.querySelectorAll("button, a")).find((e) => (e.getAttribute("aria-label") || "").trim() === "Go back") || Array.from(document.querySelectorAll("button, a")).find((e) => (e.getAttribute("aria-label") || e.textContent || "").trim() === "Back")`,
    // The list is back, rather than the article being gone: waiting for a
    // removal measures the end of the slide, not the moment the person can
    // read what they asked for.
    settled: `() => Boolean(document.querySelector("[data-home-news] ol > li"))`,
  },
  {
    name: "switch channel",
    setUp: home,
    click: `document.querySelector('[data-home-news] nav button:not([aria-current="true"])')`,
    // The tab flips the moment it is clicked, so the tab alone measures
    // nothing. The channel's own page of news arriving is the answer a
    // person waits for.
    awaitsRequest: "/api/workspace/reading/home",
    settled: `() => {
      const current = document.querySelector('[data-home-news] nav button[aria-current="true"]');
      return Boolean(current) && current.textContent.trim() !== "For You" && Boolean(document.querySelector("[data-home-news] ol > li h3"));
    }`,
  },
  {
    name: "open a folder",
    setUp: home,
    click: `Array.from(document.querySelectorAll(".post-editor-folder-main")).find((e) => e.textContent.trim() === "Bookmarks")`,
    // Measured cold, which is the only time it is slow: the first folder
    // opened after a page load takes about 470ms, and every one after it
    // takes 25. Something is initialised once and shared by all of them.
    // Ruled out by measurement: JavaScript execution (the profile is idle
    // through the gap), the navigation animation (identical with reduced
    // motion), the view transition (identical with startViewTransition
    // removed before any module loads), page warm-up (identical after six
    // seconds of settling), the amount of content (identical with the news
    // list display:none, and identical for a folder of three items and one
    // of forty), text shaping caches, IndexedDB, fetch, requestIdleCallback
    // and scheduler.postTask. The content region goes blank at 40ms and the
    // folder arrives at 460ms, so the person watches an empty pane.
    //
    // Any h1 with the folder's name, not the document's first one. The
    // outgoing view keeps its own heading until it is removed at the end of
    // the navigation slide, so asking for the first h1 waited on that
    // removal and reported 334ms for something the person sees in 21ms.
    // The new view is on screen and sliding in long before the old one goes.
    settled: `() => Array.from(document.querySelectorAll("h1")).some((h) => h.textContent.trim() === "Bookmarks")`,
  },
];

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await context.newPage();
    await signIn(page);
    console.log(`\n  ${ORIGIN}, @${HANDLE}, ${RUNS} runs each, budget ${BUDGET_MS}ms\n`);
    console.log("  action                 median     p95    worst    cold   over");
    console.log("  --------------------  -------  ------  -------  ------  -----");
    let anyOver = false;
    for (const action of ACTIONS) {
      // The first run of an action in a fresh server pays for that route
      // being initialised, which happens once per process and not once per
      // click. It is reported on its own rather than folded into a tail that
      // would then describe something nobody experiences twice.
      await action.setUp(page);
      const first = await timeAction(page, action);
      const samples: number[] = [];
      let missing = 0;
      for (let run = 0; run < RUNS; run += 1) {
        await action.setUp(page);
        const took = await timeAction(page, action);
        if (took === null) missing += 1;
        else samples.push(took);
      }
      void first;
      if (samples.length === 0) {
        console.log(`  ${action.name.padEnd(20)}  ${"not measured".padStart(7)}   (no element matched, or it never settled)`);
        continue;
      }
      const median = percentile(samples, 50);
      const p95 = percentile(samples, 95);
      const worst = Math.max(...samples);
      const over = p95 > BUDGET_MS;
      if (over) anyOver = true;
      console.log(
        `  ${action.name.padEnd(20)}  ${median.toFixed(0).padStart(7)}  ${p95.toFixed(0).padStart(6)}  ${worst.toFixed(0).padStart(7)}  ${
          (first === null ? "-" : first.toFixed(0)).padStart(6)
        }  ${over ? "  YES" : "   no"}${missing ? `  (${missing} unmeasured)` : ""}`,
      );
    }
    console.log(
      anyOver
        ? `\n  Something is over ${BUDGET_MS}ms. Measure the round trips it makes with npm run perf:queries.\n`
        : `\n  Every action is inside ${BUDGET_MS}ms.\n`,
    );
    await context.close();
  } finally {
    await browser.close();
  }
  process.exit(0);
}

void main();
