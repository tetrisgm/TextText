/**
 * CPU profile of the editor's per-keystroke work in Chromium, via CDP.
 * Prints the hottest functions by self time during a typing burst.
 *
 * Usage: server on :3131 with dev sign-in, then
 *   node --import tsx scripts/bench-editor-profile.ts [handle] [slug]
 */
import { chromium } from "playwright";

const HANDLE = process.argv[2] ?? "visual-demo";
const SLUG = process.argv[3] ?? "perf-1mb";
const ORIGIN = "http://localhost:3131";
const OWNER_EMAIL = "visual-demo@texttext.local";

type ProfileNode = {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
  };
  hitCount?: number;
  children?: number[];
};

async function run(): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${ORIGIN}/editor`, { waitUntil: "networkidle" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor({ timeout: 20000 });
  await form.locator("input[type=email]").fill(OWNER_EMAIL);
  await form.locator("button[type=submit]").click();
  await page.waitForTimeout(1500);
  await page.goto(`${ORIGIN}/@${HANDLE}/${SLUG}`);
  const surface = page.locator(".tt-document-editor .tt-md-surface").first();
  await surface.waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  await surface.click({ position: { x: 200, y: 100 } });

  const cdp = await context.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
  await page.keyboard.type(
    "The quick brown fox jumps over the lazy dog 0123456789",
    { delay: 40 },
  );
  await page.waitForTimeout(300);
  const { profile } = (await cdp.send("Profiler.stop")) as {
    profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] };
  };

  // Self time per node from samples/timeDeltas.
  const selfMicros = new Map<number, number>();
  for (let i = 0; i < profile.samples.length; i += 1) {
    const id = profile.samples[i];
    selfMicros.set(id, (selfMicros.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0));
  }
  const byFunction = new Map<string, number>();
  for (const node of profile.nodes) {
    const micros = selfMicros.get(node.id) ?? 0;
    if (micros === 0) continue;
    const frame = node.callFrame;
    const file = frame.url.split("/").pop() || "(anon)";
    const key = `${frame.functionName || "(anonymous)"} @ ${file}:${frame.lineNumber}`;
    byFunction.set(key, (byFunction.get(key) ?? 0) + micros);
  }
  const total = [...byFunction.values()].reduce((a, b) => a + b, 0);
  const top = [...byFunction.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);
  console.log(`total sampled ${(total / 1000).toFixed(0)}ms over burst\n`);
  for (const [key, micros] of top) {
    console.log(
      `${(micros / 1000).toFixed(1).padStart(8)}ms  ${((micros / total) * 100).toFixed(1).padStart(5)}%  ${key}`,
    );
  }
  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
