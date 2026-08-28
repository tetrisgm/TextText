// Run the browser evals and say which are green, which are broken, and which
// could not run at all.
//
//   npm run evals               every eval
//   npm run evals -- --list     the matrix, run nothing
//   npm run evals -- turn       only evals whose name contains "turn"
//
// This exists because nothing ran them. Eighteen eval scripts, six of them in
// the release gate, and every browser one outside it. eval:item-type was dead
// long enough that a session wrote its failure off as environmental, and
// eval:sidebar was being killed by every deploy, because `vercel build --prod`
// leaves a .next with no dev sign-in in it. Both looked exactly like "nobody
// has run this yet".
//
// eval:sidebar used to spawn its own `next start` on 3180, which meant it
// served whatever .next held while the dev server on 3000 was writing that
// same directory. Whichever ran last won, so the suite passed or failed
// depending on the order of the day rather than on the code. It now reuses
// the dev server the other eleven already need, which is why its needs list
// says "server" and not "build".
//
// So the third state is the point. A precondition that is not met is NOT a
// pass and NOT a failure: it is reported as its own thing, with the command
// that fixes it. Only real failures set the exit code, so this can be trusted
// on a machine that is not fully set up.

import { spawn } from "node:child_process";

type Need = "server" | "mock" | "cli" | "db";

type Eval = { npm: string; needs: Need[]; env?: Record<string, string> };

const EVALS: Eval[] = [
  { npm: "eval:features", needs: ["server"] },
  { npm: "eval:home-layout", needs: ["server"] },
  { npm: "eval:folder-look", needs: ["server"] },
  { npm: "eval:save-as-look", needs: ["server", "db"] },
  { npm: "eval:item-type", needs: ["server", "db"] },
  { npm: "eval:markdown-surface", needs: ["server"] },
  { npm: "eval:assistant-create", needs: ["server", "mock", "db"] },
  { npm: "eval:native-create", needs: ["server", "db"] },
  { npm: "eval:turn-receipt", needs: ["server", "mock"] },
  { npm: "eval:turn-progress", needs: ["server", "mock"] },
  { npm: "eval:mcp:outbound", needs: ["server", "mock"] },
  // The everyday verbs, driven by a real model deciding its own tool calls.
  { npm: "eval:item-verbs", needs: ["server", "cli", "db"] },
  // Reuses the same dev server as everything above rather than spawning
  // `next start` into the same .next the dev server is already writing.
  { npm: "eval:sidebar", needs: ["server", "cli", "db"], env: { SIDEBAR_EVAL_PORT: "3000" } },
];

const HOW_TO_FIX: Record<Need, string> = {
  server:
    "NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000 TEXTTEXT_AI_BASE_URL=http://localhost:3999/v1 npm run dev   (a server that 404s everything is wedged: restart it)",
  mock: "node scripts/mock-ai-provider.mjs &",
  cli: "install the codex CLI, or run eval:sidebar with claude",
  db: "point DATABASE_URL at local Postgres in .env.local",
};

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: "manual" });
    return response.status < 500;
  } catch {
    return false;
  }
}

/**
 * A dev server can answer and still be useless.
 *
 * One wedged instance returned 404 for every route including /api/app/build,
 * and `reachable` said yes, because 404 is under 500. Twelve evals failed and
 * the failures pointed at everything except the real cause: sign-in forms that
 * never appeared, "the page may be private", a look suite that could not
 * build. A precondition that cannot tell a serving server from a dead one is
 * worse than none, because its "ok" is believed.
 */
async function serverActuallyServes(): Promise<boolean> {
  try {
    const response = await fetch("http://localhost:3000/api/app/build", {
      redirect: "manual",
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

async function which(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("which", [name], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function localDatabase(): Promise<boolean> {
  const raw = process.env.DATABASE_URL;
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname;
    return ["localhost", "127.0.0.1", "::1"].includes(host);
  } catch {
    return false;
  }
}

function run(
  npmScript: string,
  env?: Record<string, string>,
): Promise<{ ok: boolean; tail: string }> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", npmScript], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(env ?? {}) },
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => {
      const lines = out.trimEnd().split("\n").filter(Boolean);
      resolve({ ok: code === 0, tail: lines.slice(-4).join(" | ").slice(0, 300) });
    });
    child.on("error", () => resolve({ ok: false, tail: "could not start" }));
  });
}

/**
 * Compile the routes the browser evals hit before timing anything against them.
 *
 * `next dev` compiles on first request, and a first request can take tens of
 * seconds. eval:item-type and eval:assistant-create both fail on a cold server
 * and pass on a warm one, so a suite run straight after `npm run dev` reported
 * two red evals that were nothing of the kind. That is the same confusion this
 * runner exists to remove, arriving from the other direction: not a missing
 * precondition reported as a failure, but an unmet one nobody had named.
 */
async function warmRoutes(): Promise<void> {
  const routes = ["/", "/editor"];
  process.stdout.write("  warming ");
  for (const route of routes) {
    try {
      await fetch(`http://localhost:3000${route}`, { redirect: "manual" });
      process.stdout.write(".");
    } catch {
      process.stdout.write("x");
    }
  }
  console.log(" done");
}

async function main() {
  const args = process.argv.slice(2);
  const listOnly = args.includes("--list");
  const filter = args.find((arg) => !arg.startsWith("--")) ?? "";

  const met: Record<Need, boolean> = {
    server: await serverActuallyServes(),
    mock: await reachable("http://localhost:3999/v1/models/probe"),
    cli: await which("codex"),
    db: await localDatabase(),
  };

  console.log("preconditions");
  for (const need of Object.keys(met) as Need[]) {
    console.log(
      `  ${met[need] ? "ok  " : "MISSING"} ${need}${met[need] ? "" : `  -> ${HOW_TO_FIX[need]}`}`,
    );
  }
  console.log();

  if (!listOnly && met.server) await warmRoutes();

  const chosen = EVALS.filter((entry) => entry.npm.includes(filter));
  const green: string[] = [];
  const broken: Array<{ npm: string; tail: string }> = [];
  const blocked: Array<{ npm: string; missing: Need[] }> = [];

  for (const entry of chosen) {
    const missing = entry.needs.filter((need) => !met[need]);
    if (missing.length > 0) {
      blocked.push({ npm: entry.npm, missing });
      console.log(`  blocked ${entry.npm}  needs ${missing.join(", ")}`);
      continue;
    }
    if (listOnly) {
      console.log(`  ready   ${entry.npm}`);
      continue;
    }
    process.stdout.write(`  running ${entry.npm} ... `);
    const result = await run(entry.npm, entry.env);
    if (result.ok) {
      green.push(entry.npm);
      console.log("pass");
    } else {
      broken.push({ npm: entry.npm, tail: result.tail });
      console.log("FAIL");
    }
  }

  if (listOnly) return;

  console.log(`\n${green.length} passed, ${broken.length} failed, ${blocked.length} could not run`);
  for (const entry of broken) console.log(`  FAIL    ${entry.npm}: ${entry.tail}`);
  for (const entry of blocked) {
    console.log(
      `  BLOCKED ${entry.npm}: needs ${entry.missing.join(", ")} -> ${entry.missing
        .map((need) => HOW_TO_FIX[need])
        .join(" ; ")}`,
    );
  }
  // Only real failures fail the run. A machine that is not set up is not a
  // broken product, and conflating the two is what let dead evals hide.
  process.exitCode = broken.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
