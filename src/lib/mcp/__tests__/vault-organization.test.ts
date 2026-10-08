import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { parseWorkspaceToolInput } from "@/lib/ai/tools";
import { writeVaultTextpack, readVaultTextpack, listVaultRecovery } from "@/sync/engine/store";
const state = vi.hoisted(() => ({ receipts: [] as unknown[] }));
vi.mock("@/lib/store", async () => {
  const engine = await import("@/sync/engine/store");
  const wrap = (input: Parameters<typeof engine.deleteVaultTextpack>[0] & { actorUserId: string }) => ({ ...input, audit: { actorUserId: input.actorUserId, actorType: "external_agent" as const }, onReceipt: async (receipt: unknown) => { state.receipts.push(receipt); } });
  return { deleteVaultTextpack: (input: Parameters<typeof engine.deleteVaultTextpack>[0] & { actorUserId: string }) => engine.deleteVaultTextpack(wrap(input)), moveVaultTextpack: (input: Parameters<typeof engine.moveVaultTextpack>[0] & { actorUserId: string }) => engine.moveVaultTextpack({ ...wrap(input), relativePath: input.relativePath }) };
});
import { organizeVaultItem } from "../vault-organization";
import { vaultToolDefinitions } from "../vault-contract";
let root: string, revision: string;
const itemId = "11111111-1111-4111-8111-111111111111";
const authorize = vi.fn<(id: string, path: string, destination: boolean) => Promise<void>>(async () => {});
const location = () => ({ root, workspaceId: "workspace" });
const context = () => ({ ...location(), actorUserId: "actor", authorize });
const args = () => ({ id: itemId, path: "Notes/A.textpack", if_match_hash: revision, idempotency_key: "operation" });
beforeEach(async () => {
  vi.resetAllMocks(); state.receipts.length = 0; root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-organization-"));
  const document = emptyDocumentSnapshot(); document.content.body = "Preserve me";
  const result = await writeVaultTextpack({ ...location(), itemId, operationId: "seed", relativePath: "Notes/A.textpack", baseRevision: null, bytes: buildTextpack("Note", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\nPreserve me` }) });
  revision = result.revision!;
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
it("moves with public arguments, preserving bytes and safely replaying the original path", async () => {
  const before = await readVaultTextpack({ ...location(), itemId });
  const input = parseWorkspaceToolInput("move_item", { ...args(), folder_path: "Research" });
  const first = await organizeVaultItem("move_item", input, context());
  expect(await organizeVaultItem("move_item", input, context())).toEqual(first);
  const after = await readVaultTextpack({ ...location(), itemId });
  expect(after?.relativePath).toBe("Research/A.textpack"); expect(after?.bytes).toEqual(before?.bytes);
  expect(authorize).toHaveBeenCalledWith(itemId, "Notes/A.textpack", false);
  expect(authorize).toHaveBeenCalledWith(itemId, "Research/A.textpack", true);
  await expect(organizeVaultItem("move_item", { ...input, folder_path: "Other" }, context())).rejects.toThrow("Operation id was reused");
});
it("delete retains recovery and replays after the source is gone", async () => {
  const input = parseWorkspaceToolInput("delete_item", args());
  const first = await organizeVaultItem("delete_item", input, context());
  expect(first.status).toBe("deleted"); expect(first.recoveryRetained).toBe(true);
  expect(await readVaultTextpack({ ...location(), itemId })).toBeNull();
  expect(await organizeVaultItem("delete_item", input, context())).toEqual(first);
  expect((await listVaultRecovery(location())).entries.some(entry => entry.hash === revision)).toBe(true);
  expect(state.receipts.length).toBeGreaterThan(0);
  authorize.mockRejectedValueOnce(new Error("revoked"));
  await expect(organizeVaultItem("delete_item", input, context())).rejects.toThrow("revoked");
});
it("checks destination again at commit and leaves source intact after revocation", async () => {
  let destinations = 0;
  authorize.mockImplementation(async (_id, _path, destination) => { if (destination && ++destinations === 2) throw new Error("destination revoked"); });
  await expect(organizeVaultItem("move_item", { ...args(), folder_path: "Research" }, context())).rejects.toThrow("destination revoked");
  expect((await readVaultTextpack({ ...location(), itemId }))?.relativePath).toBe("Notes/A.textpack");
});
it("fences competing moves and stale deletion", async () => {
  const [a, b] = await Promise.allSettled([
    organizeVaultItem("move_item", { ...args(), folder_path: "One" }, context()),
    organizeVaultItem("move_item", { ...args(), folder_path: "Two", idempotency_key: "other" }, context()),
  ]);
  expect([a, b].filter(result => result.status === "fulfilled")).toHaveLength(1);
  await expect(organizeVaultItem("delete_item", args(), context())).rejects.toThrow("changed");
  expect(await readVaultTextpack({ ...location(), itemId })).not.toBeNull();
});
it("catalog requires replay and concurrency inputs without claiming restore support", () => {
  for (const name of ["move_item", "delete_item"]) {
    const definition = vaultToolDefinitions().find(tool => tool.name === name)!;
    expect(definition.inputSchema.required).toEqual(expect.arrayContaining(["path", "if_match_hash", "idempotency_key"]));
  }
  expect(vaultToolDefinitions().some(tool => String(tool.name) === "restore_item")).toBe(true);
});

it("moves to workspace root and retries same-path moves without changing contents", async () => {
  const input = parseWorkspaceToolInput("move_item", { ...args(), folder_path: "" });
  const moved = await organizeVaultItem("move_item", input, context());
  expect(moved.relativePath).toBe("A.textpack");
  expect(authorize).toHaveBeenCalledWith(itemId, "A.textpack", true);
  const same = { ...input, path: "A.textpack", idempotency_key: "same" };
  const result = await organizeVaultItem("move_item", same, context());
  expect(await organizeVaultItem("move_item", same, context())).toEqual(result);
  expect((await readVaultTextpack({ ...location(), itemId }))?.revision).toBe(revision);
});

it("reads a completed delete receipt without a live file and never starts a missing operation", async () => {
  const input = args();
  await expect(organizeVaultItem("delete_item", input, { ...context(), receiptOnly: true })).rejects.toThrow("No completed receipt");
  const result = await organizeVaultItem("delete_item", input, context());
  expect(await readVaultTextpack({ ...location(), itemId })).toBeNull();
  const auditCount = state.receipts.length;
  expect(await organizeVaultItem("delete_item", input, { ...context(), receiptOnly: true })).toEqual(result);
  expect(state.receipts).toHaveLength(auditCount);
  authorize.mockRejectedValueOnce(new Error("revoked"));
  await expect(organizeVaultItem("delete_item", input, { ...context(), receiptOnly: true })).rejects.toThrow("revoked");
});
