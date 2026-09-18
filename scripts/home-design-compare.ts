// Measure the Home against the design it is a port of.
//
// DESIGN.md section 3 states proportions taken off Artifact News screenshots,
// and artifact-contract.test.ts holds them as numbers in the stylesheet. Both
// are one step removed from the thing that matters: what a browser actually
// paints. This captures the running Home at the reference's own device
// metrics (393pt at 3x, so the capture is directly comparable to an iPhone
// screenshot) and runs the same pixel scan over both, so every claim about
// the port is a measurement of two images rather than a reading of two
// stylesheets.
//
// It answers in ratios. The reference column is 358pt wide and a desktop
// column is not, so an absolute size ported across would be either tiny or
// enormous; what has to survive a port is the relationship between the sizes.
// Every number is a multiple of the article headline.
//
//   npm run home:design-compare
//   npx tsx scripts/home-design-compare.ts --handle showcase
//
// Needs a dev server started with AUTH_DEV_LOGIN=1 (the "dev-login" entry in
// .claude/launch.json) and the reference captures in
// ~/Downloads/ARTIFACT_VISUAL_REFERENCES_RECOVERED/screens.

import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import sharp from "sharp";

const argOf = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);
  return at > 0 ? process.argv[at + 1] : undefined;
};

const ORIGIN = argOf("--origin") ?? "http://localhost:3000";
const HANDLE = argOf("--handle") ?? "showcase";
const OUT = ".texttext/home-compare";
const REFERENCE_DIR =
  argOf("--references") ?? join(homedir(), "Downloads/ARTIFACT_VISUAL_REFERENCES_RECOVERED/screens");

/**
 * SF Pro's cap height is 0.7046 of its em, so a cap measured in pixels
 * recovers the size it was set at. This is the ruler DESIGN.md section 3 was
 * written with, applied here unchanged so both sides are measured by one.
 */
const CAP_RATIO = 0.7046;
const sizeFromCap = (cap: number) => cap / CAP_RATIO;

type Box = { x0: number; y0: number; x1: number; y1: number };
type Band = { top: number; bottom: number; height: number };

/** Contiguous rows of ink in a region, which for text is its lines. */
async function bands(file: string, box: Box, threshold = 60): Promise<Band[]> {
  const width = Math.max(1, box.x1 - box.x0);
  const height = Math.max(1, box.y1 - box.y0);
  const { data, info } = await sharp(file)
    .extract({ left: Math.max(0, box.x0), top: Math.max(0, box.y0), width, height })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const luminance = new Float64Array(info.width * info.height);
  const histogram = new Array(256).fill(0);
  for (let index = 0; index < info.width * info.height; index += 1) {
    const at = index * channels;
    const value = 0.2126 * data[at] + 0.7152 * data[at + 1] + 0.0722 * data[at + 2];
    luminance[index] = value;
    histogram[Math.round(value)] += 1;
  }
  let ground = 0;
  for (let value = 0; value < 256; value += 1) if (histogram[value] > histogram[ground]) ground = value;
  const rows: number[] = [];
  for (let y = 0; y < info.height; y += 1) {
    let count = 0;
    for (let x = 0; x < info.width; x += 1) {
      if (Math.abs(luminance[y * info.width + x] - ground) > threshold) count += 1;
    }
    if (count > 0) rows.push(y + box.y0);
  }
  if (rows.length === 0) return [];
  const out: Band[] = [];
  let start = rows[0];
  let previous = rows[0];
  for (const y of rows.slice(1)) {
    if (y - previous > 1) {
      out.push({ top: start, bottom: previous, height: previous - start + 1 });
      start = y;
    }
    previous = y;
  }
  out.push({ top: start, bottom: previous, height: previous - start + 1 });
  return out;
}

/** The dev-login provider, inert unless the server was started with AUTH_DEV_LOGIN=1. */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}/api/auth/csrf`, { waitUntil: "domcontentloaded" });
  const csrfToken = JSON.parse(await page.locator("body").first().innerText()).csrfToken as string;
  const answer = await page.request.post(`${ORIGIN}/api/auth/callback/dev-login`, {
    form: { csrfToken, email: `${HANDLE}@texttext.dev`, name: HANDLE, callbackUrl: "/" },
  });
  if (!answer.ok() && answer.status() !== 302) {
    throw new Error(`dev login refused (${answer.status()}). Start the server with AUTH_DEV_LOGIN=1.`);
  }
}

async function captureOurs(): Promise<{
  file: string;
  geometry: Record<string, Box> & { sizes: Record<string, number | null> };
}> {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, "home-393pt-3x.png");
  const browser = await chromium.launch();
  try {
    // The reference's own device, so one scan reads both images.
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 });
    const page = await context.newPage();
    await signIn(page);
    // Warm the route first. A development server compiles the workspace on
    // first request, and a capture taken during that measures a skeleton.
    process.stdout.write("  warming the route ...\n");
    await page.request.get(`${ORIGIN}/t/${HANDLE}`, { timeout: 180_000 });
    await page.goto(`${ORIGIN}/t/${HANDLE}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector("[data-home-news] ol > li", { timeout: 120_000 });
    process.stdout.write("  news rendered, settling ...\n");
    await page.waitForTimeout(2500);
    // Passed as source, not as a function: the TypeScript runner annotates
    // compiled functions with a helper that does not exist in the page, and a
    // closure sent across would reference it and throw.
    const geometry = (await page.evaluate(`(() => {
      const scroller = document.querySelector(".post-editor-content");
      const offset = scroller ? scroller.scrollTop - scroller.getBoundingClientRect().top : 0;
      // What the browser actually painted, in CSS pixels, which at this
      // viewport are the reference's points.
      const size = (element) => (element ? parseFloat(getComputedStyle(element).fontSize) : null);
      const of = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          x0: Math.round(rect.left * 3),
          y0: Math.round((rect.top + offset) * 3),
          x1: Math.round(rect.right * 3),
          y1: Math.round((rect.bottom + offset) * 3),
        };
      };
      // A compact row: publisher, headline, thumbnail. Not the lead item,
      // whose photograph changes the geometry.
      const rows = Array.from(document.querySelectorAll("[data-home-news] ol > li"));
      const row = rows.find((item) => item.querySelector("h3") && !item.querySelector("img[class*='leadImage']"));
      return {
        tab: of(document.querySelector('[data-home-news] nav button[aria-current="true"]')),
        section: of(document.querySelector('[data-home-news] [class*="sectionTitle"]')),
        headline: of(row ? row.querySelector("h3") : null),
        publisher: of(row ? row.querySelector("p strong") : null),
        meta: of(row ? row.querySelector('[class*="sources"]') : null),
        thumb: of(row ? row.querySelector('[class*="thumb"]') : null),
        row: of(row || null),
        column: of(document.querySelector("[data-home-news]")),
        sizes: {
          tab: size(document.querySelector('[data-home-news] nav button[aria-current="true"]')),
          section: size(document.querySelector('[data-home-news] [class*="sectionTitle"]')),
          headline: size(row ? row.querySelector("h3") : null),
          publisher: size(row ? row.querySelector("p strong") : null),
          meta: size(row ? row.querySelector('[class*="sources"]') : null),
        },
      };
    })()`)) as Record<string, Box | null> & { sizes: Record<string, number | null> };
    const tallest = Math.max(
      1200,
      ...Object.entries(geometry)
        .filter(([name, box]) => name !== "sizes" && box && typeof (box as Box).y1 === "number")
        .map(([, box]) => Math.ceil((box as Box).y1 / 3) + 40),
    );
    // A clip, not the whole page: the Home is hundreds of rows tall at 3x and
    // everything measured here is in the first screen or two.
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 393, height: tallest } });
    await context.close();
    return {
      file,
      geometry: geometry as unknown as Record<string, Box> & { sizes: Record<string, number | null> },
    };
  } finally {
    await browser.close();
  }
}

type Reading = { cap: number; size: number };

/** The tallest line of ink in an element's box, which is its cap height. */
async function read(file: string, box: Box): Promise<Reading | null> {
  const found = await bands(file, { x0: box.x0, y0: Math.max(0, box.y0 - 6), x1: box.x1, y1: box.y1 + 6 });
  const line = found.sort((left, right) => right.height - left.height)[0];
  return line ? { cap: line.height, size: sizeFromCap(line.height) } : null;
}

/**
 * The reference readings, each naming the capture and the band it comes from,
 * so a number here is rechecked by rerunning the scan rather than trusted.
 */
const REFERENCE: Array<{ name: string; file: string; box: Box; note: string }> = [
  { name: "tab", file: "gg-02-foryou-light-first-open.png", box: { x0: 40, y0: 200, x1: 240, y1: 280 }, note: '"For You", the chosen tab' },
  { name: "headline", file: "gg-02-foryou-light-first-open.png", box: { x0: 40, y0: 575, x1: 880, y1: 640 }, note: "the last line of a three line headline" },
  { name: "publisher", file: "gg-02-foryou-light-first-open.png", box: { x0: 115, y0: 370, x1: 215, y1: 425 }, note: '"VICE", all caps' },
  { name: "meta", file: "gg-02-foryou-light-first-open.png", box: { x0: 40, y0: 655, x1: 330, y1: 705 }, note: '"43 reads"' },
  { name: "section", file: "gg-07-topic-feed.png", box: { x0: 40, y0: 500, x1: 430, y1: 590 }, note: '"Headlines"' },
];

/** The reference's own geometry, measured once and recorded with its source. */
const REFERENCE_GEOMETRY = {
  columnPt: 358,
  thumbPt: 68,
  rowPaddingPt: 16.5,
  note: "gg-02: gutter 45..1130px at 3x, thumbnail 204px square, 16.3pt above the mark and 17pt below the metadata",
};

async function main() {
  if (!existsSync(REFERENCE_DIR)) {
    console.error(`No reference captures at ${REFERENCE_DIR}. Pass --references <dir>.`);
    process.exit(2);
  }
  console.log(`Capturing ${ORIGIN}/t/${HANDLE} at 393pt, 3x ...`);
  const { file, geometry } = await captureOurs();

  const reference: Record<string, Reading> = {};
  for (const entry of REFERENCE) {
    const path = join(REFERENCE_DIR, entry.file);
    if (!existsSync(path)) continue;
    const reading = await read(path, entry.box);
    if (reading) reference[entry.name] = reading;
  }
  // The reference is scanned because there is no DOM behind it. Ours is read
  // from the DOM because there is, and a scan of a line with a descender
  // over-reads its cap height by a quarter, which is a bias only one side
  // would carry.
  const ours: Record<string, Reading> = {};
  for (const [name, painted] of Object.entries(geometry.sizes ?? {})) {
    if (typeof painted === "number" && painted > 0) ours[name] = { cap: painted * CAP_RATIO, size: painted };
  }

  const ratio = (set: Record<string, Reading>, name: string) =>
    set[name] && set.headline ? set[name].size / set.headline.size : null;

  console.log("\nEvery size as a multiple of the article headline, which is what a port has to keep.\n");
  console.log("  role        reference (scanned)   ours (as painted)     ref    ours   drift");
  console.log("  ----------  --------------------  --------------------  -----  -----  -----");
  let worst = { name: "", drift: 0 };
  for (const name of ["tab", "headline", "publisher", "meta", "section"]) {
    const left = reference[name];
    const right = ours[name];
    if (!left || !right) {
      console.log(`  ${name.padEnd(10)}  ${(left ? "read" : "not read").padEnd(20)}  ${right ? "read" : "not read"}`);
      continue;
    }
    const a = ratio(reference, name)!;
    const b = ratio(ours, name)!;
    const drift = b - a;
    if (Math.abs(drift) > Math.abs(worst.drift)) worst = { name, drift };
    console.log(
      `  ${name.padEnd(10)}  cap ${String(Math.round(left.cap)).padStart(3)}px = ${(left.size / 3).toFixed(1).padStart(4)}pt   ` +
        `${right.size.toFixed(1).padStart(15)}pt   ` +
        `${a.toFixed(2)}  ${b.toFixed(2)}  ${(drift >= 0 ? "+" : "") + drift.toFixed(2)}`,
    );
  }

  if (geometry.thumb && geometry.row && geometry.column && geometry.headline) {
    const columnPx = geometry.column.x1 - geometry.column.x0;
    const thumbPx = geometry.thumb.x1 - geometry.thumb.x0;
    const refThumbShare = REFERENCE_GEOMETRY.thumbPt / REFERENCE_GEOMETRY.columnPt;
    console.log("\n  thumbnail   reference %s of the column (%spt on %spt)", refThumbShare.toFixed(2), REFERENCE_GEOMETRY.thumbPt, REFERENCE_GEOMETRY.columnPt);
    console.log(`              ours      ${(thumbPx / columnPx).toFixed(2)} of the column (${(thumbPx / 3).toFixed(0)}pt on ${(columnPx / 3).toFixed(0)}pt)`);
    const thumbMid = (geometry.thumb.y0 + geometry.thumb.y1) / 2;
    const rowMid = (geometry.row.y0 + geometry.row.y1) / 2;
    console.log(
      `              centred against the text: off by ${Math.abs(thumbMid - rowMid).toFixed(0)}px of a ${(geometry.row.y1 - geometry.row.y0).toFixed(0)}px row`,
    );
  }

  console.log(`\n  reference geometry: ${REFERENCE_GEOMETRY.note}`);
  console.log(`  capture: ${file}`);
  if (worst.name) console.log(`  largest drift: ${worst.name} at ${worst.drift.toFixed(2)} of a headline\n`);
  process.exit(0);
}

void main();
