/**
 * Bounded file-vault UI and process benchmark against the already running local
 * production Next server. The fixture lives in a new UUID workspace and is
 * removed in finally; no existing workspace or account is modified.
 *
 *   node --env-file=.env.local --import tsx scripts/bench-file-vault-live.ts --preflight
 *   node --env-file=.env.local --import tsx scripts/bench-file-vault-live.ts
 *
 * Set TEXTTEXT_VAULT_ROOT to the running server's vault root if it is not the
 * repo default. Raw, bounded evidence is written under /tmp/texttext-vault-perf-*.
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { eq, inArray } from "drizzle-orm";
import { buildTextpack } from "../src/lib/github/textpack";
import { emptyDocumentSnapshot } from "../src/lib/documents/model";

const ORIGIN = process.env.TEXTTEXT_BENCH_ORIGIN ?? "http://localhost:3000";
const ROOT = path.resolve(process.env.TEXTTEXT_VAULT_ROOT ?? ".texttext/vault-server");
const EMAILS = ["ada.live-collab@example.test", "grace.live-collab@example.test"] as const;
const ITEM_COUNT = 240;
const ROUNDS = 3;
const MAX_WALL_MS = 15 * 60_000;
const MAX_PACK_BYTES = 100 * 1024 * 1024;
const MAX_TREE_RSS_KIB = 2 * 1024 * 1024;
const MAX_HARNESS_RSS_KIB = 1536 * 1024;
const SAMPLE_LIMIT = 900;
const LONG_BODY = ("One careful paragraph about a file library, its notes, reading, and images.\n").repeat(7300);
const TYPE_BURST = "Measured visible input in the long note. ";

type Item = { id: string; title: string; relativePath: string; kind: string };
type ProcessRow = { pid: number; ppid: number; cpu: number; rssKiB: number; command: string };
type Sample = { atMs: number; phase: string; serverRssKiB: number; browserRssKiB: number; harnessRssKiB: number; serverCpuPercent: number; browserCpuPercent: number };
type Result = {
  runId: string; status: "passed" | "failed"; error?: string; origin: string; vaultRoot: string;
  sourceCommit: string; buildIdentity: string | null; hardware: string; ramGiB: number; os: string;
  serverListenerPid: number; serverTreeRootPid: number; fixture: { workspaceId: string; count: number; kinds: Record<string, number>; packBytes: number; directoryBytes: number; collaborators: number; memberVerified: boolean; agentMutations: number; agentVisibleMutations: number };
  conditions: string[]; coldVisibleMs: number[]; warmVisibleMs: number[];
  folderNavMs: number[]; itemNavMs: number[]; inputToVisibleMs: number[];
  commandK: "available" | "unavailable" | "unverified"; commandKMs: number[];
  galleryImages: number[]; afterCloseBrowserRssKiB: number[];
  idleCpu: { serverMeanPercent: number; browserMeanPercent: number; samples: number };
  idleNetwork: { durationMs: number; total: number; mutating: number; longPolls: number; methods: Record<string, number> };
  samples: Sample[]; blockedExternalRequests: number; cleanup: string[];
};

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function isLoopback(url: string): boolean {
  try { return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname); }
  catch { return false; }
}
function command(file: string, args: string[]): string {
  return execFileSync(file, args, { encoding: "utf8", timeout: 5000, maxBuffer: 1_000_000 }).trim();
}
function rows(): ProcessRow[] {
  return command("ps", ["-axo", "pid=,ppid=,%cpu=,rss=,comm="]).split("\n").flatMap(line => {
    const matched = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
    return matched ? [{ pid: Number(matched[1]), ppid: Number(matched[2]), cpu: Number(matched[3]), rssKiB: Number(matched[4]), command: matched[5] }] : [];
  });
}
function tree(all: ProcessRow[], rootPid: number, includeRoot = true): ProcessRow[] {
  const members = new Set([rootPid]);
  for (let pass = 0; pass < 10; pass++) {
    let added = false;
    for (const row of all) if (members.has(row.ppid) && !members.has(row.pid)) { members.add(row.pid); added = true; }
    if (!added) break;
  }
  return all.filter(row => members.has(row.pid) && (includeRoot || row.pid !== rootPid));
}
function totals(all: ProcessRow[], rootPid: number, includeRoot = true) {
  const members = tree(all, rootPid, includeRoot);
  return { rssKiB: members.reduce((sum, row) => sum + row.rssKiB, 0), cpu: members.reduce((sum, row) => sum + row.cpu, 0) };
}
function quantile(numbers: number[], fraction: number): number | null {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.ceil((sorted.length - 1) * fraction)];
}
function summary(numbers: number[]) { return { n: numbers.length, p50: quantile(numbers, .5), p95: quantile(numbers, .95), max: numbers.length ? Math.max(...numbers) : null }; }
async function sleep(ms: number) { await new Promise(resolve => setTimeout(resolve, ms)); }
function throwIfExpired(start: number) { if (performance.now() - start > MAX_WALL_MS) throw new Error("Benchmark exceeded its 15-minute wall-clock limit"); }
function percent(samples: Sample[], key: "serverCpuPercent" | "browserCpuPercent") {
  return samples.length ? samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length : 0;
}
async function directoryBytes(root: string): Promise<number> {
  let bytes = 0;
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) bytes += await directoryBytes(target);
    else if (entry.isFile()) bytes += (await fs.stat(target)).size;
  }
  return bytes;
}
async function buildImages(): Promise<Uint8Array[]> {
  const colors = ["#2375aa", "#9c4d69", "#bb8129", "#4b8066", "#514f9a", "#a84e39", "#3c8398", "#927a48"];
  const images: Uint8Array[] = [];
  for (const color of colors) images.push(await sharp({ create: { width: 800, height: 450, channels: 3, background: color } }).png().toBuffer());
  return images;
}
function itemSpec(index: number): { folder: string; title: string; kind: string; template: string; body: string; image: number | null } {
  const nth = (offset: number) => String(index - offset + 1).padStart(3, "0");
  if (index < 72) return { folder: "Gallery", title: `Gallery ${nth(0)}`, kind: "gallery", template: "gallery", body: `A visual study ${nth(0)} with an embedded local image.`, image: index % 8 };
  if (index < 104) return { folder: "Reading", title: `Article ${nth(72)}`, kind: "article", template: "article", body: "A saved reading item with a few paragraphs.\n".repeat(10), image: null };
  if (index < 136) return { folder: "Reading", title: `Bookmark ${nth(104)}`, kind: "bookmark", template: "bookmark", body: "A saved link with a short personal note.", image: null };
  if (index === 136) return { folder: "Notes", title: "Long note", kind: "long note", template: "note", body: LONG_BODY, image: null };
  if (index === 137) return { folder: "Notes", title: "Agent activity", kind: "agent note", template: "note", body: "The agent-like mutation target.", image: null };
  if (index < 185) return { folder: "Notes", title: `Note ${nth(138)}`, kind: "note", template: "note", body: "An ordinary note with specific details.\n".repeat(5), image: null };
  if (index < 217) return { folder: "Projects", title: `Project ${nth(185)}`, kind: "project", template: "project", body: "Project plan, milestones, and a small checklist.\n".repeat(6), image: null };
  return { folder: "Journal", title: `Journal ${nth(217)}`, kind: "journal", template: "journal", body: "A daily record of reading and writing.\n".repeat(4), image: null };
}
function pack(item: Item, index: number, images: Uint8Array[]): Uint8Array {
  const spec = itemSpec(index);
  const document = emptyDocumentSnapshot({ id: `texttext.${spec.template}`, version: 1 });
  document.content.title = spec.title;
  document.content.body = spec.body;
  document.content.tags = ["benchmark", spec.kind];
  if (spec.kind === "bookmark") document.content.fields.sourceUrl = `https://example.test/reading/${index}`;
  if (spec.image !== null) {
    document.content.fields.cover = "assets/cover.png";
    document.content.assets = [{ id: "cover", kind: "image", src: "assets/cover.png", alt: spec.title, width: 800, height: 450, contentType: "image/png" }];
  }
  return buildTextpack(spec.title, {
    document,
    markdown: `---\ntextTextId: ${JSON.stringify(item.id)}\n---\n\n${spec.body}`,
    ...(spec.image !== null ? { files: { "assets/cover.png": images[spec.image] } } : {}),
  });
}
async function openVisible(page: Page): Promise<number> {
  await page.waitForFunction(() => Number.isFinite((window as unknown as { __ttBenchFirstVisible?: number }).__ttBenchFirstVisible), null, { timeout: 25_000 });
  return page.evaluate(() => (window as unknown as { __ttBenchFirstVisible: number }).__ttBenchFirstVisible);
}
async function armClick(page: Page, selector: string, text: string, contains: boolean): Promise<void> {
  await page.evaluate(({ selector, text, contains }) => {
    const state = window as unknown as { __ttBenchClick?: Promise<number> };
    state.__ttBenchClick = new Promise<number>(resolve => {
      let started = -1, settled = false;
      let observer: MutationObserver | null = null;
      const finish = (value: number) => { if (settled) return; settled = true; observer?.disconnect(); clearTimeout(timeout); resolve(value); };
      const check = () => {
        if (started < 0 || settled) return;
        const target = document.querySelector(selector) as HTMLElement | null;
        if (!target || !(contains ? target.textContent?.includes(text) : target.textContent?.trim() === text) || !target.getClientRects().length) return;
        requestAnimationFrame(() => requestAnimationFrame(() => finish(performance.now() - started)));
      };
      const timeout = setTimeout(() => finish(Number.NaN), 15_000);
      document.addEventListener("pointerdown", event => {
        started = event.timeStamp;
        observer = new MutationObserver(check);
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        check();
      }, { capture: true, once: true });
    });
  }, { selector, text, contains });
}
async function measuredClick(page: Page, locator: ReturnType<Page["locator"]>, selector: string, text: string, contains = false): Promise<number> {
  await armClick(page, selector, text, contains);
  await locator.click({ timeout: 15_000 });
  const elapsed = await page.evaluate(() => (window as unknown as { __ttBenchClick: Promise<number> }).__ttBenchClick);
  check(Number.isFinite(elapsed), `Visible target did not appear after click: ${text}`);
  return elapsed;
}
async function typeAndMeasure(page: Page): Promise<number[]> {
  const field = page.getByRole("textbox", { name: "Document body", exact: true });
  await field.waitFor({ timeout: 15_000 });
  await field.focus();
  await page.keyboard.press("Meta+ArrowDown");
  await page.evaluate(() => {
    const state = window as unknown as { __ttBenchInput: number[] };
    state.__ttBenchInput = [];
    document.addEventListener("input", event => {
      if (!(event.target as HTMLElement | null)?.classList.contains("tt-md-surface")) return;
      const at = event.timeStamp;
      requestAnimationFrame(() => requestAnimationFrame(() => state.__ttBenchInput.push(performance.now() - at)));
    }, { capture: true });
  });
  await page.keyboard.type(TYPE_BURST, { delay: 40 });
  await page.waitForTimeout(150);
  const values = await page.evaluate(() => (window as unknown as { __ttBenchInput: number[] }).__ttBenchInput);
  check(values.length === TYPE_BURST.length, `Input events missing: ${values.length}/${TYPE_BURST.length}`);
  return values;
}

const firstVisibleInit = `globalThis.__name = (fn) => fn;
(() => {
  let finished = false;
  const observer = new MutationObserver(() => {
    if (finished || !document.querySelector('.vault-overview h2')) return;
    finished = true; observer.disconnect();
    requestAnimationFrame(() => requestAnimationFrame(() => { globalThis.__ttBenchFirstVisible = performance.now(); }));
  });
  observer.observe(document, { childList: true, subtree: true });
})();`;

async function main() {
  const started = performance.now();
  check(isLoopback(ORIGIN), "Only a loopback server may be benchmarked");
  const databaseUrl = process.env.DATABASE_URL;
  check(databaseUrl && isLoopback(databaseUrl), "Only local Postgres may be used");
  check(path.basename(ROOT) !== "/" && ROOT.startsWith(process.cwd() + path.sep), "Vault root must be inside this checkout");
  const physicalRoot = await fs.realpath(ROOT);
  const physicalCheckout = await fs.realpath(process.cwd());
  check(physicalRoot.startsWith(physicalCheckout + path.sep), "Vault root resolves outside this checkout");
  const host = new URL(ORIGIN).hostname;
  check(host === "localhost" || host === "127.0.0.1", "Use localhost or 127.0.0.1 for the server origin");
  const response = await fetch(ORIGIN, { signal: AbortSignal.timeout(5000) });
  check(response.ok, `Local server returned ${response.status}`);
  await response.body?.cancel();
  const buildIdentity = /dpl=([^>;\s]+)/.exec(response.headers.get("link") ?? "")?.[1] ?? null;
  const listenerPids = command("lsof", ["-nP", `-tiTCP:${new URL(ORIGIN).port || "80"}`, "-sTCP:LISTEN"]).split("\n").map(Number).filter(Number.isFinite);
  check(listenerPids.length === 1, `Expected one local server listener, got ${listenerPids.length}`);
  const listenerPid = listenerPids[0];
  const initialRows = rows();
  const listener = initialRows.find(row => row.pid === listenerPid);
  check(listener && listener.command.includes("next-server"), "The listener must be a production Next server");
  const parent = initialRows.find(row => row.pid === listener.ppid);
  const serverRootPid = parent?.command.includes("npm run start") ? parent.pid : listenerPid;
  const hw = command("sysctl", ["-n", "hw.model", "hw.memsize", "machdep.cpu.brand_string"]).split("\n");
  const osVersion = `${command("sw_vers", ["-productVersion"])} (${command("sw_vers", ["-buildVersion"])})`;
  const machine = JSON.parse(command("system_profiler", ["SPHardwareDataType", "-json"])) as { SPHardwareDataType?: Array<{ machine_name?: string }> };
  const machineName = machine.SPHardwareDataType?.[0]?.machine_name ?? "Mac";
  const sourceCommit = command("git", ["rev-parse", "--short", "HEAD"]);
  const dbModule = await import("../src/lib/db/client");
  const schema = await import("../src/lib/db/schema");
  check(dbModule.db, "Local Postgres is required");
  const accounts = await dbModule.db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(inArray(schema.users.email, EMAILS));
  check(EMAILS.every(email => accounts.some(row => row.email === email)), "Existing Ada and Grace test accounts are required");
  const owned = await dbModule.db.select({ ownerId: schema.blogs.ownerId }).from(schema.blogs).where(inArray(schema.blogs.ownerId, accounts.map(row => row.id)));
  check(accounts.every(account => owned.some(blog => blog.ownerId === account.id)), "Both existing test accounts need their established workspace before dev sign-in");
  console.log(`PRECHECK ${machineName} ${hw[0]} / ${hw[2]}, ${(Number(hw[1]) / 2 ** 30).toFixed(0)} GiB; macOS ${osVersion}; Next ${buildIdentity ?? "unknown"}; local DB and 2 accounts available`);
  if (process.argv.includes("--preflight")) { await dbModule.closeDatabaseConnections(); return; }

  const store = await import("../src/lib/store");
  const browserRunId = randomUUID();
  const workspaceId = randomUUID();
  const workspaceDirectory = path.join(ROOT, workspaceId);
  const markerPath = path.join(workspaceDirectory, ".texttext", "benchmark-owner.json");
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-vault-perf-"));
  const result: Result = {
    runId: browserRunId, status: "failed", origin: ORIGIN, vaultRoot: ROOT,
    sourceCommit, buildIdentity, hardware: `${machineName} ${hw[0]} / ${hw[2]}`, ramGiB: Number(hw[1]) / 2 ** 30, os: osVersion,
    serverListenerPid: listenerPid, serverTreeRootPid: serverRootPid,
    fixture: { workspaceId, count: 0, kinds: {}, packBytes: 0, directoryBytes: 0, collaborators: 0, memberVerified: false, agentMutations: 0, agentVisibleMutations: 0 },
    conditions: ["Local production Next server already running and warm", "First Chromium context with a cold browser cache", "Rounds 2-3 reused the browser and context cache", "Chromium headless; process RSS is summed resident size, which can double-count shared pages", "Direct audited TextPack writes are synthetic agent-like activity, not a provider run"],
    coldVisibleMs: [], warmVisibleMs: [], folderNavMs: [], itemNavMs: [], inputToVisibleMs: [],
    commandK: "unverified", commandKMs: [], galleryImages: [], afterCloseBrowserRssKiB: [],
    idleCpu: { serverMeanPercent: 0, browserMeanPercent: 0, samples: 0 },
    idleNetwork: { durationMs: 0, total: 0, mutating: 0, longPolls: 0, methods: {} },
    samples: [], blockedExternalRequests: 0, cleanup: [],
  };
  const owner = accounts.find(row => row.email === EMAILS[0])!;
  const member = accounts.find(row => row.email === EMAILS[1])!;
  const grantIds = [randomUUID(), randomUUID()];
  const items: Item[] = [];
  let directoryOwned = false, workspaceCreated = false;
  let browser: Browser | null = null, context: BrowserContext | null = null;
  let monitor: ReturnType<typeof setInterval> | null = null;
  let monitorFailure: string | null = null;
  let phase = "setup";
  const monitorNow = () => {
    const all = rows();
    const server = totals(all, serverRootPid);
    const browserTotals = totals(all, process.pid, false);
    const harnessRssKiB = Math.round(process.memoryUsage().rss / 1024);
    const sample: Sample = { atMs: Math.round(performance.now() - started), phase,
      serverRssKiB: server.rssKiB, browserRssKiB: browserTotals.rssKiB, harnessRssKiB,
      serverCpuPercent: server.cpu, browserCpuPercent: browserTotals.cpu };
    result.samples.push(sample);
    if (result.samples.length > SAMPLE_LIMIT) monitorFailure = "Sample limit reached";
    if (server.rssKiB > MAX_TREE_RSS_KIB || browserTotals.rssKiB > MAX_TREE_RSS_KIB || harnessRssKiB > MAX_HARNESS_RSS_KIB) {
      monitorFailure = `RSS limit exceeded: server ${server.rssKiB} KiB, browser ${browserTotals.rssKiB} KiB, harness ${harnessRssKiB} KiB`;
    }
    if (performance.now() - started > MAX_WALL_MS) monitorFailure = "Wall-clock limit reached";
    return sample;
  };
  const guard = () => { if (monitorFailure) throw new Error(monitorFailure); throwIfExpired(started); };
  const writeResult = async () => {
    const output = { ...result, metrics: { coldVisible: summary(result.coldVisibleMs), warmVisible: summary(result.warmVisibleMs), folderNavigation: summary(result.folderNavMs), itemNavigation: summary(result.itemNavMs), inputToVisible: summary(result.inputToVisibleMs), commandK: summary(result.commandKMs), serverPeakRssMiB: Math.max(0, ...result.samples.map(sample => sample.serverRssKiB)) / 1024,
      browserPeakRssMiB: Math.max(0, ...result.samples.map(sample => sample.browserRssKiB)) / 1024 } };
    await fs.writeFile(path.join(outputDir, "result.json"), JSON.stringify(output, null, 2));
    console.log(`EVIDENCE ${path.join(outputDir, "result.json")}`);
    console.log(`SUMMARY ${JSON.stringify(output.metrics)}`);
  };
  try {
    await fs.access(workspaceDirectory).then(() => { throw new Error("Disposable workspace directory already exists"); }, error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
    await fs.mkdir(path.dirname(markerPath), { recursive: true }); directoryOwned = true;
    await fs.writeFile(markerPath, JSON.stringify({ workspaceId, runId: browserRunId }), { flag: "wx" });
    await dbModule.db.insert(schema.blogs).values({ id: workspaceId, handle: `vault-perf-${workspaceId}`, name: `Vault performance ${workspaceId.slice(0, 8)}`, ownerId: null });
    workspaceCreated = true;
    await dbModule.db.insert(schema.collaborators).values([
      { id: grantIds[0], scopeType: "workspace", scopeId: workspaceId, userId: owner.id, invitedById: owner.id, role: "admin" },
      { id: grantIds[1], scopeType: "workspace", scopeId: workspaceId, userId: member.id, invitedById: owner.id, role: "member" },
    ]);
    result.fixture.collaborators = 2;
    const images = await buildImages();
    monitorNow();
    monitor = setInterval(() => { if (!monitorFailure) try { monitorNow(); } catch (error) { monitorFailure = error instanceof Error ? error.message : String(error); } }, 1000);
    phase = "seed";
    for (let index = 0; index < ITEM_COUNT; index++) {
      guard();
      const spec = itemSpec(index), id = randomUUID();
      const item: Item = { id, title: spec.title, relativePath: `${spec.folder}/${spec.title}.textpack`, kind: spec.kind };
      const bytes = pack(item, index, images);
      result.fixture.packBytes += bytes.byteLength;
      check(result.fixture.packBytes <= MAX_PACK_BYTES, "Fixture pack-byte limit exceeded");
      const write = await store.writeVaultTextpack({ root: ROOT, workspaceId, itemId: id, relativePath: item.relativePath,
        operationId: randomUUID(), baseRevision: null, bytes, actorUserId: owner.id, actorType: "human" });
      check(write.status === "written", `Could not seed ${item.relativePath}`);
      items.push(item); result.fixture.count++; result.fixture.kinds[item.kind] = (result.fixture.kinds[item.kind] ?? 0) + 1;
      if ((index + 1) % 40 === 0) console.log(`SEED ${index + 1}/${ITEM_COUNT}`);
    }
    result.fixture.directoryBytes = await directoryBytes(workspaceDirectory);
    check(result.fixture.directoryBytes <= 150 * 1024 * 1024, "Fixture directory exceeded 150 MiB");
    console.log(`FIXTURE ${workspaceId}: ${items.length} packs, ${(result.fixture.directoryBytes / 2 ** 20).toFixed(1)} MiB on disk`);

    phase = "browser idle";
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
    const requests: Array<{ at: number; method: string; path: string }> = [];
    context.on("request", request => {
      if (request.url().startsWith(ORIGIN) && requests.length < 2000) requests.push({ at: performance.now(), method: request.method(), path: new URL(request.url()).pathname });
      else if (requests.length >= 2000) monitorFailure = "Browser request log exceeded 2,000 entries";
    });
    await context.route("**/*", route => {
      const requested = new URL(route.request().url());
      if (requested.origin !== new URL(ORIGIN).origin) { result.blockedExternalRequests++; void route.abort(); }
      else void route.continue();
    });
    const csrf = await (await context.request.get(`${ORIGIN}/api/auth/csrf`)).json() as { csrfToken: string };
    const login = await context.request.post(`${ORIGIN}/api/auth/callback/dev-login`, { form: { csrfToken: csrf.csrfToken, email: EMAILS[0], callbackUrl: `${ORIGIN}/vault/${workspaceId}` } });
    check(login.ok(), `Existing test-account sign-in returned ${login.status()}`);
    const manifest = await context.request.get(`${ORIGIN}/api/vault/${workspaceId}/items`);
    check(manifest.ok() && ((await manifest.json()) as { items: unknown[] }).items.length === ITEM_COUNT, "Running server does not see the disposable fixture at the configured vault root");
    const idleStart = result.samples.length;
    await sleep(5000);
    const idleSamples = result.samples.slice(idleStart);
    result.idleCpu = { serverMeanPercent: percent(idleSamples, "serverCpuPercent"), browserMeanPercent: percent(idleSamples, "browserCpuPercent"), samples: idleSamples.length };

    for (let round = 0; round < ROUNDS; round++) {
      guard(); phase = round === 0 ? "cold browser open" : `warm browser open ${round + 1}`;
      const page = await context.newPage();
      await page.addInitScript({ content: firstVisibleInit });
      await page.goto(`${ORIGIN}/vault/${workspaceId}`, { waitUntil: "domcontentloaded", timeout: 25_000 });
      const visible = await openVisible(page);
      (round === 0 ? result.coldVisibleMs : result.warmVisibleMs).push(visible);
      const folder = (name: string) => page.locator('nav[aria-label="Workspace files"] summary', { hasText: name }).first();
      const item = (title: string) => page.locator(`nav[aria-label="Workspace files"] button[aria-label="${title}"]`);
      const allFiles = () => page.getByRole("button", { name: "All files", exact: true });
      result.folderNavMs.push(await measuredClick(page, folder("Gallery"), ".vault-overview h2", "Gallery"));
      await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".vault-document-grid img")].filter(image => image.complete && image.naturalWidth > 0).length >= 1, null, { timeout: 20_000 });
      result.galleryImages.push(await page.locator(".vault-document-grid img").count());
      result.itemNavMs.push(await measuredClick(page, item("Gallery 001"), ".tt-md-surface", "A visual study 001", true));
      result.folderNavMs.push(await measuredClick(page, allFiles(), ".vault-overview h2", "Your workspace"));
      result.folderNavMs.push(await measuredClick(page, folder("Notes"), ".vault-overview h2", "Notes"));
      result.itemNavMs.push(await measuredClick(page, item("Long note"), ".tt-md-surface", "One careful paragraph about a file library", true));
      result.inputToVisibleMs.push(...await typeAndMeasure(page));
      if (round === 0) {
        // Save/transport has three seconds to settle. Count all requests over
        // the following ten idle seconds while the note remains open.
        await sleep(3000);
        const idleAt = performance.now();
        await sleep(10_000);
        const idleRequests = requests.filter(request => request.at >= idleAt && request.at < idleAt + 10_000);
        result.idleNetwork = { durationMs: 10_000, total: idleRequests.length,
          mutating: idleRequests.filter(request => !["GET", "HEAD", "OPTIONS"].includes(request.method)).length,
          longPolls: idleRequests.filter(request => request.path === `/api/vault/${workspaceId}/items`).length,
          methods: Object.fromEntries([...new Set(idleRequests.map(request => request.method))].map(method =>
            [method, idleRequests.filter(request => request.method === method).length])),
        };
        await page.keyboard.press("Meta+k");
        await page.waitForTimeout(400);
        result.commandK = await page.locator('[role="dialog"] input[placeholder*="Search"], .vault-search input').count() ? "available" : "unavailable";
        if (result.commandK === "available") await page.keyboard.press("Escape");
      }
      await page.close();
      await sleep(2500);
      result.afterCloseBrowserRssKiB.push(monitorNow().browserRssKiB);
      console.log(`ROUND ${round + 1}: visible ${visible.toFixed(1)} ms, browser after-close ${(result.afterCloseBrowserRssKiB.at(-1)! / 1024).toFixed(1)} MiB`);
    }
    // Keep one visible reader mounted while a store-level external-agent actor
    // makes synthetic agent-like writes every five seconds. This is not a real
    // provider operation. It is separate from cold and warm navigation rows.
    phase = "active agent-like mutation";
    const activePage = await context.newPage();
    await activePage.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
    await activePage.goto(`${ORIGIN}/vault/${workspaceId}`, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await activePage.locator(".vault-overview h2").waitFor({ timeout: 20_000 });
    await activePage.locator('nav[aria-label="Workspace files"] button[aria-label="Agent activity"]').click();
    const activeBody = activePage.getByRole("textbox", { name: "Document body", exact: true });
    await activeBody.waitFor({ timeout: 20_000 });
    const target = items.find(value => value.title === "Agent activity")!;
    for (let n = 1; n <= 6; n++) {
      guard();
      const current = await store.readVaultTextpack({ root: ROOT, workspaceId, itemId: target.id });
      check(current, "Agent mutation target disappeared");
      const nextDocument = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
      nextDocument.content.title = target.title;
      nextDocument.content.body = `The external agent updated this file ${n} times.`;
      const bytes = buildTextpack(target.title, { document: nextDocument, markdown: `---\ntextTextId: ${JSON.stringify(target.id)}\n---\n\n${nextDocument.content.body}` });
      const written = await store.writeVaultTextpack({ root: ROOT, workspaceId, itemId: target.id, relativePath: target.relativePath,
        operationId: randomUUID(), baseRevision: current.revision, bytes, actorUserId: owner.id, actorType: "external_agent" });
      check(written.status === "written", "Agent-like file mutation conflicted");
      result.fixture.agentMutations++;
      try {
        await activePage.waitForFunction(expected => document.querySelector('.tt-md-surface')?.textContent?.includes(expected),
          nextDocument.content.body, { timeout: 3500 });
        result.fixture.agentVisibleMutations++;
      } catch { /* Report visibility misses without hiding the completed write. */ }
      await sleep(5000);
    }
    await activePage.close();
    await context.close(); context = null;
    // The second existing account uses the same browser sequentially. It
    // verifies that both recorded collaborators can open this test workspace.
    phase = "second collaborator";
    const memberContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    context = memberContext;
    const memberCsrf = await (await memberContext.request.get(`${ORIGIN}/api/auth/csrf`)).json() as { csrfToken: string };
    const memberLogin = await memberContext.request.post(`${ORIGIN}/api/auth/callback/dev-login`, { form: { csrfToken: memberCsrf.csrfToken,
      email: EMAILS[1], callbackUrl: `${ORIGIN}/vault/${workspaceId}` } });
    check(memberLogin.ok(), "Existing second test-account sign-in failed");
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`${ORIGIN}/vault/${workspaceId}`, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await memberPage.locator('nav[aria-label="Workspace files"] button[aria-label="Gallery 001"]').waitFor({ timeout: 20_000 });
    result.fixture.memberVerified = true;
    await memberPage.close();
    phase = "after close idle";
    await sleep(5000);
    guard();
    result.status = "passed";
  } catch (error) {
    result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`BENCHMARK FAILED ${result.error}`);
  } finally {
    if (monitor) clearInterval(monitor);
    if (context) await context.close().catch(error => result.cleanup.push(`context close: ${String(error)}`));
    if (browser) await browser.close().catch(error => result.cleanup.push(`browser close: ${String(error)}`));
    if (workspaceCreated) {
      try { await dbModule.db.delete(schema.actionAudit).where(inArray(schema.actionAudit.targetId, [...items.map(item => item.id), ...items.map(item => `${workspaceId}:${item.id}`)])); result.cleanup.push("exact test item audit rows deleted"); }
      catch (error) { result.cleanup.push(`audit cleanup failed: ${String(error)}`); }
      try { await dbModule.db.delete(schema.collaborators).where(inArray(schema.collaborators.id, grantIds)); result.cleanup.push("exact test grants deleted"); }
      catch (error) { result.cleanup.push(`grant cleanup failed: ${String(error)}`); }
      try { await dbModule.db.delete(schema.blogs).where(eq(schema.blogs.id, workspaceId)); result.cleanup.push("exact UUID workspace row deleted"); }
      catch (error) { result.cleanup.push(`workspace cleanup failed: ${String(error)}`); }
    }
    if (directoryOwned) {
      try {
        const marker = JSON.parse(await fs.readFile(markerPath, "utf8")) as { workspaceId: string; runId: string };
        check(marker.workspaceId === workspaceId && marker.runId === browserRunId && path.dirname(workspaceDirectory) === ROOT, "Unsafe fixture cleanup path");
        await fs.rm(workspaceDirectory, { recursive: true }); result.cleanup.push("exact marked UUID vault subtree deleted");
      } catch (error) { result.cleanup.push(`vault cleanup failed: ${String(error)}`); }
    }
    await dbModule.closeDatabaseConnections().catch(error => result.cleanup.push(`database close failed: ${String(error)}`));
    if (result.cleanup.some(value => value.includes("failed"))) result.status = "failed";
    await writeResult();
    if (result.status !== "passed") process.exitCode = 1;
  }
}

main().catch(error => { console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error)); process.exitCode = 1; });
