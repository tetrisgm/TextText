import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_TOOL_DEFINITIONS } from "../src/lib/ai/tools";
import { TEXTTEXT_HOSTED_MCP_URL } from "../src/lib/agent-integrations";
import { registerAgentSurface } from "../src/lib/mcp/agent-surface";
import {
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_VERSIONS,
} from "../src/lib/mcp/protocol";
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
  assert(
    WORKSPACE_TOOL_DEFINITIONS[name],
    `Missing shared agent tool: ${name}`,
  );
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
    publicDocs.includes(
      "/Applications/TextText.app/Contents/Helpers/texttext",
    ) &&
    publicDocs.includes("TestFlight"),
  "Public agent docs must tell an agent on this Mac to use the CLI, and how to find it",
);

// ---- The texttext CLI ----
//
// Local agents work through the CLI. The default signed-in path uses the app's
// authenticated workspace credential and the shared workspace-command surface;
// Finder/File Provider is not an auth or availability dependency. An explicit
// TEXTTEXT_WORKSPACE_ROOT retains the offline package backend for development.

const source = (path: string) =>
  readFileSync(join(repositoryRoot, path), "utf8");

const packageManifest = source("mac/Package.swift");
const buildApp = source("mac/scripts/build-app.sh");
const codexProtocol = source(
  "mac/Sources/TextTextWorkspaceCore/CodexAppServerProtocol.swift",
);
const cliMain = source("mac/Sources/TextTextCLI/main.swift");
const cliOptions = source(
  "mac/Sources/TextTextCLICore/CLICommandLineOptions.swift",
);
const cliStore = source("mac/Sources/TextTextCLICore/DocumentStore.swift");
const cliWorkspace = source("mac/Sources/TextTextCLICore/CLIWorkspace.swift");
const cliPresence = source("mac/Sources/TextTextCLICore/AgentPresence.swift");
const cliSyncAPI = source(
  "mac/Sources/TextTextFileProviderKit/LiveTextTextSyncAPI.swift",
);
const cliCommandRoute = source("src/app/api/agent/commands/route.ts");
const cliPresenceRoute = source("src/app/api/agent/presence/route.ts");
const mcpTools = source("src/lib/mcp/tools.ts");

assert(
  packageManifest.includes('.executable(name: "texttext"'),
  "The texttext CLI must be a product of the Swift package",
);
// Contents/Helpers, not Contents/MacOS. On a stock case-insensitive volume
// "texttext" and the app's own "TextText" are the same path, so shipping both
// in MacOS meant the CLI overwrote the app and the bundle's main executable WAS
// the CLI: it printed usage and exited instead of opening a window.
assert(
  buildApp.includes('cp "$BIN/texttext" "$APP/Contents/Helpers/texttext"') &&
    buildApp.includes('codesign_one "$APP/Contents/Helpers/texttext"'),
  "The texttext CLI must be copied into Contents/Helpers and signed",
);
// The Store edition ships without it, deliberately. Every nested executable in
// a Mac App Store bundle has to be sandboxed, and a sandboxed CLI runs in its
// own container rather than the app's, with its PATH symlink landing inside
// that container where no shell can reach it. Shipping it there would mean
// shipping something that cannot work, at the cost of a rejected upload.
assert(
  /if \[ "\$STORE" != "1" \]; then\s*\n\s*mkdir -p "\$APP\/Contents\/Helpers"/.test(
    buildApp,
  ),
  "The Store edition must not ship the texttext CLI",
);
assert(
  /name: "TextTextWorkspaceCore",\s*path: "Sources\/TextTextWorkspaceCore",\s*swiftSettings: editionSwiftSettings/.test(
    packageManifest,
  ),
  "Store compilation must reach the workspace core that locates native runtimes",
);
const storeRuntimeGuard = codexProtocol.indexOf("#if !TEXTTEXT_STORE");
const runtimeLocator = codexProtocol.indexOf(
  "public struct CodexRuntimeLocator",
);
const storeRuntimeGuardEnd = codexProtocol.indexOf("#endif", runtimeLocator);
assert(
  storeRuntimeGuard !== -1 &&
    storeRuntimeGuard < runtimeLocator &&
    runtimeLocator < storeRuntimeGuardEnd,
  "The Store binary must compile out local Codex executable discovery",
);
assert(
  cliStore.includes("TextTextTextBundlePackage") &&
    !cliStore.includes("net.daringfireball.markdown"),
  "The explicit offline CLI backend must reuse TextTextTextBundlePackage",
);
assert(
  cliStore.includes("replaceItemAt"),
  "Explicit offline CLI writes must remain atomic",
);
assert(
  cliWorkspace.includes('environment["TEXTTEXT_WORKSPACE_ROOT"]') &&
    cliWorkspace.includes("credentials.validatedServerOrigin") &&
    cliWorkspace.includes("throw TextTextCLIError.workspaceNotFound") &&
    !cliWorkspace.includes("CloudStorage"),
  "The default CLI must use signed-in credentials, never silently fall back to File Provider",
);
assert(
  cliMain.indexOf('if options.command == "install"') !== -1 &&
    cliMain.indexOf('if options.command == "install"') <
      cliMain.indexOf("let store: CLIWorkspace"),
  "CLI installation must not require a signed-in workspace",
);
assert(
  cliWorkspace.includes(
    "remote documents must use a workspace-relative path",
  ) &&
    cliStore.includes("private func contains") &&
    cliStore.includes("resolvingSymlinksInPath"),
  "CLI addressing must reject absolute remote paths and contain explicit local paths",
);
for (const command of [
  "read_item",
  "create_item",
  "update_item",
  "append_to_item",
]) {
  assert(
    cliCommandRoute.includes(`"${command}"`),
    `The authenticated local command route must allow ${command}`,
  );
}
assert(
  cliCommandRoute.includes("verifyTextTextApiToken") &&
    cliCommandRoute.includes('auth.scopes.includes("sync")') &&
    cliCommandRoute.includes("runWorkspaceToolForAuth") &&
    cliCommandRoute.includes("MAX_COMMAND_BODY_BYTES"),
  "The local command route must authenticate, require sync, share the executor, and bound input",
);
assert(
  cliSyncAPI.includes('"/api/agent/commands"') &&
    cliSyncAPI.includes('"if_match_hash"') &&
    cliSyncAPI.includes('"idempotency_key"'),
  "CLI mutations must use the shared command route with CAS and idempotency",
);
assert(
  cliWorkspace.includes("structuredContent?.item?.hash") &&
    cliWorkspace.includes("ifMatchHash: hash") &&
    cliWorkspace.includes("cli-create-") &&
    cliWorkspace.includes("cli-append-"),
  "The CLI must guard mutations with the command hash and stable retry keys",
);
assert(
  cliOptions.includes('case "--idempotency-key"') &&
    cliMain.includes("options.idempotencyKey"),
  "The CLI must expose a stable idempotency key for exact create and append retries",
);
assert(
  cliOptions.includes("unknown option") &&
    cliOptions.includes("needs a value") &&
    cliOptions.includes("--message requires --as"),
  "The CLI parser must reject unknown, missing-value, and unattributed intent flags",
);
assert(
  cliSyncAPI.includes('"expected_section_body"') &&
    cliWorkspace.includes("agentUpdateItemSection") &&
    mcpTools.includes("bodySection") &&
    mcpTools.includes("DocumentSectionConflictError"),
  "Section edits must use a guarded live Yjs mutation instead of a whole-document overwrite",
);
assert(
  mcpTools.includes(
    "a whole-document overwrite could be saved while it is open",
  ),
  "Whole-document writes must fail while another editor has unmaterialized changes",
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
    !source("mac/Sources/TextText/WebAppWindowController.swift").includes(
      "localAgentServer",
    ),
  "The local MCP server must stay retired; agents use the texttext CLI",
);

assert(
  cliPresenceRoute.includes("verifyTextTextApiToken") &&
    cliPresenceRoute.includes('auth.scopes.includes("sync")') &&
    cliPresenceRoute.includes("workspaceBlog(auth)") &&
    cliPresenceRoute.includes("context.handle !== blog.handle") &&
    cliPresenceRoute.includes("MAX_PRESENCE_BODY_BYTES"),
  "The CLI presence route must enforce auth, scope, tenant, and bounded input",
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
assert(
  mcpTools.includes("buildAgentPresence"),
  "Hosted MCP must build agent presence through the shared helper",
);
assert(
  !mcpTools.includes("createAgentAwareness("),
  "Hosted MCP must not construct awareness by hand; use buildAgentPresence",
);

// ---- MCP 2026-07-28 conformance ----
//
// The revision made MCP stateless: no initialize handshake, no session header,
// no GET stream. Those are the things a partial migration leaves behind, so
// assert their absence rather than trusting that the rewrite was complete.

const transport = source("src/lib/mcp/streamable-http.ts");
const protocol = source("src/lib/mcp/protocol.ts");

assert(
  MCP_PROTOCOL_VERSION === "2026-07-28" &&
    (MCP_SUPPORTED_VERSIONS as readonly string[]).includes("2026-07-28"),
  "The server must implement MCP revision 2026-07-28",
);
assert(
  !packageManifest.includes("mcp-handler") &&
    !source("package.json").includes('"mcp-handler"'),
  "mcp-handler implements the stateful pre-2026-07-28 shape and must stay removed",
);
assert(
  transport.includes('request.method !== "POST"') && transport.includes("405"),
  "GET and DELETE must answer 405: the session and standalone-stream verbs are gone",
);
assert(
  !transport.includes('"initialize"') &&
    !transport.includes("notifications/initialized"),
  "There must be no initialize handshake in the transport",
);
assert(
  !/mcp-session-id/i.test(transport),
  "Protocol-level sessions are removed; the server must not read or mint a session id",
);
assert(
  transport.includes('case "server/discover"'),
  "server/discover is a MUST for every server in this revision",
);
assert(
  protocol.includes("-32020") ||
    protocol.includes("MCP_HEADER_MISMATCH = -32020"),
  "HeaderMismatch must use the renumbered -32020",
);
assert(
  protocol.includes("MCP_UNSUPPORTED_PROTOCOL_VERSION = -32022") &&
    protocol.includes("MCP_MISSING_REQUIRED_CLIENT_CAPABILITY = -32021"),
  "The renumbered spec error codes must be -32021 and -32022",
);
assert(
  protocol.includes("MCP_RESOURCE_NOT_FOUND = JSONRPC_INVALID_PARAMS"),
  "Resource-not-found moved to -32602; -32002 is reserved and must not be emitted",
);
assert(
  protocol.includes('resultType: "complete"'),
  "Every result must carry resultType",
);
assert(
  protocol.includes("cacheScope") && protocol.includes("ttlMs"),
  "List and read results must carry the CacheableResult hints",
);
assert(
  transport.includes("subscriptions/listen"),
  "subscriptions/listen replaced the GET stream and resources/subscribe",
);
assert(
  transport.includes('request.headers.get("mcp-method")') &&
    transport.includes('request.headers.get("mcp-name")'),
  "Standard request headers must be validated against the body",
);
assert(
  source("scripts/test-token-mcp-loop.ts").includes("server/discover") &&
    source("scripts/test-token-mcp-loop.ts").includes("revokeApiToken") &&
    !/method:\s*["']initialize["']/.test(
      source("scripts/test-token-mcp-loop.ts"),
    ),
  "The workspace-token loop gate must exercise authentication, revocation, and the stateless protocol",
);

console.log(
  JSON.stringify({
    status: "pass",
    protocolVersion: MCP_PROTOCOL_VERSION,
    tools: requiredTools.length,
    resources: resources.size,
    prompts: prompts.size,
    endpoint: TEXTTEXT_HOSTED_MCP_URL,
    localAgentTransport: "cli",
  }),
);
