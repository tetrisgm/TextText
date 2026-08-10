// Can a model reliably turn a sentence into a working look?
//
// "Make me a Medium blog" has to produce a look that renders BOTH an opened
// post and the folder index that lists the posts. Whether the engine carries
// operations that far is pinned by src/lib/__tests__/ai-authored-blog.test.ts
// in milliseconds. What that cannot tell us is whether a model, given only
// what the product actually shows it, emits operations that survive.
//
// So this asks a real model, repeatedly, and reports a pass rate. It is an
// eval, not a test: models vary, and a number that moves is the point.
//
// The model is a local CLI (`claude -p`, or `codex exec`), so no provider key
// is spent and nothing leaves this machine. The prompt is assembled from the
// SAME tool description and JSON Schema the product hands its assistant, so
// what is measured is the product's reliability rather than a prompt written
// to flatter it.
//
//   npm run eval:looks              # 3 attempts per brief
//   npm run eval:looks -- 5 codex   # 5 attempts, via codex
//
// Nothing is written to any database and no server is started.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DocumentCollectionRenderer,
  DocumentRenderer,
} from "../src/components/document/DocumentRenderer";
import { validateDocumentSnapshot } from "../src/lib/documents/model";
import { WORKSPACE_TOOL_DEFINITIONS } from "../src/lib/ai/tools";
import {
  applyTemplateOperations,
  parseTemplateOperations,
} from "../src/lib/presentation/operations";
import {
  BUILTIN_TEMPLATES,
  requireBuiltinTemplate,
} from "../src/lib/presentation/templates";

const ATTEMPTS = Number(process.argv[2] ?? 3);
const ENGINE = (process.argv[3] ?? "claude") as "claude" | "codex";
const OUT = "/tmp/look-eval";
mkdirSync(OUT, { recursive: true });

/** Briefs a person would actually type, and the base each should start from. */
const BRIEFS = [
  {
    key: "medium-blog",
    base: "texttext.article",
    brief:
      "Make my blog read like Medium: a big serif title on the post page, and an index that lists posts as a single column of rows with the title, a one-line description and a small thumbnail.",
    // What the resulting look has to actually do, checked by rendering it.
    expect: { collectionLayout: ["list", "index"], indexHidesBody: true },
  },
  {
    key: "pinterest-gallery",
    base: "texttext.gallery",
    brief:
      "Make this folder a Pinterest-style board: the pictures lead, a dense multi-column grid of images on the index, and very little text.",
    expect: { collectionColumns: [3, 4], indexHidesBody: true },
  },
  {
    key: "reminders-tasks",
    base: "texttext.todo",
    brief:
      "Make a to-do list that looks like Apple Reminders: the list name in the accent colour, then rows with a circle, the task, and a small due date.",
    expect: { indexHidesBody: true },
  },
  {
    key: "kanban-board",
    base: "texttext.project",
    brief:
      "Give me a board view: group the items into columns by a status field with the values Todo, Doing and Done.",
    expect: { collectionLayout: ["board"], needsGroupBy: true },
  },
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exactly what the product tells a model about authoring a look. */
function toolBriefing(): string {
  const customize = WORKSPACE_TOOL_DEFINITIONS.customize_document_template;
  return [
    customize.description,
    "",
    "The `operations` array must satisfy this JSON Schema:",
    JSON.stringify(customize.jsonSchema, null, 2),
  ].join("\n");
}

function runModel(prompt: string): Promise<string> {
  const [cmd, args] =
    ENGINE === "codex"
      ? (["codex", ["exec", "--skip-git-repo-check", prompt]] as const)
      : (["claude", ["-p", prompt]] as const);
  return new Promise((resolve) => {
    const child = spawn(cmd, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 300_000);
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out);
    });
  });
}

/**
 * Pull the operations array out of whatever the CLI printed around it.
 *
 * Naively slicing from the first "[" to the last "]" fails on every real
 * transcript: the CLIs wrap the answer in tens of kilobytes of session log,
 * and the first bracket belongs to that log. So this looks for array starts
 * that plausibly begin an operations list and tries the LAST one first, which
 * is where a model's final answer lives.
 */
function extractOperations(text: string): unknown[] | null {
  const bodies: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    if (match[1]) bodies.push(match[1]);
  }
  bodies.push(text);

  for (const body of bodies.reverse()) {
    const starts: number[] = [];
    // An operations array opens with an object, so "[ {" is the shape worth
    // trying; bare "[" in prose or log lines is not.
    for (const match of body.matchAll(/\[\s*\{/g)) {
      if (match.index !== undefined) starts.push(match.index);
    }
    const ends: number[] = [];
    for (let i = body.length - 1; i >= 0; i -= 1) {
      if (body[i] === "]") ends.push(i);
    }
    for (const start of starts) {
      for (const end of ends) {
        if (end <= start) continue;
        try {
          const parsed: unknown = JSON.parse(body.slice(start, end + 1));
          // Every operation carries a string `op`. Without that check the
          // first array that happens to parse wins, and inside a render tree
          // that is always some nested `children` list.
          if (
            Array.isArray(parsed) &&
            parsed.length > 0 &&
            parsed.every(
              (entry) =>
                typeof entry === "object" &&
                entry !== null &&
                typeof (entry as { op?: unknown }).op === "string",
            )
          ) {
            return parsed;
          }
        } catch {
          // Not this pairing; keep looking.
        }
      }
    }
  }
  return null;
}

function sampleDocument(templateId: string) {
  return validateDocumentSnapshot({
    schemaVersion: 1,
    content: {
      title: "A test of the emergency broadcast system",
      body: "UNIQUE_BODY_SENTINEL that an index must not print in full.",
      tags: ["one"],
      assets: [],
      fields: {},
    },
    presentation: { template: { id: templateId, version: 1 }, theme: {} },
  });
}

type Attempt = {
  brief: string;
  attempt: number;
  emittedJson: boolean;
  parsed: boolean;
  applied: boolean;
  setsCollectionItem: boolean;
  itemRenders: boolean;
  indexRenders: boolean;
  meetsBrief: boolean;
  pass: boolean;
  note: string;
};

async function evaluate(
  spec: (typeof BRIEFS)[number],
  attempt: number,
): Promise<Attempt> {
  const result: Attempt = {
    brief: spec.key,
    attempt,
    emittedJson: false,
    parsed: false,
    applied: false,
    setsCollectionItem: false,
    itemRenders: false,
    indexRenders: false,
    meetsBrief: false,
    pass: false,
    note: "",
  };

  const base = requireBuiltinTemplate(spec.base);
  const prompt = [
    "You are the assistant inside a document app. The person asked:",
    "",
    `  "${spec.brief}"`,
    "",
    `You are customizing the built-in look "${base.name}" (id ${base.id}, version ${base.version}). Its current definition is:`,
    JSON.stringify({ fields: base.fields, item: base.item, collection: base.collection }, null, 2),
    "",
    toolBriefing(),
    "",
    "Reply with ONLY the JSON array of operations. No prose, no explanation, no code fence.",
  ].join("\n");

  const raw = await runModel(prompt);
  writeFileSync(`${OUT}/${spec.key}-${attempt}.txt`, raw);

  const operations = extractOperations(raw);
  if (!operations) {
    result.note = "no JSON array in the reply";
    return result;
  }
  result.emittedJson = true;

  let parsedOps;
  try {
    parsedOps = parseTemplateOperations(operations);
    result.parsed = true;
  } catch (error) {
    result.note = `schema rejected: ${error instanceof Error ? error.message : error}`;
    return result;
  }

  let template;
  try {
    template = applyTemplateOperations(
      { ...base, id: "eval.look", version: 1 },
      parsedOps,
    );
    result.applied = true;
  } catch (error) {
    result.note = `rebuild rejected: ${error instanceof Error ? error.message : error}`;
    return result;
  }

  // Did it do the half that everyone forgets: the folder index?
  result.setsCollectionItem = parsedOps.some(
    (op) =>
      op.op === "replace-collection-item" ||
      op.op === "set-collection-layout" ||
      op.op === "set-collection-sort",
  );

  const document = sampleDocument("eval.look");
  try {
    const itemHtml = renderToStaticMarkup(
      DocumentRenderer({ document, template }),
    );
    result.itemRenders = itemHtml.includes("emergency broadcast");
    const indexHtml = renderToStaticMarkup(
      DocumentCollectionRenderer({ document, template }),
    );
    result.indexRenders = indexHtml.includes("emergency broadcast");
    const expectations = spec.expect as Record<string, unknown>;
    const checks: boolean[] = [];
    if (Array.isArray(expectations.collectionLayout)) {
      checks.push(
        (expectations.collectionLayout as string[]).includes(
          template.collection.layout,
        ),
      );
    }
    if (Array.isArray(expectations.collectionColumns)) {
      checks.push(
        (expectations.collectionColumns as number[]).includes(
          template.collection.columns,
        ),
      );
    }
    if (expectations.needsGroupBy) {
      checks.push(Boolean(template.collection.groupBy));
    }
    if (expectations.indexHidesBody) {
      checks.push(!indexHtml.includes("UNIQUE_BODY_SENTINEL"));
    }
    result.meetsBrief = checks.every(Boolean);
  } catch (error) {
    result.note = `render failed: ${error instanceof Error ? error.message : error}`;
    return result;
  }

  result.pass =
    result.applied &&
    result.setsCollectionItem &&
    result.itemRenders &&
    result.indexRenders &&
    result.meetsBrief;
  if (!result.pass && !result.note) {
    result.note = [
      result.setsCollectionItem ? "" : "never touched the folder index",
      result.meetsBrief ? "" : "did not meet the brief's shape",
      result.indexRenders ? "" : "index rendered empty",
    ]
      .filter(Boolean)
      .join("; ");
  }
  return result;
}

async function main() {
  const rows: Attempt[] = [];
  console.log(
    `Look authoring eval: ${BRIEFS.length} briefs x ${ATTEMPTS} attempts via ${ENGINE}`,
  );
  console.log(`Built-in looks available as bases: ${BUILTIN_TEMPLATES.length}\n`);

  for (const spec of BRIEFS) {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const row = await evaluate(spec, attempt);
      rows.push(row);
      const mark = row.pass ? "PASS" : "FAIL";
      console.log(
        `${mark}  ${spec.key} #${attempt}${row.note ? `  (${row.note.slice(0, 140)})` : ""}`,
      );
      await sleep(500);
    }
  }

  console.log("\n--- reliability ---");
  for (const spec of BRIEFS) {
    const mine = rows.filter((row) => row.brief === spec.key);
    const passed = mine.filter((row) => row.pass).length;
    console.log(
      `${spec.key.padEnd(20)} ${passed}/${mine.length}` +
        `   json ${mine.filter((r) => r.emittedJson).length}` +
        `  parsed ${mine.filter((r) => r.parsed).length}` +
        `  applied ${mine.filter((r) => r.applied).length}` +
        `  index ${mine.filter((r) => r.setsCollectionItem).length}`,
    );
  }
  const total = rows.filter((row) => row.pass).length;
  console.log(`\nOVERALL ${total}/${rows.length}`);
  writeFileSync(`${OUT}/results.json`, JSON.stringify(rows, null, 2));
  console.log(`Transcripts and results in ${OUT}`);
  process.exit(total === rows.length ? 0 : 1);
}

void main();
