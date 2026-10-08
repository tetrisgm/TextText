import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVaultFolder, listVaultTextpacks } from "@/sync/engine/store";
import { vaultToolDefinitions } from "../vault-contract";
import { parseWorkspaceToolInput } from "@/lib/ai/tools";
const authority = vi.hoisted(() => ({ owner: "actor", grants: [] as unknown[] }));
vi.mock("@/lib/store", async () => {
  const engine = await import("@/sync/engine/store");
  return {
    getUserIdBySub: async () => "actor", getOwnedBlog: async () => ({ handle: "fixture", name: "Fixture" }), getBlogEditRecord: async () => ({ id: "workspace", ownerId: authority.owner }),
    createVaultFolder: (input: Parameters<typeof engine.createVaultFolder>[0] & { actorUserId: string }) => engine.createVaultFolder({ ...input, audit: { actorUserId: input.actorUserId, actorType: "external_agent" }, onReceipt: async () => {} }),
  };
});
vi.mock("@/lib/vault/grants", () => ({ activeVaultGrants: async () => authority.grants, roleForVaultFolder: (_grants: unknown[], folder: string) => folder === "Research" && authority.grants.length ? "editor" : null, roleForVaultItem: () => null }));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAuthConfigured: () => false }));
let root: string;
const audit = { actorUserId: "actor", actorType: "external_agent" as const };
const beforeCommit = vi.fn(async () => {});
const onReceipt = vi.fn(async () => {});
const input = () => ({ root, workspaceId: "workspace", operationId: "create-folder", relativePath: "Research", audit, beforeCommit, onReceipt });
beforeEach(async () => { vi.clearAllMocks(); authority.owner = "actor"; authority.grants = []; root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-folders-")); });
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
describe("canonical durable folder creation", () => {
  it("dispatches public creation against files and enforces read-only and parent grants", async () => {
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", root);
    const { executeMcpTool } = await import("../tools");
    const authInfo = { token: "fixture", clientId: "fixture", scopes: ["sync"], extra: { sub: "subject", userId: "actor", connectionId: "test-connection" } };
    const args = { parent_path: "", name: "Research", idempotency_key: "public" };
    expect((await executeMcpTool("create_folder", args, { authInfo: { ...authInfo, scopes: ["readonly"] } })).isError).toBe(true);
    const created = await executeMcpTool("create_folder", args, { authInfo }); expect(created, JSON.stringify(created)).not.toHaveProperty("isError", true);
    expect((await listVaultTextpacks(input())).folders).toEqual(["Research"]);
    authority.owner = "other"; authority.grants = [{}];
    expect((await executeMcpTool("create_folder", { ...args, name: "Denied", idempotency_key: "denied" }, { authInfo })).isError).toBe(true);
    expect((await executeMcpTool("create_folder", { parent_path: "Research", name: "Allowed", idempotency_key: "child" }, { authInfo })).isError).not.toBe(true);
    expect((await listVaultTextpacks(input())).folders).toEqual(["Research", "Research/Allowed"]);
    authority.grants = [];
    expect((await executeMcpTool("create_folder", args, { authInfo })).isError).toBe(true);
  });
  it("exposes a stable retry key in the catalog and parses root creation", () => {
    const definition = vaultToolDefinitions().find(tool => tool.name === "create_folder")!;
    expect(definition.inputSchema.required).toContain("idempotency_key");
    expect(parseWorkspaceToolInput("create_folder", { parent_path: "", name: "Research", idempotency_key: "create-folder" })).toEqual({ parent_path: "", name: "Research", idempotency_key: "create-folder" });
  });
  it("creates a discoverable empty directory and retries the same durable result", async () => {
    const first = await createVaultFolder(input());
    expect(await createVaultFolder(input())).toEqual(first);
    expect((await listVaultTextpacks(input())).folders).toEqual(["Research"]);
    expect(onReceipt).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "actor", result: first }));
  });
  it("supports children only under existing parents and rejects occupied case variants", async () => {
    await expect(createVaultFolder({ ...input(), relativePath: "Missing/Child" })).rejects.toThrow();
    await createVaultFolder(input());
    await createVaultFolder({ ...input(), operationId: "child", relativePath: "Research/Ideas" });
    await expect(createVaultFolder({ ...input(), operationId: "collision", relativePath: "research" })).rejects.toThrow("occupied");
    expect((await listVaultTextpacks(input())).folders).toEqual(["Research", "Research/Ideas"]);
  });
  it("recovers a committed intent before its receipt and rejects foreign case collisions", async () => {
    onReceipt.mockRejectedValueOnce(new Error("lost receipt acknowledgement"));
    await expect(createVaultFolder(input())).rejects.toThrow();
    await fs.unlink(path.join(root, "workspace", ".texttext", "receipts", "create-folder.json"));
    await fs.rmdir(path.join(root, "workspace", "Research"));
    await fs.mkdir(path.join(root, "workspace", "research"));
    await expect(createVaultFolder(input())).rejects.toThrow("occupied");
    await fs.rmdir(path.join(root, "workspace", "research"));
    expect((await createVaultFolder(input())).status).toBe("folder_created");
    expect((await listVaultTextpacks(input())).folders).toEqual(["Research"]);
  });
  it.each(["Fake.textpack", "Bad?", "CON", "Trailing."])("rejects folder names native clients cannot materialize: %s", async relativePath => {
    await expect(createVaultFolder({ ...input(), relativePath })).rejects.toThrow("Invalid folder");
  });
  it("rejects traversal and symlinks without touching outside content", async () => {
    await expect(createVaultFolder({ ...input(), relativePath: "../Escape" })).rejects.toThrow();
    await listVaultTextpacks(input());
    await fs.symlink(root, path.join(root, "workspace", "Link"));
    await expect(createVaultFolder({ ...input(), relativePath: "Link/Escape" })).rejects.toThrow("Parent folder");
    await expect(fs.stat(path.join(root, "Escape"))).rejects.toThrow();
  });
  it("rejects reused keys and revoked replay, including receipt-only recovery", async () => {
    await expect(createVaultFolder({ ...input(), receiptOnly: true })).rejects.toThrow("No completed receipt");
    const first = await createVaultFolder(input());
    expect(await createVaultFolder({ ...input(), receiptOnly: true })).toEqual(first);
    await expect(createVaultFolder({ ...input(), relativePath: "Elsewhere" })).rejects.toThrow("reused");
    beforeCommit.mockRejectedValueOnce(new Error("revoked"));
    await expect(createVaultFolder(input())).rejects.toThrow("revoked");
  });
  it("recovers a lost audit acknowledgement without repeating or recreating the directory", async () => {
    onReceipt.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(createVaultFolder(input())).rejects.toThrow("audit unavailable");
    const result = await createVaultFolder(input());
    expect(result.relativePath).toBe("Research");
    const receipts = await fs.readdir(path.join(root, "workspace", ".texttext", "receipts"));
    expect(receipts).toHaveLength(1);
    await fs.rmdir(path.join(root, "workspace", "Research"));
    expect(await createVaultFolder(input())).toEqual(result);
    await expect(fs.stat(path.join(root, "workspace", "Research"))).rejects.toThrow();
  });
  it("rechecks permission immediately before journaling", async () => {
    beforeCommit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked"));
    await expect(createVaultFolder(input())).rejects.toThrow("revoked");
    await expect(fs.stat(path.join(root, "workspace", "Research"))).rejects.toThrow();
  });
});
