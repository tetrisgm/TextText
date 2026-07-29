import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_TOOL_DEFINITIONS } from "../src/lib/ai/tools";
import { LOCAL_AGENT_BRIDGE_VERSION } from "../src/lib/ai/local-agent-bridge";
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

// ---- Agent identity transport ----
//
// A local Codex or Claude session must appear as a NAMED collaborator with its
// provider avatar and cursor, which requires the caller identity to survive
// every hop: MCP initialize -> Swift -> the page bridge -> the tool executor ->
// the presence route. Each hop is asserted structurally here so a future build
// that silently drops the actor fails the release gate instead of quietly
// degrading every local agent back to an anonymous editor.

const source = (path: string) =>
  readFileSync(join(repositoryRoot, path), "utf8");

assert(
  LOCAL_AGENT_BRIDGE_VERSION >= 2,
  "The local agent bridge must advertise the actor-carrying version",
);

const localAgentServer = source("mac/Sources/Write/LocalAgentServer.swift");
assert(
  localAgentServer.includes("clientInfo"),
  "The native MCP server must retain initialize.params.clientInfo",
);
assert(
  /__TEXTTEXT_AGENT_BRIDGE__\.call\(\s*\n?\s*name,\s*args,\s*"local-mcp",\s*actor/.test(
    localAgentServer,
  ),
  "The native MCP server must forward the agent actor into the page bridge",
);
assert(
  localAgentServer.includes("identityCacheLimit") &&
    localAgentServer.includes("identityCacheTTL"),
  "The native agent identity cache must stay bounded and expiring",
);
assert(
  localAgentServer.includes('request.headers["user-agent"]'),
  "The native MCP server must fall back to the user agent for identity",
);

// ---- Tier 0 transport guard ----
//
// Loopback binding is a routing property, not a trust boundary: every browser
// on the machine can reach the port. Before this guard, a page could POST with
// a CORS-safelisted content type, skip the preflight, and reach the tool
// dispatcher. These assertions keep that closed.
assert(
  /nonisolated static func rejection\(for request: LocalAgentHTTPRequest\)/.test(
    localAgentServer,
  ),
  "The native MCP server must expose a pure transport guard the health check and tests can run",
);
assert(
  localAgentServer.includes("var isBrowserOriginated: Bool") &&
    localAgentServer.includes('headers["origin"]') &&
    localAgentServer.includes('headers["sec-fetch-site"]'),
  "The native MCP server must refuse browser-originated requests (Origin / Sec-Fetch-Site)",
);
assert(
  localAgentServer.includes("var hasJSONContentType: Bool") &&
    localAgentServer.includes('mediaType == "application/json"'),
  "The native MCP server must require application/json, which is what forces a browser preflight",
);
assert(
  localAgentServer.includes('request.method == "OPTIONS"') &&
    localAgentServer.includes('"Allow": "GET, POST"'),
  "The native MCP server must answer preflights with 405 and no CORS headers",
);
// A quoted header name would be an actual emitted header; prose in a comment
// explaining why we never emit one is fine and should stay.
assert(
  !/"Access-Control-/i.test(localAgentServer),
  "The native MCP server must never emit an Access-Control-* header",
);
assert(
  !localAgentServer.includes(`|| host == "localhost:\\(LocalAgentServer.port)"`),
  "The native MCP server must accept numeric loopback hosts only",
);
assert(
  localAgentServer.includes("requestTimeout") &&
    localAgentServer.includes("maxConcurrentConnections"),
  "The native MCP server must bound request duration and concurrent connections",
);

// ---- The texttext CLI ----
//
// The CLI is how local agents work with the workspace: they edit documents as
// files instead of driving a protocol. It must ship inside the app bundle, own
// the .textpack invariants rather than reimplementing them, and publish presence
// automatically so an agent shows up in the document simply by working.
const cliMain = source("mac/Sources/TexttextCLI/main.swift");
const cliStore = source("mac/Sources/TexttextCLICore/DocumentStore.swift");
const cliPresence = source("mac/Sources/TexttextCLICore/AgentPresence.swift");
const packageManifest = source("mac/Package.swift");
const buildApp = source("mac/scripts/build-app.sh");

assert(
  packageManifest.includes('.executable(name: "texttext"') &&
    packageManifest.includes('.executableTarget(\n            name: "TexttextCLI"'),
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

const healthReporter = source("mac/Sources/Write/AppHealthReporter.swift");
assert(
  healthReporter.includes("LocalAgentServer.rejection(for:") &&
    healthReporter.includes("refuses_browser_origin") &&
    healthReporter.includes("refuses_non_json"),
  "App health must assert the real transport guard, not loopback binding as a proxy for safety",
);
assert(
  !healthReporter.includes("loopback_only"),
  "App health must stop reporting loopback_only as the local MCP security property",
);

const agentTools = source("src/lib/ai/agent-tools.ts");
assert(
  agentTools.includes("signalAgentActivity"),
  "Workspace agent tools must accept a presence signal callback",
);
for (const [tool, marker] of [
  ["open_item", '{ kind: "open", field: "body" }'],
  ["update_item", 'kind: "edit", field: editedField(input)'],
  ["append_to_item", '{ kind: "edit", field: "body" }'],
] as const) {
  assert(
    agentTools.includes(marker),
    `Local ${tool} must publish agent presence before it runs`,
  );
}

const presenceRoute = source(
  "src/app/api/collab/[postId]/agent-presence/route.ts",
);
assert(
  presenceRoute.includes("getCollabRequestAccess") &&
    presenceRoute.includes('access.role !== "editor"'),
  "The agent presence route must require a signed-in editor",
);
assert(
  presenceRoute.includes("buildAgentPresence"),
  "The agent presence route must use the shared presence helper",
);

// One construction site: hosted MCP must not rebuild agent presence by hand.
const mcpTools = source("src/lib/mcp/tools.ts");
assert(
  mcpTools.includes("buildAgentPresence") &&
    !mcpTools.includes("createAgentAwareness("),
  "Hosted MCP must build agent presence through the shared helper",
);

console.log(
  JSON.stringify({
    status: "pass",
    tools: requiredTools.length,
    resources: resources.size,
    prompts: prompts.size,
    endpoint: TEXTTEXT_HOSTED_MCP_URL,
    agentIdentityTransport: "verified",
    localAgentBridgeVersion: LOCAL_AGENT_BRIDGE_VERSION,
  }),
);
