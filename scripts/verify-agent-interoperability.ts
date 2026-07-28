import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_TOOL_DEFINITIONS } from "../src/lib/ai/tools";
import { TEXTTEXT_HOSTED_MCP_URL } from "../src/lib/agent-integrations";
import { registerAgentSurface } from "../src/lib/mcp/agent-surface";
import { repositoryRoot } from "./work-unit";

const requiredTools = [
  "get_workspace",
  "list_folders",
  "list_items",
  "read_item",
  "search",
  "create_item",
  "update_item",
  "append_to_item",
  "set_item_status",
  "move_item",
  "delete_item",
  "restore_item",
  "list_comments",
  "add_comment",
  "list_access",
  "set_access",
  "revoke_access",
] as const;

const resources = new Set<string>();
const prompts = new Set<string>();
const fakeServer = {
  registerResource(name: string) {
    resources.add(name);
  },
  registerPrompt(name: string) {
    prompts.add(name);
  },
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

for (const name of requiredTools) {
  assert(WORKSPACE_TOOL_DEFINITIONS[name], `Missing shared agent tool: ${name}`);
}

assert(
  WORKSPACE_TOOL_DEFINITIONS.create_item.inputSchema.safeParse({
    folder_path: "notes",
    title: "Project changelog",
    idempotency_key: "workspace:project:stable-id",
  }).success,
  "create_item must accept an idempotency_key",
);
assert(
  WORKSPACE_TOOL_DEFINITIONS.append_to_item.inputSchema.safeParse({
    id: "00000000-0000-4000-8000-000000000000",
    markdown_fragment: "## Update",
    idempotency_key: "workspace:event:stable-id",
  }).success,
  "append_to_item must accept an idempotency_key",
);

registerAgentSurface(fakeServer as never);

for (const name of [
  "texttext-agent-guide",
  "texttext-workspace",
  "texttext-item",
]) {
  assert(resources.has(name), `Missing MCP resource: ${name}`);
}
for (const name of [
  "maintain_project_documents",
  "capture_conversation",
  "prepare_release_note",
]) {
  assert(prompts.has(name), `Missing MCP prompt: ${name}`);
}

const publicDocs = [
  readFileSync(join(repositoryRoot, "src/app/docs/ai/page.tsx"), "utf8"),
  readFileSync(join(repositoryRoot, "src/app/llms.txt/route.ts"), "utf8"),
].join("\n");
assert(
  TEXTTEXT_HOSTED_MCP_URL === "https://texttext.app/api/mcp" &&
    publicDocs.includes("TEXTTEXT_HOSTED_MCP_URL"),
  "Public agent docs must advertise the production MCP endpoint",
);
assert(
  publicDocs.includes("maintain_project_documents"),
  "Public agent docs must advertise the project-document workflow",
);
assert(
  publicDocs.includes("idempotency"),
  "Public agent docs must explain retry-safe mutations",
);

console.log(
  JSON.stringify({
    status: "pass",
    tools: requiredTools.length,
    resources: resources.size,
    prompts: prompts.size,
    endpoint: TEXTTEXT_HOSTED_MCP_URL,
  }),
);
