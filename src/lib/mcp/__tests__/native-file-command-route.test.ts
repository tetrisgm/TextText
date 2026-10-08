import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
const mocks = vi.hoisted(() => ({ audit: vi.fn(async () => {}), presence: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAuthConfigured: () => false }));
vi.mock("@/app/api/sync/v1/auth", () => ({ resolveSyncWorkspace: async () => ({ sub: "subject", userId: "owner", blog: { handle: "fixture" } }) }));
vi.mock("../vault-agent-presence", () => ({ withVaultAgentPresence: mocks.presence }));
vi.mock("@/lib/store", async () => {
  const engine = await import("@/sync/engine/store");
  return {
    getUserIdBySub: async () => "owner", getOwnedBlog: async () => ({ handle: "fixture", name: "Fixture" }), getBlog: async () => ({ handle: "fixture", name: "Fixture" }), getBlogEditRecord: async () => ({ id: "workspace", ownerId: "owner" }),
    listVaultTextpacks: engine.listVaultTextpacks,
    createVaultFolder: (input: Parameters<typeof engine.createVaultFolder>[0] & { actorUserId: string; actorType: "human" | "external_agent" }) => engine.createVaultFolder({ ...input, audit: { actorUserId: input.actorUserId, actorType: input.actorType }, onReceipt: mocks.audit }),
    readVaultPreview: async (input: Parameters<typeof engine.readVaultTextpack>[0]) => { const pack = await engine.readVaultTextpack(input); return pack ? { ...await (await import("@/lib/vault/pack-preview.server")).previewTextpack(pack.bytes, true), sourceBytes: pack.bytes.byteLength } : null; },
    searchVaultTextpacks: async (input: Parameters<typeof engine.listVaultTextpacks>[0], entries: { itemId: string }[], query: string) => {
      const items = [];
      for (const entry of entries) { const pack = await engine.readVaultTextpack({ ...input, itemId: entry.itemId }); if (!pack) continue; const preview = await (await import("@/lib/vault/pack-preview.server")).previewTextpack(pack.bytes, true); if ((preview.title + preview.excerpt).includes(query)) items.push({ path: pack.relativePath, title: preview.title, snippet: preview.excerpt }); }
      return { items, truncated: false };
    },
    readVaultTextpackIdentity: engine.readVaultTextpackIdentity, readVaultTextpack: engine.readVaultTextpack,
    mutateVaultDocument: (input: Parameters<typeof engine.mutateVaultDocument>[0] & { actorUserId: string; actorType: "human" | "external_agent" }) => engine.mutateVaultDocument({ ...input, audit: { actorUserId: input.actorUserId, actorType: input.actorType }, onReceipt: mocks.audit }),
    writeVaultTextpack: (input: Parameters<typeof engine.writeVaultTextpack>[0] & { actorUserId: string; actorType: "human" | "external_agent" }) => engine.writeVaultTextpack({ ...input, audit: { actorUserId: input.actorUserId, actorType: input.actorType }, onReceipt: mocks.audit }),
  };
});
import { POST } from "@/app/api/app/commands/route";
let root: string;
beforeEach(async () => { vi.clearAllMocks(); root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-native-contract-")); vi.stubEnv("TEXTTEXT_VAULT_ROOT", root); });
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
async function command(name: string, args: Record<string, unknown>) {
  const response = await POST(new Request("https://texttext.app/api/app/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, args }) }));
  const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(200); return result.result;
}
describe("native file command response and human attribution", () => {
  it("creates an empty folder through the native route and replays the same receipt", async () => {
    const args = { parent_path: "", name: "Empty folder", idempotency_key: "native-folder" };
    const created = await command("create_folder", args);
    expect(created).toEqual({ status: "folder_created", relativePath: "Empty folder" });
    expect(await command("create_folder", args)).toEqual(created);
    const { listVaultTextpacks } = await import("@/sync/engine/store");
    const manifest = await listVaultTextpacks({ root, workspaceId: "workspace" });
    expect(manifest.folders).toContain("Empty folder");expect(manifest.items).toEqual([]);
    expect(mocks.presence).not.toHaveBeenCalled();
    for (const [receipt] of mocks.audit.mock.calls as unknown as [{ actorType: string }][]) expect(receipt.actorType).toBe("human");
  });

  it("creates, reads and appends through the actual native route with stable public fields", async () => {
    const created = await command("create_item", { title: "Native note", body: "Human body", kind: "note", idempotency_key: "create" });
    expect(created.item.id).toMatch(/^[a-f0-9-]{36}$/); expect(created.itemId).toBe(created.item.id);
    expect(created.item.hash).toBe(created.revision); expect(created.item.title).toBe("Native note");
    const first = await command("read_item", { id: created.item.id });
    expect(first.markdown).toContain("Human body"); expect(first.item.hash).toBe(created.item.hash);
    const append = { id: created.item.id, markdown: "Native append", if_match_hash: first.item.hash, idempotency_key: "append" };
    const written = await command("append_to_item", append);
    expect(written.item.id).toBe(created.item.id); expect(written.item.title).toBe("Native note");
    expect(await command("append_to_item", append)).toEqual(written);
    const read = await command("read_item", { id: created.item.id });
    expect(read.markdown).toContain("Human body\n\nNative append");
    expect(mocks.presence).not.toHaveBeenCalled();
    expect(mocks.audit.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [receipt] of mocks.audit.mock.calls as unknown as [{ actorType: string }][]) expect(receipt.actorType).toBe("human");
  });
  it("decodes create, capture, read, append and search using the production Swift response structs", async () => {
    const created = await command("create_item", { title: "Native decoder", body: "needle", kind: "note" });
    const captured = await command("create_item", { capture: "Capture decoder needle", idempotency_key: "capture" });
    expect(captured.receipt).toMatchObject({ item_id: captured.item.id, kind: "note", saved_to: "Notes", title: captured.item.title, path: captured.item.path });
    const read = await command("read_item", { id: created.item.id });
    const appended = await command("append_to_item", { id: created.item.id, markdown: "next", if_match_hash: read.item.hash });
    const search = await command("search", { query: "needle" });
    expect(search.results).toHaveLength(2);
    expect(search.results[0]).toMatchObject({ slug: expect.any(String), kind: "note", status: "draft", folder_path: "Notes", hash: expect.any(String), title: expect.any(String), snippet: expect.any(String) });
    expect(search.items).toEqual(search.results);
    // Compile the actual shipped Decodable definitions, not a TS approximation.
    if (process.platform === "darwin") {
      const source = await fs.readFile("mac/Sources/TextTextFileProviderKit/LiveTextTextSyncAPI.swift", "utf8");
      const definitions = source.slice(source.indexOf("public struct TextTextAgentCommandItem"), source.indexOf("/// The production `TextTextSyncAPI`"));
      const fixture = path.join(root, "responses.json");
      await fs.writeFile(fixture, JSON.stringify([created, captured, read, appended, search].map(structuredContent => ({ structuredContent, content: [] }))));
      const script = path.join(root, "decode.swift");
      await fs.writeFile(script, "import Foundation\n" + definitions + '\nlet replies = try JSONDecoder().decode([TextTextAgentCommandReply].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))\nprecondition(replies.count == 5)\n');
      execFileSync("swift", [script, fixture], { timeout: 60000, stdio: "pipe" });
    }
  }, 70000);
  it("rejects an actor override in untrusted native JSON arguments", async () => {
    const response = await POST(new Request("https://texttext.app/api/app/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "create_item", args: { title: "spoof", actorType: "external_agent" } }) }));
    expect(response.status).toBe(409); expect(mocks.audit).not.toHaveBeenCalled();
  });
});
