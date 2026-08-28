// Shared harness for evals that drive a REAL model against the real workspace
// command surface.
//
// Two evals need the same five things: a local model CLI, a way to read one
// decision back out of tens of kilobytes of session log, the tool catalogue the
// assistant actually gets, a signed-in scratch workspace, and a turn loop that
// executes what the model chose. Saying that twice would mean fixing every
// hard-won detail in here twice, and the details are the whole difficulty: the
// premature-done pushback, the deliberately-invalid example object, the
// echoed-prompt trim.
//
// This is a harness, not a product path. Everything here runs a tool through
// runWorkspaceToolForSession, which is the same executor the app, the native
// assistant and external agents reach.

import { spawn, spawnSync } from "node:child_process";

import type { Page } from "playwright";

import { cloudAssistantToolNames } from "../src/lib/ai/cloud-tools";
import { ASSISTANT_SYSTEM_PROMPT } from "../src/lib/ai/system-prompt";
import { WORKSPACE_TOOL_DEFINITIONS } from "../src/lib/ai/tools";
import { runWorkspaceToolForSession } from "../src/lib/mcp/tools";

export type Engine = "claude" | "codex";

/** Runaway guard only. The product does not truncate tool results. */
const RESULT_CAP = 40_000;

export type Actor = { sub: string; userId: string | null; handle: string };

export type Transcript = Array<{
  step: number;
  tool: string;
  ok: boolean;
  detail: string;
}>;

export type Decision =
  | { tool: string; args: Record<string, unknown> }
  | { done: string };

// ---------------------------------------------------------------- the model

export function requireModelCli(engine: Engine, howToSwitch: string): void {
  const found = spawnSync("which", [engine], { encoding: "utf8" });
  if (found.status === 0 && found.stdout.trim()) return;
  throw new Error(
    `The "${engine}" CLI is not on PATH, and this eval uses it as the model.\n` +
      `Install it, or run with a different one: ${howToSwitch}`,
  );
}

export function runModel(prompt: string, engine: Engine): Promise<string> {
  const [cmd, args] =
    engine === "codex"
      ? (["codex", ["exec", "--skip-git-repo-check", prompt]] as const)
      : (["claude", ["-p", prompt]] as const);
  return new Promise((resolve) => {
    const child = spawn(cmd, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 420_000);
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

/**
 * Pull one decision object out of whatever the CLI printed around it. The
 * CLIs wrap an answer in tens of kilobytes of session log, so anchoring on the
 * first brace finds log noise; this requires the shape we asked for.
 */
export function extractDecision(text: string): Decision | null {
  const bodies: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    if (match[1]) bodies.push(match[1]);
  }
  bodies.push(text);
  for (const body of bodies.reverse()) {
    const starts: number[] = [];
    for (const match of body.matchAll(/\{/g)) {
      if (match.index !== undefined) starts.push(match.index);
    }
    for (const start of starts) {
      for (let end = body.length - 1; end > start; end -= 1) {
        if (body[end] !== "}") continue;
        try {
          const parsed = JSON.parse(body.slice(start, end + 1)) as Record<
            string,
            unknown
          >;
          if (typeof parsed.tool === "string") {
            return {
              tool: parsed.tool,
              args: (parsed.args as Record<string, unknown>) ?? {},
            };
          }
          if (typeof parsed.done === "string") return { done: parsed.done };
        } catch {
          // keep looking
        }
      }
    }
  }
  return null;
}

// ------------------------------------------------------------- the workspace

export async function signIn(
  page: Page,
  base: string,
  email: string,
  displayName: string,
): Promise<string> {
  await page.goto(`${base}/editor`, { waitUntil: "networkidle" });
  const form = page.locator("form.ac-devsignin");
  await form.waitFor({ timeout: 30000 });
  await form.locator('input[type="email"]').fill(email);
  await form.locator('input[aria-label="Name"]').fill(displayName);
  await form.locator('button[type="submit"]').click();
  await form.waitFor({ state: "detached", timeout: 40000 }).catch(() => undefined);
  await page.waitForTimeout(3500);
  const handle = new URL(page.url()).pathname.match(/^\/@([^/?#]+)/)?.[1];
  if (!handle) throw new Error(`sign-in did not reach a workspace: ${page.url()}`);
  return handle;
}

/** Run one workspace tool the way the assistant does, and return its text. */
export async function callTool(
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; text: string }> {
  const result = await runWorkspaceToolForSession(name as never, args, actor);
  const text = (result.content ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
  return { ok: !result.isError, text };
}

/**
 * The dev sign-in has to be in the build being served.
 *
 * Two different failures used to arrive as one message: a server that is not
 * there at all, and a server whose build has no dev sign-in. Catching the fetch
 * collapsed the first into the second, so the advice was to rebuild when the
 * real answer was to start something.
 */
export async function requireDevSignInBuild(base: string): Promise<void> {
  let reached = false;
  let html = "";
  try {
    const response = await fetch(`${base}/editor`, { redirect: "manual" });
    reached = true;
    html = await response.text();
  } catch {
    reached = false;
  }
  if (html.includes("ac-devsignin")) return;
  if (!reached) {
    throw new Error(
      `Nothing is answering on ${base}, so this eval cannot sign in.\n` +
        "That is a missing server, not a stale build. Start one:\n" +
        "  NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000 npm run dev",
    );
  }
  throw new Error(
    `${base}/editor answered, but with no dev sign-in, so this eval cannot\n` +
      "sign in. The .next build being served was made without\n" +
      "AUTH_DEV_LOGIN=1, which is what `vercel build --prod` leaves behind.\n" +
      "Rebuild locally:\n" +
      "  npm run build",
  );
}

// ------------------------------------------------------------- the agent loop

export function toolCatalogue(): string {
  return cloudAssistantToolNames()
    .map((name) => {
      const definition = WORKSPACE_TOOL_DEFINITIONS[name];
      return `### ${name}\n${definition.description}\nInput JSON Schema:\n${JSON.stringify(definition.jsonSchema)}`;
    })
    .join("\n\n");
}

export type ConverseOptions = {
  /** The person's own words. The only thing the model is told to satisfy. */
  ask: string;
  actor: Actor;
  /** e.g. "Current view: level workspace, folder notes." */
  contextLine: string;
  engine: Engine;
  maxSteps: number;
  /** Called with the raw CLI output per step, for saving a transcript. */
  onRawStep?: (step: number, raw: string) => void;
  note?: (line: string) => void;
};

export async function converse(options: ConverseOptions): Promise<Transcript> {
  const { ask, actor, contextLine, engine, maxSteps } = options;
  const note = options.note ?? (() => undefined);
  const transcript: Transcript = [];
  const history: string[] = [];
  const catalogue = toolCatalogue();

  for (let step = 1; step <= maxSteps; step += 1) {
    const prompt = [
      ASSISTANT_SYSTEM_PROMPT,
      "",
      contextLine,
      "",
      "You act by choosing ONE tool per turn. These are your tools:",
      "",
      catalogue,
      "",
      "The conversation so far:",
      `user: ${ask}`,
      ...history,
      "",
      // Deliberately NOT valid JSON: these CLIs reprint the prompt in their
      // output, so a complete example object gets found by the extractor and
      // read back as the model's own answer. It looped fourteen times echoing
      // a placeholder before this was noticed.
      "Reply with ONLY a JSON object and nothing else. No prose, no code fence.",
      "To call a tool, the object has a key tool whose value is the tool name, and a key args whose value is the argument object.",
      "Once the request has been fully carried out, instead reply with an object whose only key is done, whose value is a sentence describing what actually changed.",
      "Do not report done before calling the tools that make the change.",
    ].join("\n");

    const raw = await runModel(prompt, engine);
    options.onRawStep?.(step, raw);
    // Drop the echoed prompt before reading an answer out of the tail.
    const answer = raw.includes(prompt)
      ? raw.slice(raw.lastIndexOf(prompt) + prompt.length)
      : raw;
    const decision = extractDecision(answer);
    if (!decision) {
      transcript.push({ step, tool: "(none)", ok: false, detail: "no decision in reply" });
      break;
    }
    if ("done" in decision) {
      // A model that reports done before calling anything has answered the
      // request in prose. Push back once rather than scoring an empty run.
      const didSomething = transcript.some((entry) => entry.ok && entry.tool !== "(done)");
      const pushbacks = transcript.filter((e) => e.tool === "(premature done)").length;
      if (!didSomething && pushbacks < 2 && step < maxSteps) {
        transcript.push({
          step,
          tool: "(premature done)",
          ok: false,
          detail: decision.done.slice(0, 200),
        });
        history.push(
          `assistant said done: ${decision.done.slice(0, 200)}`,
          "user: nothing has changed in the workspace yet. Carry the request out with the tools.",
        );
        continue;
      }
      transcript.push({ step, tool: "(done)", ok: true, detail: decision.done.slice(0, 200) });
      break;
    }
    if (!cloudAssistantToolNames().includes(decision.tool as never)) {
      const detail = `unknown tool ${decision.tool}`;
      transcript.push({ step, tool: decision.tool, ok: false, detail });
      history.push(`assistant called ${decision.tool}`, `tool error: ${detail}`);
      continue;
    }

    let ok = true;
    let detail = "";
    try {
      const result = await runWorkspaceToolForSession(
        decision.tool as never,
        decision.args,
        actor,
      );
      detail = (result.content ?? [])
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n")
        // The product hands the model the whole tool result. Cutting it here
        // measured the harness instead: list_items answers with roughly 800
        // characters per item, so three notes overflowed a 1500 character
        // history entry, the ids fell off the end, and the model relisted
        // until it ran out of steps. The cap that remains is a runaway guard,
        // not a context budget.
        .slice(0, RESULT_CAP);
      ok = !result.isError;
    } catch (error) {
      ok = false;
      detail = error instanceof Error ? error.message : String(error);
    }
    transcript.push({ step, tool: decision.tool, ok, detail: detail.slice(0, 300) });
    note(`    ${ok ? "ok  " : "ERR "} ${decision.tool}${ok ? "" : ` - ${detail.slice(0, 160)}`}`);
    history.push(
      `assistant called ${decision.tool} with ${JSON.stringify(decision.args).slice(0, 1500)}`,
      `tool ${ok ? "result" : "error"}: ${detail}`,
    );
  }
  return transcript;
}
