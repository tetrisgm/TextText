// End-to-end proof of the hosted MCP authentication contract after the OAuth
// server was retired. The test creates an isolated local workspace, mints the
// same revocable workspace token used by Connect, drives the real /api/mcp
// endpoint, revokes the token, proves it can no longer authenticate, then
// removes every scratch row it created.
//
// The raw token stays in memory and is never printed. This script refuses a
// non-local database even when run outside verify-local-live.ts.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  createApiToken,
  generateApiToken,
  revokeApiToken,
} from "../src/lib/api-tokens";
import { db } from "../src/lib/db/client";
import { actionAudit, apiTokens, blogs, folders, users } from "../src/lib/db/schema";
import { MCP_PROTOCOL_VERSION } from "../src/lib/mcp/protocol";
import { ensureWorkspaceFolders } from "../src/lib/store";

const origin = process.env.TEXTTEXT_ORIGIN ?? "http://localhost:3000";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const databaseHost = new URL(databaseUrl).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(databaseHost)) {
  throw new Error("The workspace-token evaluator refuses a non-local database.");
}
if (!db) throw new Error("The workspace-token evaluator requires a database.");
const localDb = db;

type RpcPayload = {
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string } | string;
  error_description?: string;
};

type ToolContract = {
  protocolVersion: string;
  tools: string[];
  openWorld: string[];
};

const expectedResources = new Set([
  "texttext://agent-guide",
  "texttext://workspace",
]);
const expectedResourceTemplates = new Set(["texttext://items/{id}"]);
const expectedPrompts = new Set([
  "maintain_project_documents",
  "use_live_document_canvas",
  "capture_conversation",
  "prepare_release_note",
]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameMembers(actual: unknown[], expected: Set<unknown>): boolean {
  const actualSet = new Set(actual);
  return (
    actualSet.size === expected.size &&
    [...expected].every((value) => actualSet.has(value))
  );
}

async function readPayload(response: Response): Promise<RpcPayload> {
  const text = await response.text();
  try {
    return JSON.parse(text) as RpcPayload;
  } catch {
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) {
        return JSON.parse(line.slice(5).trim()) as RpcPayload;
      }
    }
  }
  throw new Error(`MCP returned a non-JSON response with HTTP ${response.status}.`);
}

let rpcId = 0;
async function rpc(
  token: string | null,
  method: string,
  params: Record<string, unknown> = {},
  name?: string,
): Promise<{ response: Response; payload: RpcPayload }> {
  rpcId += 1;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    "Mcp-Method": method,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (name) headers["Mcp-Name"] = name;
  const response = await fetch(`${origin}/api/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: rpcId,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": {
            name: "texttext-workspace-token-eval",
            version: "1",
          },
        },
      },
    }),
  });
  return { response, payload: await readPayload(response) };
}

async function requireSuccess(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  name?: string,
): Promise<Record<string, unknown>> {
  const { response, payload } = await rpc(token, method, params, name);
  assert(response.status === 200, `${method} returned HTTP ${response.status}.`);
  const errorMessage =
    typeof payload.error === "string"
      ? payload.error
      : payload.error?.message;
  assert(!payload.error, `${method} returned ${errorMessage ?? "an error"}.`);
  assert(payload.result, `${method} returned no result.`);
  assert(payload.result.resultType === "complete", `${method} omitted resultType=complete.`);
  return payload.result;
}

async function requireUnauthorized(token: string | null, label: string) {
  const { response, payload } = await rpc(token, "server/discover");
  const challenge = response.headers.get("www-authenticate") ?? "";
  assert(response.status === 401, `${label} returned HTTP ${response.status}, not 401.`);
  assert(
    payload.error === "invalid_token" &&
      payload.error_description === "A valid bearer token is required",
    `${label} did not return the workspace-token authentication error.`,
  );
  assert(
    challenge.includes("resource_documentation=") &&
      !challenge.toLowerCase().includes("authorization_server"),
    `${label} did not point directly to workspace-token documentation.`,
  );
}

async function main() {
  const contract = JSON.parse(
    await readFile(join(process.cwd(), "scripts/generated/mcp-tool-contract.json"), "utf8"),
  ) as ToolContract;
  assert(
    contract.protocolVersion === MCP_PROTOCOL_VERSION,
    "The generated tool contract has a different MCP protocol version.",
  );

  const stamp = `${Date.now().toString(36)}-${process.pid}`;
  const subject = `workspace-token-eval-${stamp}`;
  const handle = `workspace-token-eval-${stamp}`;
  let userId = "";
  let blogId = "";
  let summary: Record<string, unknown> | null = null;

  try {
    const [user] = await localDb
      .insert(users)
      .values({
        appleSub: subject,
        username: handle,
        email: `${handle}@example.invalid`,
        name: "Workspace Token Eval",
      })
      .returning({ id: users.id });
    assert(user, "Failed to create the scratch user.");
    userId = user.id;

    const [blog] = await localDb
      .insert(blogs)
      .values({ handle, name: "Workspace Token Eval", ownerId: userId })
      .returning({ id: blogs.id });
    assert(blog, "Failed to create the scratch workspace.");
    blogId = blog.id;
    await ensureWorkspaceFolders(blogId);

    await requireUnauthorized(null, "A request without a workspace token");
    await requireUnauthorized(
      generateApiToken(),
      "A request with an unknown workspace token",
    );

    const first = await createApiToken(userId, "Workspace token live eval");

    const discovered = await requireSuccess(first.raw, "server/discover");
    assert(
      Array.isArray(discovered.supportedVersions) &&
        discovered.supportedVersions.includes(MCP_PROTOCOL_VERSION),
      "server/discover did not advertise the active protocol version.",
    );

    const listed = await requireSuccess(first.raw, "tools/list");
    const tools = Array.isArray(listed.tools)
      ? (listed.tools as Array<Record<string, unknown>>)
      : [];
    const toolNames = tools.map((tool) => tool.name);
    assert(
      JSON.stringify(toolNames) === JSON.stringify(contract.tools),
      "tools/list differs from the generated MCP tool contract.",
    );
    for (const tool of tools) {
      const annotations = tool.annotations as Record<string, unknown> | undefined;
      assert(
        annotations &&
          typeof annotations.readOnlyHint === "boolean" &&
          typeof annotations.destructiveHint === "boolean" &&
          typeof annotations.idempotentHint === "boolean" &&
          typeof annotations.openWorldHint === "boolean",
        `Tool ${String(tool.name)} has incomplete annotations.`,
      );
      assert(
        annotations.openWorldHint === contract.openWorld.includes(String(tool.name)),
        `Tool ${String(tool.name)} has the wrong openWorldHint.`,
      );
    }

    const resources = await requireSuccess(first.raw, "resources/list");
    const resourceUris = Array.isArray(resources.resources)
      ? (resources.resources as Array<Record<string, unknown>>).map((item) => item.uri)
      : [];
    assert(
      sameMembers(resourceUris, expectedResources),
      "resources/list differs from the public MCP resource contract.",
    );

    const templates = await requireSuccess(first.raw, "resources/templates/list");
    const templateUris = Array.isArray(templates.resourceTemplates)
      ? (templates.resourceTemplates as Array<Record<string, unknown>>).map(
          (item) => item.uriTemplate,
        )
      : [];
    assert(
      sameMembers(templateUris, expectedResourceTemplates),
      "resources/templates/list differs from the public MCP resource contract.",
    );

    const prompts = await requireSuccess(first.raw, "prompts/list");
    const promptNames = Array.isArray(prompts.prompts)
      ? (prompts.prompts as Array<Record<string, unknown>>).map((item) => item.name)
      : [];
    assert(
      sameMembers(promptNames, expectedPrompts),
      "prompts/list differs from the public MCP prompt contract.",
    );

    const workspaceResult = await requireSuccess(
      first.raw,
      "tools/call",
      { name: "get_workspace", arguments: {} },
      "get_workspace",
    );
    const content = Array.isArray(workspaceResult.content)
      ? (workspaceResult.content as Array<{ text?: string }>)[0]?.text
      : undefined;
    assert(typeof content === "string", "get_workspace returned no text content.");
    const workspace = JSON.parse(content) as { workspace?: { handle?: string } };
    assert(
      workspace.workspace?.handle === handle,
      "The workspace token reached a different workspace.",
    );

    assert(
      await revokeApiToken(userId, first.record.id),
      "The live workspace token could not be revoked.",
    );
    await requireUnauthorized(first.raw, "A revoked workspace token");

    const replacement = await createApiToken(
      userId,
      "Replacement workspace token live eval",
    );
    await requireSuccess(replacement.raw, "server/discover");
    assert(
      await revokeApiToken(userId, replacement.record.id),
      "The replacement workspace token could not be revoked.",
    );

    summary = {
      status: "pass",
      authentication: "workspace-token",
      protocolVersion: MCP_PROTOCOL_VERSION,
      tools: toolNames.length,
      resources: resourceUris.length,
      resourceTemplates: templateUris.length,
      prompts: promptNames.length,
      revocation: "proven",
      replacement: "proven",
      cleanup: "proven",
      databaseHost,
    };
  } finally {
    if (userId) {
      await localDb.delete(apiTokens).where(eq(apiTokens.userId, userId));
    }
    if (blogId) {
      await localDb.delete(folders).where(eq(folders.blogId, blogId));
      await localDb.delete(blogs).where(eq(blogs.id, blogId));
    }
    if (userId) {
      // Token creation and revocation are audited with the actor, and the
      // audit column has no cascade: remove this scratch user's trail first.
      await localDb.delete(actionAudit).where(eq(actionAudit.actorUserId, userId));
      await localDb.delete(users).where(eq(users.id, userId));
    }
  }
  assert(summary, "The workspace-token evaluator produced no result.");
  console.log(JSON.stringify(summary));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
