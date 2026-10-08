import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import * as Y from "yjs";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { documentSnapshotFromYDoc } from "@/lib/collab/document";
import { parseWorkspaceToolInput } from "@/lib/ai/tools";
import { buildTextpack } from "@/lib/github/textpack";
import { writeVaultTextpack, readVaultCollaboration, readVaultTextpack } from "@/sync/engine/store";
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
  it("checks revocation inside the commit lock even when replaying a successful command", async () => {
    const args = { id: itemId, markdown: "Once", if_match_hash: revision, idempotency_key: "replay-revocation" };
    await mutateVaultTool("append_to_item", args, context());
    authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked under lock"));
    await expect(mutateVaultTool("append_to_item", args, context())).rejects.toThrow("revoked under lock");
    expect(await body()).toBe("Human original\n\nOnce");
  });
  it("serializes competing full replacements and preserves opaque files on section edits", async () => {
    const attempts = await Promise.allSettled(["One", "Two"].map((body) => mutateVaultTool("update_item", { id: itemId, body, if_match_hash: revision }, context())));
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const current = await readVaultTextpack({ root, workspaceId: "workspace", itemId });
    const document = emptyDocumentSnapshot(); document.content.body = "# Heading\n\nOld section";
    const asset = new Uint8Array([0, 255, 17, 4]);
    const saved = await writeVaultTextpack({ root, workspaceId: "workspace", itemId, operationId: "opaque-fixture", relativePath: "Notes/A.textpack", baseRevision: current!.revision,
      bytes: buildTextpack("Note", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\n${document.content.body}`, files: { "assets/opaque.bin": asset } }) });
    await mutateVaultTool("update_item", { id: itemId, section: "Heading", expected_section_body: "Old section", body: "New section", if_match_hash: saved.revision }, context());
    const pack = await readVaultTextpack({ root, workspaceId: "workspace", itemId });
    expect(unzipSync(pack!.bytes)["Note.textbundle/assets/opaque.bin"]).toEqual(asset);
    expect(await body()).toContain("New section");
  });
  it("creates a readable deterministic file and replays create without duplication", async () => {
    const args = parseWorkspaceToolInput("create_item", { title: "New note", kind: "note", idempotency_key: "event" });
    const first = await mutateVaultTool("create_item", args, context());
    expect(await mutateVaultTool("create_item", args, context())).toEqual(first);
    expect(first.relativePath).toMatch(/^Notes\/New note-[a-f0-9]{8}\.textpack$/);
  });
  it("captures plain text and URLs into canonical files without fetching", async () => {
    for (const [capture, folder, kind] of [["Remember this\nThe complete thought.", "Notes", "note"], ["https://example.com/article", "Bookmarks", "bookmark"]]) {
      const args = parseWorkspaceToolInput("create_item", { capture, idempotency_key: capture });
      const result = await mutateVaultTool("create_item", args, context());
      expect(result.relativePath).toMatch(new RegExp(`^${folder}/`));
      expect(await mutateVaultTool("create_item", args, context())).toEqual(result);
      const pack = await readVaultTextpack({ root, workspaceId: "workspace", itemId: result.itemId });
      const entries = unzipSync(pack!.bytes);
      const document = JSON.parse(new TextDecoder().decode(entries["Document.textbundle/document.json"]));
      expect(document.presentation.template.id).toBe(`texttext.${kind}`);
      if (kind === "bookmark") expect(document.content.fields.sourceUrl).toBe(capture);
      else expect(document.content.body).toBe("The complete thought.");
    }
  });
  it("imports Markdown frontmatter and body with a fresh stable file identity", async () => {
    const markdown = '---\ntitle: Imported note\ntype: note\ntags: ["one", "two"]\nexcerpt: Summary\ncustomKey: preserved\n---\n\n# Body\n\nKeep this exactly.';
    const result = await mutateVaultTool("create_item", { markdown, idempotency_key: "markdown-import" }, context());
    const pack = await readVaultTextpack({ root, workspaceId: "workspace", itemId: result.itemId });
    const entries = unzipSync(pack!.bytes);
    const document = JSON.parse(new TextDecoder().decode(entries["Document.textbundle/document.json"]));
    expect(document.content).toMatchObject({ title: "Imported note", subtitle: "Summary", tags: ["one", "two"], body: "# Body\n\nKeep this exactly." });
    expect(new TextDecoder().decode(entries["Document.textbundle/text.md"])).toContain("customKey: preserved");
    expect(await mutateVaultTool("create_item", { markdown, idempotency_key: "markdown-import" }, context())).toEqual(result);
    await expect(mutateVaultTool("create_item", { markdown: '---\nstatus: published\n---\nBody' }, context())).rejects.toThrow("private");
    await expect(mutateVaultTool("create_item", { capture: "https://user:secret@example.com" }, context())).rejects.toThrow("without credentials");
  });
  it("fails closed on unsupported metadata and unsafe folders", async () => {
    await expect(mutateVaultTool("update_item", { id: itemId, status: "published" }, context())).rejects.toThrow("Unsupported");
    await expect(mutateVaultTool("create_item", { folder_path: "../private" }, context())).rejects.toThrow("Invalid folder");
  });
});
