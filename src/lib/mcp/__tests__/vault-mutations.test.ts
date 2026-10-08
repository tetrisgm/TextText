import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { documentSnapshotFromYDoc } from "@/lib/collab/document";
import { parseWorkspaceToolInput } from "@/lib/ai/tools";
import { buildTextpack } from "@/lib/github/textpack";
import { writeVaultTextpack, readVaultCollaboration } from "@/sync/engine/store";
vi.mock("@/lib/store", async () => {
  const engine = await import("@/sync/engine/store");
  return {
    getUserIdBySub: async () => "actor", getOwnedBlog: async () => ({ handle: "fixture", name: "Fixture" }), getBlogEditRecord: async () => ({ id: "workspace", ownerId: "actor" }),
    readVaultTextpackIdentity: engine.readVaultTextpackIdentity,
    mutateVaultDocument: (input: Parameters<typeof engine.mutateVaultDocument>[0] & { actorUserId: string }) => engine.mutateVaultDocument({ ...input, audit: { actorUserId: input.actorUserId, actorType: "external_agent" }, onReceipt: async () => {} }),
    writeVaultTextpack: (input: Parameters<typeof engine.writeVaultTextpack>[0] & { actorUserId: string }) => engine.writeVaultTextpack({ ...input, audit: { actorUserId: input.actorUserId, actorType: "external_agent" }, onReceipt: async () => {} }),
  };
});
vi.mock("@/auth", () => ({ auth: vi.fn(), isAuthConfigured: () => false }));
vi.mock("../vault-agent-presence", () => ({ withVaultAgentPresence: async (_context: unknown, action: () => Promise<unknown>) => action() }));
import { mutateVaultTool } from "../vault-mutations";
let root: string, revision: string;
const itemId = "11111111-1111-4111-8111-111111111111";
const authorize = vi.fn(async () => {});
const context = () => ({ root, workspaceId: "workspace", actorUserId: "actor", authorize });
beforeEach(async () => {
  vi.clearAllMocks(); root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-agent-command-"));
  const document = emptyDocumentSnapshot(); document.content.body = "Human original";
  const saved = await writeVaultTextpack({ root, workspaceId: "workspace", itemId, operationId: "seed", relativePath: "Notes/A.textpack", baseRevision: null, bytes: buildTextpack("Note", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\nHuman original` }) }); revision = saved.revision!;
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
async function body() {
  const state = await readVaultCollaboration({ root, workspaceId: "workspace", itemId });
  const doc = new Y.Doc(); try { Y.applyUpdate(doc, Buffer.from(state!.update, "base64")); return documentSnapshotFromYDoc(doc).content.body; } finally { doc.destroy(); }
}
describe("durable file MCP commands through public input schemas", () => {
  it("routes documented public append through the canonical executor to a real file", async () => {
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", root);
    const { executeMcpTool } = await import("../tools");
    const authInfo = { token: "test", clientId: "test", scopes: ["sync"], extra: { sub: "subject", userId: "actor", connectionId: "test-connection" } };
    const result = await executeMcpTool("append_to_item", { id: itemId, markdown: "Public append", if_match_hash: revision, idempotency_key: "public-event" }, { authInfo });
    expect(result.isError).not.toBe(true);
    expect(await body()).toBe("Human original\n\nPublic append");
    vi.unstubAllEnvs();
  });
  it("replays a lost append acknowledgement exactly once despite the stale original hash", async () => {
    const args = parseWorkspaceToolInput("append_to_item", { id: itemId, markdown: "Agent append", if_match_hash: revision, idempotency_key: "event" });
    const first = await mutateVaultTool("append_to_item", args, context());
    const second = await mutateVaultTool("append_to_item", args, context());
    expect(second).toEqual(first); expect(await body()).toBe("Human original\n\nAgent append");
    await expect(mutateVaultTool("append_to_item", { ...args, markdown: "different" }, context())).rejects.toThrow("Operation id was reused");
  });
  it("rejects stale replacement and revoked replay without losing the original", async () => {
    const args = parseWorkspaceToolInput("update_item", { id: itemId, body: "Replace", if_match_hash: "a".repeat(64) });
    await expect(mutateVaultTool("update_item", args, context())).rejects.toThrow("changed");
    expect(await body()).toBe("Human original");
    authorize.mockRejectedValueOnce(new Error("revoked"));
    await expect(mutateVaultTool("update_item", { ...args, if_match_hash: revision }, context())).rejects.toThrow("revoked");
  });
  it("creates a readable deterministic file and replays create without duplication", async () => {
    const args = parseWorkspaceToolInput("create_item", { title: "New note", kind: "note", idempotency_key: "event" });
    const first = await mutateVaultTool("create_item", args, context());
    expect(await mutateVaultTool("create_item", args, context())).toEqual(first);
    expect(first.relativePath).toMatch(/^Notes\/New note-[a-f0-9]{8}\.textpack$/);
  });
  it("fails closed on unsupported metadata and unsafe folders", async () => {
    await expect(mutateVaultTool("update_item", { id: itemId, status: "published" }, context())).rejects.toThrow("Unsupported");
    await expect(mutateVaultTool("create_item", { folder_path: "../private" }, context())).rejects.toThrow("Invalid folder");
  });
});
