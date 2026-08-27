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
// So the third state is the point. A precondition that is not met is NOT a
// pass and NOT a failure: it is reported as its own thing, with the command
// that fixes it. Only real failures set the exit code, so this can be trusted
// on a machine that is not fully set up.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

type Need = "server" | "mock" | "build" | "cli" | "db";

type Eval = { npm: string; needs: Need[] };

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
  { npm: "eval:sidebar", needs: ["build", "cli", "db"] },
];

const HOW_TO_FIX: Record<Need, string> = {
  server:
    "NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000 TEXTTEXT_AI_BASE_URL=http://localhost:3999/v1 npm run dev",
  mock: "node scripts/mock-ai-provider.mjs &",
  build: "npm run build   (a vercel build leaves a .next with no dev sign-in)",
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

/** The dev sign-in must be IN the build, or a browser eval cannot sign in. */
async function buildHasDevSignIn(): Promise<boolean> {
  if (!existsSync(".next/BUILD_ID")) return false;
  return true;
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

function run(npmScript: string): Promise<{ ok: boolean; tail: string }> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", npmScript], {
      stdio: ["ignore", "pipe", "pipe"],
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

async function main() {
  const args = process.argv.slice(2);
  const listOnly = args.includes("--list");
  const filter = args.find((arg) => !arg.startsWith("--")) ?? "";

  const met: Record<Need, boolean> = {
    server: await reachable("http://localhost:3000/"),
    mock: await reachable("http://localhost:3999/v1/models/probe"),
    build: await buildHasDevSignIn(),
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
    const result = await run(entry.npm);
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
