import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
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
  it("creates, reads and appends through the actual native route with stable public fields", async () => {
    const created = await command("create_item", { title: "Native note", body: "Human body", kind: "note", idempotency_key: "create" });
    expect(created.item.id).toMatch(/^[a-f0-9-]{36}$/); expect(created.itemId).toBe(created.item.id);
    expect(created.item.hash).toBe(created.revision);
    const first = await command("read_item", { id: created.item.id });
    expect(first.markdown).toContain("Human body"); expect(first.item.hash).toBe(created.item.hash);
    const append = { id: created.item.id, markdown: "Native append", if_match_hash: first.item.hash, idempotency_key: "append" };
    const written = await command("append_to_item", append);
    expect(written.item.id).toBe(created.item.id);
    expect(await command("append_to_item", append)).toEqual(written);
    const read = await command("read_item", { id: created.item.id });
    expect(read.markdown).toContain("Human body\n\nNative append");
    expect(mocks.presence).not.toHaveBeenCalled();
    expect(mocks.audit.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [receipt] of mocks.audit.mock.calls as unknown as [{ actorType: string }][]) expect(receipt.actorType).toBe("human");
  });
  it("rejects an actor override in untrusted native JSON arguments", async () => {
    const response = await POST(new Request("https://texttext.app/api/app/commands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "create_item", args: { title: "spoof", actorType: "external_agent" } }) }));
    expect(response.status).toBe(409); expect(mocks.audit).not.toHaveBeenCalled();
  });
});
