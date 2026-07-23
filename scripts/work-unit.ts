import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type CommandReceipt = {
  schemaVersion: 1;
  workUnitId: string;
  name: string;
  sourceCommit: string;
  sourceFingerprint: string;
  command: string[];
  commandFingerprint: string;
  startedAt: string;
  finishedAt: string;
  durationMilliseconds: number;
  status: "pass" | "fail" | "timeout";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  reused: boolean;
};

export type ReleaseGateReceipt = {
  schemaVersion: 1;
  sourceCommit: string;
  sourceFingerprint: string;
  generatedAt: string;
  totalDurationMilliseconds: number;
  checks: Array<{
    id: string;
    status: "pass";
    durationMilliseconds: number;
    reused: boolean;
    commandFingerprint: string;
  }>;
};

type WorkUnit = {
  schemaVersion: 1;
  id: string;
  label: string;
  baseCommit: string;
  startedAt: string;
};

type WorkUnitSummary = {
  schemaVersion: 1;
  workUnit: WorkUnit;
  completedAt: string;
  sourceCommit: string;
  sourceFingerprint: string;
  elapsedMilliseconds: number;
  executedCommandCount: number;
  reusedReceiptCount: number;
  passedCommandCount: number;
  failedCommandCount: number;
  commandDurationMilliseconds: number;
  slowest: Array<{
    name: string;
    status: CommandReceipt["status"];
    durationMilliseconds: number;
  }>;
  caches: ReturnType<typeof inspectCaches>;
};

type RunOptions = {
  root?: string;
  name: string;
  command: string[];
  timeoutSeconds: number;
  reuse?: boolean;
  environment?: CommandEnvironment;
};

type CommandEnvironment = Record<string, string | undefined>;

const scriptPath = fileURLToPath(import.meta.url);
export const repositoryRoot = resolve(dirname(scriptPath), "..");
const stateRoot = (root: string) => join(root, ".write");
const deliveryLockPath = (root: string) => join(stateRoot(root), "delivery.lock");
const currentWorkUnitPath = (root: string) =>
  join(stateRoot(root), "current-work-unit.json");

function runGit(root: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
}

export function safeReceiptName(value: string) {
  const safe = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return safe.replace(/^-+|-+$/g, "") || "command";
}

export function formatDuration(milliseconds: number) {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

export function sourceIdentity(root = repositoryRoot) {
  const sourceCommit = runGit(root, ["rev-parse", "HEAD"]).trim();
  const hash = createHash("sha256");
  hash.update(sourceCommit);
  hash.update("\0diff\0");
  hash.update(
    runGit(root, ["diff", "--binary", "--no-ext-diff", "HEAD", "--"]),
  );
  const untracked = runGit(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const relativePath of untracked) {
    const path = join(root, relativePath);
    hash.update("\0untracked\0");
    hash.update(relativePath);
    hash.update("\0");
    if (existsSync(path) && statSync(path).isFile()) {
      hash.update(readFileSync(path));
    }
  }
  return { sourceCommit, sourceFingerprint: hash.digest("hex") };
}

export function beginWorkUnit(label: string, root = repositoryRoot) {
  const lock = deliveryLockPath(root);
  if (existsSync(lock)) {
    const lane = existsSync(join(lock, "lane"))
      ? readFileSync(join(lock, "lane"), "utf8").trim()
      : "unknown";
    throw new Error(`Delivery lane is already owned by ${lane}.`);
  }
  const { sourceCommit } = sourceIdentity(root);
  const startedAt = new Date().toISOString();
  const compactTime = startedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const workUnit: WorkUnit = {
    schemaVersion: 1,
    id: `${compactTime}-${sourceCommit.slice(0, 8)}`,
    label: label.trim() || "Texttext work unit",
    baseCommit: sourceCommit,
    startedAt,
  };
  writeJson(currentWorkUnitPath(root), workUnit);
  mkdirSync(join(stateRoot(root), "work-units", workUnit.id, "receipts"), {
    recursive: true,
  });
  mkdirSync(lock);
  writeFileSync(join(lock, "lane"), "work\n", { mode: 0o600 });
  writeFileSync(join(lock, "work-unit-id"), `${workUnit.id}\n`, { mode: 0o600 });
  console.log(`Work unit ${workUnit.id}: ${workUnit.label}`);
  return workUnit;
}

function currentWorkUnit(root: string) {
  const path = currentWorkUnitPath(root);
  if (!existsSync(path)) return beginWorkUnit("Automatic work unit", root);
  return JSON.parse(readFileSync(path, "utf8")) as WorkUnit;
}

function commandFingerprint(
  sourceFingerprint: string,
  command: string[],
  environment: CommandEnvironment,
) {
  const selectedEnvironment = Object.fromEntries(
    Object.entries(environment)
      .filter(([key]) =>
        [
          "NODE_ENV",
          "NEXT_DEPLOYMENT_ID",
          "WRITE_LIVE_AI_PROBE",
          "WRITE_PRODUCT_ORIGIN",
        ].includes(key),
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash("sha256")
    .update(
      JSON.stringify({ sourceFingerprint, command, environment: selectedEnvironment }),
    )
    .digest("hex");
}

function historyPath(root: string, workUnit: WorkUnit) {
  return join(stateRoot(root), "work-units", workUnit.id, "history.jsonl");
}

function receiptDirectory(root: string, workUnit: WorkUnit) {
  return join(stateRoot(root), "work-units", workUnit.id, "receipts");
}

function findPassingReceipt(
  root: string,
  workUnit: WorkUnit,
  name: string,
  fingerprint: string,
) {
  const directory = receiptDirectory(root, workUnit);
  if (!existsSync(directory)) return null;
  const prefix = `${safeReceiptName(name)}-`;
  for (const entry of readdirSync(directory)) {
    if (!entry.startsWith(prefix) || !entry.endsWith(".json")) continue;
    try {
      const receipt = JSON.parse(
        readFileSync(join(directory, entry), "utf8"),
      ) as CommandReceipt;
      if (
        receipt.status === "pass" &&
        receipt.commandFingerprint === fingerprint
      ) {
        return receipt;
      }
    } catch {
      // A partial or manually edited receipt is not trusted.
    }
  }
  return null;
}

function appendHistory(root: string, workUnit: WorkUnit, receipt: CommandReceipt) {
  const path = historyPath(root, workUnit);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(receipt)}\n`, { encoding: "utf8" });
}

function terminateProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The process already exited.
    }
  }
}

export async function runMeasuredCommand(options: RunOptions) {
  const root = options.root ?? repositoryRoot;
  if (options.command.length === 0) throw new Error("A command is required.");
  const workUnit = currentWorkUnit(root);
  const identity = sourceIdentity(root);
  const environment = { ...process.env, ...options.environment };
  const fingerprint = commandFingerprint(
    identity.sourceFingerprint,
    options.command,
    environment,
  );
  const reusable = options.reuse !== false;
  const existing = reusable
    ? findPassingReceipt(root, workUnit, options.name, fingerprint)
    : null;
  if (existing) {
    const reused = { ...existing, reused: true };
    appendHistory(root, workUnit, reused);
    console.log(
      `>> ${options.name}: reused passing receipt (${formatDuration(existing.durationMilliseconds)})`,
    );
    return reused;
  }

  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  console.log(`>> ${options.name}`);
  const child = spawn(options.command[0], options.command.slice(1), {
    cwd: root,
    detached: true,
    env: environment,
    stdio: ["ignore", "inherit", "inherit"],
  });
  let timedOut = false;
  let forceKillTimer: NodeJS.Timeout | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    console.error(
      `${options.name} exceeded ${options.timeoutSeconds}s; terminating its process group.`,
    );
    if (child.pid) terminateProcessGroup(child.pid, "SIGTERM");
    forceKillTimer = setTimeout(() => {
      if (child.pid) terminateProcessGroup(child.pid, "SIGKILL");
    }, 5_000);
  }, options.timeoutSeconds * 1_000);

  const result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveResult, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveResult({ code, signal }));
  }).finally(() => {
    clearTimeout(timeout);
    if (forceKillTimer) clearTimeout(forceKillTimer);
  });

  const finished = Date.now();
  const status: CommandReceipt["status"] = timedOut
    ? "timeout"
    : result.code === 0
      ? "pass"
      : "fail";
  const receipt: CommandReceipt = {
    schemaVersion: 1,
    workUnitId: workUnit.id,
    name: options.name,
    ...identity,
    command: options.command,
    commandFingerprint: fingerprint,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMilliseconds: finished - started,
    status,
    exitCode: result.code,
    signal: result.signal,
    reused: false,
  };
  const path = join(
    receiptDirectory(root, workUnit),
    `${safeReceiptName(options.name)}-${fingerprint.slice(0, 16)}.json`,
  );
  writeJson(path, receipt);
  appendHistory(root, workUnit, receipt);
  console.log(
    `   ${options.name}: ${status} in ${formatDuration(receipt.durationMilliseconds)}`,
  );
  if (status !== "pass") {
    const error = new Error(`${options.name} ${status}`) as Error & {
      exitCode?: number;
    };
    error.exitCode = timedOut ? 124 : (result.code ?? 1);
    throw error;
  }
  return receipt;
}

function exactRequiredChecks(receipt: ReleaseGateReceipt) {
  return new Set(receipt.checks.map((check) => check.id));
}

export const requiredReleaseChecks = new Set([
  "web.types",
  "workflow.document_engine",
  "web.unit",
  "native.unit",
  "native.live_ai",
  "apple.eval",
]);

export function validateReleaseReceipt(
  receipt: ReleaseGateReceipt,
  identity: { sourceCommit: string; sourceFingerprint: string },
) {
  if (receipt.schemaVersion !== 1) throw new Error("Wrong release receipt schema.");
  if (receipt.sourceCommit !== identity.sourceCommit) {
    throw new Error("Release receipt source commit is stale.");
  }
  if (receipt.sourceFingerprint !== identity.sourceFingerprint) {
    throw new Error("Release receipt does not match the current source state.");
  }
  const ids = receipt.checks.map((check) => check.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Release receipt contains duplicate checks.");
  }
  const actual = exactRequiredChecks(receipt);
  if ([...requiredReleaseChecks].some((id) => !actual.has(id))) {
    throw new Error("Release receipt is missing required checks.");
  }
  if (
    receipt.checks.some(
      (check) =>
        check.status !== "pass" ||
        !Number.isInteger(check.durationMilliseconds) ||
        check.durationMilliseconds < 0 ||
        !/^[a-f0-9]{64}$/.test(check.commandFingerprint),
    )
  ) {
    throw new Error("Release receipt contains an invalid check.");
  }
  return receipt;
}

export function releaseReceiptPath(root = repositoryRoot) {
  return join(stateRoot(root), "release-gate-receipt.json");
}

export function readAndValidateReleaseReceipt(root = repositoryRoot) {
  const path = releaseReceiptPath(root);
  if (!existsSync(path)) throw new Error("No release gate receipt exists.");
  const receipt = JSON.parse(readFileSync(path, "utf8")) as ReleaseGateReceipt;
  return validateReleaseReceipt(receipt, sourceIdentity(root));
}

function directorySizeKilobytes(path: string) {
  if (!existsSync(path)) return 0;
  const output = execFileSync("du", ["-sk", path], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return Number.parseInt(output.trim().split(/\s+/)[0] ?? "0", 10) || 0;
}

function scopedNextDevIsRunning(root: string) {
  const processes = execFileSync("ps", ["ax", "-o", "pid=,command="], {
    encoding: "utf8",
  });
  for (const line of processes.split("\n")) {
    if (!/\b(next dev|next-server)\b/.test(line)) continue;
    const pid = Number.parseInt(line.trim().split(/\s+/, 1)[0] ?? "", 10);
    if (!Number.isInteger(pid)) continue;
    try {
      const cwd = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .split("\n")
        .find((entry) => entry.startsWith("n"))
        ?.slice(1);
      if (cwd === root) return true;
    } catch {
      if (line.includes(root)) return true;
    }
  }
  return false;
}

export function inspectCaches(
  root = repositoryRoot,
  options: { prune?: boolean; thresholdKilobytes?: number } = {},
) {
  const paths = {
    nextDevelopment: join(root, ".next", "dev"),
    nextProduction: join(root, ".next", "server"),
    swift: join(root, "mac", ".build"),
  };
  const before = Object.fromEntries(
    Object.entries(paths).map(([name, path]) => [name, directorySizeKilobytes(path)]),
  );
  const threshold = options.thresholdKilobytes ?? 2 * 1024 * 1024;
  let reclaimedKilobytes = 0;
  if (options.prune && before.nextDevelopment > threshold) {
    if (scopedNextDevIsRunning(root)) {
      console.log("Development cache is large, but this repo's dev server is running.");
    } else {
      reclaimedKilobytes = before.nextDevelopment;
      rmSync(paths.nextDevelopment, { recursive: true, force: true });
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    sizesKilobytes: before,
    thresholdKilobytes: threshold,
    reclaimedKilobytes,
  };
  mkdirSync(stateRoot(root), { recursive: true });
  appendFileSync(
    join(stateRoot(root), "cache-history.jsonl"),
    `${JSON.stringify(report)}\n`,
    "utf8",
  );
  console.log(
    `Cache: Next dev ${Math.round(before.nextDevelopment / 1024)} MB, ` +
      `Next production ${Math.round(before.nextProduction / 1024)} MB, ` +
      `Swift ${Math.round(before.swift / 1024)} MB.`,
  );
  if (reclaimedKilobytes > 0) {
    console.log(`Reclaimed ${Math.round(reclaimedKilobytes / 1024)} MB.`);
  }
  return report;
}

export function printWorkUnitSummary(root = repositoryRoot) {
  const workUnit = currentWorkUnit(root);
  const path = historyPath(root, workUnit);
  const receipts = existsSync(path)
    ? readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CommandReceipt)
    : [];
  const executed = receipts.filter((receipt) => !receipt.reused);
  const total = executed.reduce(
    (sum, receipt) => sum + receipt.durationMilliseconds,
    0,
  );
  const slowest = [...executed]
    .sort((left, right) => right.durationMilliseconds - left.durationMilliseconds)
    .slice(0, 5);
  console.log(`Work unit: ${workUnit.label} (${workUnit.id})`);
  console.log(
    `Executed ${executed.length} commands in ${formatDuration(total)}; ` +
      `reused ${receipts.length - executed.length} receipts.`,
  );
  for (const receipt of slowest) {
    console.log(
      `  ${receipt.name}: ${formatDuration(receipt.durationMilliseconds)} (${receipt.status})`,
    );
  }
  return { workUnit, receipts, totalDurationMilliseconds: total, slowest };
}

export function finishWorkUnit(root = repositoryRoot) {
  const summary = printWorkUnitSummary(root);
  const completedAt = new Date().toISOString();
  const identity = sourceIdentity(root);
  const executed = summary.receipts.filter((receipt) => !receipt.reused);
  const report: WorkUnitSummary = {
    schemaVersion: 1,
    workUnit: summary.workUnit,
    completedAt,
    ...identity,
    elapsedMilliseconds:
      Date.parse(completedAt) - Date.parse(summary.workUnit.startedAt),
    executedCommandCount: executed.length,
    reusedReceiptCount: summary.receipts.length - executed.length,
    passedCommandCount: executed.filter((receipt) => receipt.status === "pass")
      .length,
    failedCommandCount: executed.filter((receipt) => receipt.status !== "pass")
      .length,
    commandDurationMilliseconds: summary.totalDurationMilliseconds,
    slowest: summary.slowest.map((receipt) => ({
      name: receipt.name,
      status: receipt.status,
      durationMilliseconds: receipt.durationMilliseconds,
    })),
    caches: inspectCaches(root),
  };
  const directory = join(
    stateRoot(root),
    "work-units",
    summary.workUnit.id,
  );
  const path = join(directory, "summary.json");
  writeJson(path, report);
  writeJson(join(stateRoot(root), "latest-work-unit-summary.json"), report);
  const lock = deliveryLockPath(root);
  const lockWorkUnitId = existsSync(join(lock, "work-unit-id"))
    ? readFileSync(join(lock, "work-unit-id"), "utf8").trim()
    : "";
  if (lockWorkUnitId === summary.workUnit.id) {
    rmSync(lock, { recursive: true, force: true });
  }
  console.log(
    `Completed in ${formatDuration(report.elapsedMilliseconds)}; ` +
      `${report.failedCommandCount} failed command(s).`,
  );
  console.log(path);
  return report;
}

function parseRunArguments(args: string[]) {
  let name = "";
  let timeoutSeconds = 600;
  let reuse = true;
  let index = 0;
  for (; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") {
      index += 1;
      break;
    }
    if (value === "--name") name = args[++index] ?? "";
    else if (value === "--timeout") {
      timeoutSeconds = Number.parseInt(args[++index] ?? "", 10);
    } else if (value === "--no-reuse") reuse = false;
    else throw new Error(`Unknown run option: ${value}`);
  }
  if (!name) throw new Error("run requires --name.");
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1) {
    throw new Error("run requires a positive --timeout.");
  }
  const command = args.slice(index);
  if (command.length === 0) throw new Error("run requires a command after --.");
  return { name, timeoutSeconds, reuse, command };
}

async function main() {
  const [subcommand = "summary", ...args] = process.argv.slice(2);
  if (subcommand === "begin") {
    beginWorkUnit(args.join(" ") || "Texttext work unit");
    return;
  }
  if (subcommand === "run") {
    await runMeasuredCommand(parseRunArguments(args));
    return;
  }
  if (subcommand === "summary") {
    printWorkUnitSummary();
    return;
  }
  if (subcommand === "finish") {
    finishWorkUnit();
    return;
  }
  if (subcommand === "doctor") {
    inspectCaches(repositoryRoot, { prune: args.includes("--prune") });
    return;
  }
  if (subcommand === "check-release") {
    readAndValidateReleaseReceipt();
    console.log(releaseReceiptPath());
    return;
  }
  if (subcommand === "receipt-path") {
    console.log(releaseReceiptPath());
    return;
  }
  throw new Error(`Unknown work-unit command: ${subcommand}`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode =
      error instanceof Error && "exitCode" in error
        ? Number((error as Error & { exitCode: number }).exitCode)
        : 1;
  });
}
