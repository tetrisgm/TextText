import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  formatLocalLiveReadiness,
  isLocalLiveServerReady,
  localLiveReadinessPaths,
  type LocalLiveReadinessProbe,
} from "./local-live-readiness";

const port = Number.parseInt(process.env.TEXTTEXT_EVAL_PORT ?? "3107", 10);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("TEXTTEXT_EVAL_PORT must be an unprivileged TCP port.");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const databaseHost = new URL(databaseUrl).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(databaseHost)) {
  throw new Error("The local client evaluator refuses a non-local database.");
}

// Next normalizes its local request URL to localhost. Drive the evaluator
// through that same public origin so OAuth's same-origin approval check tests
// the real browser contract instead of an equivalent 127.0.0.1 alias.
const origin = `http://localhost:${port}`;
const rootDomain = `localhost:${port}`;
const evaluationDistDir = ".texttext/next-live-eval";
const evaluationDistPath = join(process.cwd(), evaluationDistDir);
const commandTimeoutMilliseconds = 300_000;
const suiteNames = new Set([
  "workflow",
  "sync",
  "collaboration",
  "oauth",
  "generation",
]);
const requestedSuites = new Set(
  (process.env.TEXTTEXT_EVAL_ONLY ?? "")
    .split(",")
    .map((suite) => suite.trim())
    .filter(Boolean),
);
for (const suite of requestedSuites) {
  if (!suiteNames.has(suite)) {
    throw new Error(
      `TEXTTEXT_EVAL_ONLY contains unknown suite "${suite}". Use workflow, sync, collaboration, oauth, or generation.`,
    );
  }
}
const shouldRun = (suite: string) =>
  requestedSuites.size === 0 || requestedSuites.has(suite);
let server: ChildProcess | null = null;
let serverOutput = "";

function appendServerOutput(chunk: Buffer) {
  serverOutput = `${serverOutput}${chunk.toString("utf8")}`.slice(-16_000);
}

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The process may have exited between the state check and the signal.
  }
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  killProcessGroup(server, "SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server?.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (server.exitCode === null) {
    killProcessGroup(server, "SIGKILL");
  }
}

async function cleanEvaluationBuild() {
  await rm(evaluationDistPath, { recursive: true, force: true });
}

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  let lastReadinessDiagnostic = "no response";
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) {
      throw new Error(
        `Local TextText server exited before readiness.\n${serverOutput}`,
      );
    }
    const probeResults = await Promise.all(
      localLiveReadinessPaths.map(
        async (path): Promise<LocalLiveReadinessProbe> => {
          try {
            const response = await fetch(`${origin}${path}`, {
              redirect: "manual",
              signal: AbortSignal.timeout(5_000),
            });
            const probe = { path, status: response.status } as const;
            await response.body?.cancel();
            return probe;
          } catch {
            return { path, status: "error" };
          }
        },
      ),
    );
    lastReadinessDiagnostic = formatLocalLiveReadiness(probeResults);
    if (isLocalLiveServerReady(probeResults)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Local TextText server did not become ready. Last probes: ${lastReadinessDiagnostic}\n${serverOutput}`,
  );
}

async function runBounded(
  label: string,
  executable: string,
  args: string[],
) {
  const startedAt = performance.now();
  console.log(`\n>> ${label}`);
  const child = spawn(executable, args, {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      AUTH_DEV_LOGIN: "1",
      NEXT_PUBLIC_ROOT_DOMAIN: rootDomain,
      NEXT_TELEMETRY_DISABLED: "1",
      TEXTTEXT_ORIGIN: origin,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      killProcessGroup(child, "SIGTERM");
      setTimeout(() => killProcessGroup(child, "SIGKILL"), 3_000).unref();
      reject(new Error(`${label} exceeded its five-minute limit.`));
    }, commandTimeoutMilliseconds);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) {
    throw new Error(
      `${label} exited with status ${exitCode}.\nLocal server output:\n${serverOutput}`,
    );
  }
  return Math.round(performance.now() - startedAt);
}

async function main() {
  const startedAt = performance.now();
  const durations: Record<string, number> = {};
  await cleanEvaluationBuild();
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        AUTH_DEV_LOGIN: "1",
        NEXT_PUBLIC_ROOT_DOMAIN: rootDomain,
        NEXT_TELEMETRY_DISABLED: "1",
        TEXTTEXT_NEXT_DIST_DIR: evaluationDistDir,
        TEXTTEXT_ORIGIN: origin,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout?.on("data", appendServerOutput);
  server.stderr?.on("data", appendServerOutput);

  try {
    await waitForServer();
    if (shouldRun("oauth")) {
      durations.oauthMcpMilliseconds = await runBounded(
        "OAuth and MCP connection",
        "python3",
        ["scripts/test-oauth-mcp-loop.py", origin],
      );
    }
    if (shouldRun("workflow")) {
      durations.workflowMilliseconds = await runBounded(
        "sharing and access workflows",
        process.execPath,
        ["--import", "tsx", "scripts/verify-workflow-live.ts"],
      );
    }
    if (shouldRun("generation")) {
      durations.generationMilliseconds = await runBounded(
        "agent-composed template generation",
        process.execPath,
        ["--import", "tsx", "scripts/verify-generation-live.ts"],
      );
    }
    if (shouldRun("sync")) {
      durations.syncMilliseconds = await runBounded(
        "sync and page creation",
        process.execPath,
        ["--import", "tsx", "scripts/verify-sync-live.ts"],
      );
    }
    if (shouldRun("collaboration")) {
      durations.collaborationMilliseconds = await runBounded(
        "four-client collaboration",
        process.execPath,
        ["--import", "tsx", "scripts/verify-collaboration-live.ts"],
      );
    }
  } finally {
    await stopServer();
    await cleanEvaluationBuild();
  }

  console.log(
    JSON.stringify({
      status: "pass",
      origin,
      databaseHost,
      totalMilliseconds: Math.round(performance.now() - startedAt),
      ...durations,
    }),
  );
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void stopServer()
      .then(cleanEvaluationBuild)
      .finally(() => process.exit(128));
  });
}

main().catch(async (error: unknown) => {
  await stopServer();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
