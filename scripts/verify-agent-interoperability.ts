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
  "use_live_document_canvas",
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
  publicDocs.includes("maintain_project_documents") &&
    publicDocs.includes("use_live_document_canvas"),
  "Public agent docs must advertise project-document and live-canvas workflows",
);
assert(
  publicDocs.includes("idempotency"),
  "Public agent docs must explain retry-safe mutations",
);
assert(
  publicDocs.includes("command -v texttext") &&
    publicDocs.includes("/Applications/Texttext.app/Contents/MacOS/texttext"),
  "Public agent docs must tell an agent on this Mac to use the CLI, and how to find it",
);

// ---- The texttext CLI ----
//
// Local agents work through the CLI: they edit documents as files rather than
// driving a protocol. It must ship inside the app bundle, own the .textpack
// format rather than reimplementing it, write atomically, and publish presence
// automatically so an agent shows up in the document simply by working.

const source = (path: string) =>
  readFileSync(join(repositoryRoot, path), "utf8");

const packageManifest = source("mac/Package.swift");
const buildApp = source("mac/scripts/build-app.sh");
const cliMain = source("mac/Sources/TexttextCLI/main.swift");
const cliStore = source("mac/Sources/TexttextCLICore/DocumentStore.swift");
const cliPresence = source("mac/Sources/TexttextCLICore/AgentPresence.swift");

assert(
  packageManifest.includes('.executable(name: "texttext"'),
  "The texttext CLI must be a product of the Swift package",
);
assert(
  buildApp.includes('cp "$BIN/texttext" "$APP/Contents/MacOS/texttext"') &&
    buildApp.includes('codesign_one "$APP/Contents/MacOS/texttext"'),
  "The texttext CLI must be copied into the app bundle and signed",
);
assert(
  cliStore.includes("WriteTextBundlePackage") &&
    !cliStore.includes("net.daringfireball.markdown"),
  "The CLI must reuse WriteTextBundlePackage rather than reimplement the format",
);
assert(
  cliStore.includes("replaceItemAt"),
  "CLI writes must be atomic, so a crash cannot leave a partial document",
);
assert(
  cliPresence.includes("func around") && cliPresence.includes("defer"),
  "Presence must wrap the work and clear afterwards, not be a separate agent call",
);
assert(
  cliMain.includes("withPresence") &&
    /case "write", "append", "edit":/.test(cliMain),
  "Every mutating CLI command must publish presence automatically",
);

// The loopback MCP server was retired once the CLI covered its job. Keeping it
// out is the point: no port means the browser-CSRF class and the whole local
// trust problem are deleted rather than mitigated.
assert(
  !packageManifest.includes("LocalAgentServer") &&
    !source("mac/Sources/Write/WebAppWindowController.swift").includes(
      "localAgentServer",
    ),
  "The local MCP server must stay retired; agents use the texttext CLI",
);

const cliPresenceRoute = source("src/app/api/agent/presence/route.ts");
assert(
  cliPresenceRoute.includes("verifyWriteApiToken"),
  "The CLI presence route must authenticate the device token",
);
assert(
  cliPresenceRoute.includes("buildAgentPresence"),
  "The CLI presence route must use the shared presence helper",
);
assert(
  cliPresenceRoute.includes("removePresence"),
  "Finishing a command must retire the collaborator, not leave a blank row",
);

// One construction site: hosted MCP must not rebuild agent presence by hand.
const mcpTools = source("src/lib/mcp/tools.ts");assert(
  mcpTools.includes("buildAgentPresence"),
  "Hosted MCP must build agent presence through the shared helper",
);
assert(
  !mcpTools.includes("createAgentAwareness("),
  "Hosted MCP must not construct awareness by hand; use buildAgentPresence",
);

console.log(
  JSON.stringify({
    status: "pass",
    tools: requiredTools.length,
    resources: resources.size,
    prompts: prompts.size,
    endpoint: TEXTTEXT_HOSTED_MCP_URL,
    localAgentTransport: "cli",
  }),
);
