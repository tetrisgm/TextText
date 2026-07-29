// Regenerate the tool enumerations in the Markdown docs from the registry.
//
// `docs/mcp.md` and `docs/ai-sidebar-architecture.md` used to list the tool
// names and counts by hand. They drifted: both claimed 31 tools when there were
// 30, both named a `list_item_assets` that does not exist, and one listed five
// other tools that were removed. A reader following those docs would call
// nothing. Now `src/lib/ai/tools.ts` is the only place a tool is named, and the
// docs carry generated blocks between markers.
//
//   npx tsx scripts/sync-tool-docs.ts           regenerate
//   npx tsx scripts/sync-tool-docs.ts --check   fail if stale (release gate)

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_TOOL_DEFINITIONS } from "../src/lib/ai/tools";
import { repositoryRoot } from "./work-unit";

type ToolName = keyof typeof WORKSPACE_TOOL_DEFINITIONS;

const names = Object.keys(WORKSPACE_TOOL_DEFINITIONS) as ToolName[];
const readScope = names.filter(
  (name) => WORKSPACE_TOOL_DEFINITIONS[name].requiredScope === "read",
);
const syncScope = names.filter(
  (name) => WORKSPACE_TOOL_DEFINITIONS[name].requiredScope === "sync",
);

const numbered = (list: string[]) =>
  list.map((name, index) => `${index + 1}. \`${name}\``).join("\n");

/** Each entry replaces everything between its markers in one file. */
const blocks: Array<{ file: string; marker: string; body: string }> = [
  {
    file: "docs/ai-sidebar-architecture.md",
    marker: "tool-contract",
    body: [
      `## Shared ${names.length}-tool contract`,
      "",
      `The ${readScope.length} read-scope tools are:`,
      "",
      numbered(readScope),
      "",
      `The ${syncScope.length} sync-scope tools are:`,
      "",
      numbered(syncScope),
    ].join("\n"),
  },
  {
    file: "docs/mcp.md",
    marker: "tool-source",
    body: [
      `\`src/lib/ai/tools.ts\` is the source of truth for the ${names.length} tool`,
      "names, schemas, mutability, confirmation requirements, and MCP",
      "annotations. The MCP adapter registers those definitions in",
      "`src/lib/mcp/tools.ts`.",
    ].join("\n"),
  },
  {
    file: "docs/mcp.md",
    marker: "scope-table",
    body: [
      "| Scope | Access |",
      "|-------|--------|",
      `| \`read\` | Call the ${readScope.length} read-scope tools: ${readScope
        .map((name) => `\`${name}\``)
        .join(", ")}. |`,
      `| \`sync\` | Call all ${names.length} tools, including the ${syncScope.length} that mutate content or read administration data. It also grants every \`read\` operation. |`,
    ].join("\n"),
  },
];

function render(file: string): string {
  const path = join(repositoryRoot, file);
  let text = readFileSync(path, "utf8");
  for (const block of blocks.filter((entry) => entry.file === file)) {
    const open = `<!-- generated:${block.marker} -->`;
    const close = `<!-- /generated:${block.marker} -->`;
    const start = text.indexOf(open);
    const end = text.indexOf(close);
    if (start < 0 || end < 0) {
      throw new Error(`${file} is missing the ${block.marker} markers`);
    }
    text = `${text.slice(0, start + open.length)}\n${block.body}\n${text.slice(end)}`;
  }
  return text;
}

const files = [...new Set(blocks.map((block) => block.file))];
const checking = process.argv.includes("--check");
let stale = false;

for (const file of files) {
  const path = join(repositoryRoot, file);
  const rendered = render(file);
  if (checking) {
    if (readFileSync(path, "utf8") !== rendered) {
      console.error(`${file} is stale. Run: npx tsx scripts/sync-tool-docs.ts`);
      stale = true;
    }
  } else {
    writeFileSync(path, rendered, "utf8");
  }
}

if (stale) process.exit(1);
console.log(
  JSON.stringify({
    status: checking ? "current" : "written",
    tools: names.length,
    read: readScope.length,
    sync: syncScope.length,
  }),
);
