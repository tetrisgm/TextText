import { beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listVaultTextpacks, readVaultTextpack } from "@/sync/engine/store";
import { openPack } from "@/local-vault/pack";
import { readFeedSubscription } from "@/lib/vault/rss";
const state = vi.hoisted(() => ({ fetch: vi.fn(), audit: vi.fn(), records: new Set<string>() }));
vi.mock("@/lib/vault/rss-feed.server", () => ({ readVaultFeed: state.fetch }));
vi.mock("@/lib/store", async () => {
  const engine = await import("@/sync/engine/store");
  return { ...engine, getUserIdBySub: async () => "actor", getOwnedBlog: async () => ({ handle: "fixture", name: "Fixture" }), getBlogEditRecord: async () => ({ id: "workspace", ownerId: "actor" }),
    writeVaultTextpack: (input: Parameters<typeof engine.writeVaultTextpack>[0] & { actorUserId: string }) => engine.writeVaultTextpack({ ...input,
      audit: { actorUserId: input.actorUserId, actorType: "external_agent" }, onReceipt: async receipt => { await state.audit(receipt); state.records.add(receipt.operationId); } }) };
});
import { addVaultFeed } from "../vault-feeds";
import { executeVaultReadTool } from "../vault-tools";
import { vaultToolDefinitions } from "../vault-contract";
import { validateWorkspaceWriteProposal } from "@/lib/ai/write-proposal-policy";
let root: string;
const args = { url: "https://example.com/feed", parent_path: "Feeds", name: "Fixture feed", idempotency_key: "lost-response" };
const authorize = vi.fn(async () => {});
const context = () => ({ root, workspaceId: "workspace", actorUserId: "actor", authorize });
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-feed-command-")); vi.resetAllMocks(); state.records.clear(); state.fetch.mockResolvedValue({ title: "Publisher changes", entries: [] }); });
it("recovers a lost response without a second fetch, duplicate or snapshot change", async () => {
  const first = await addVaultFeed(args, context());
  const original = (await readVaultTextpack({ root, workspaceId: "workspace", itemId: first.itemId }))!;
  state.fetch.mockRejectedValue(new Error("publisher now offline"));
  expect(await addVaultFeed(args, context())).toEqual(first);
  const current = (await readVaultTextpack({ root, workspaceId: "workspace", itemId: first.itemId }))!;
  expect(current.bytes).toEqual(original.bytes);
  expect((await listVaultTextpacks({ root, workspaceId: "workspace" })).items).toHaveLength(1);
  expect(readFeedSubscription(openPack(current.bytes, current.relativePath, current.revision).file)).toMatchObject({ feedURL: args.url, title: args.name });
  expect(state.fetch).toHaveBeenCalledTimes(1); expect(state.records.size).toBe(1);
  await expect(addVaultFeed({ ...args, url: "https://example.com/changed" }, context())).rejects.toThrow("reused");
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
it("retains the durable operation when audit acknowledgement fails", async () => {
  state.audit.mockRejectedValueOnce(new Error("audit acknowledgement lost"));
  await expect(addVaultFeed(args, context())).rejects.toThrow("audit acknowledgement lost");
  state.fetch.mockRejectedValue(new Error("offline"));
  await addVaultFeed(args, context());
  expect(state.fetch).toHaveBeenCalledTimes(1); expect(state.records.size).toBe(1);
  expect((await listVaultTextpacks({ root, workspaceId: "workspace" })).items).toHaveLength(1);
});
it("refuses viewer execution and revoked creation before fetching", async () => {
  vi.stubEnv("TEXTTEXT_VAULT_ROOT", root);
  const result = await executeVaultReadTool("add_feed", args, { scopes: ["readonly"], extra: { sub: "fixture" } } as never);
  expect(result.isError).toBe(true); expect(state.fetch).not.toHaveBeenCalled();
  authorize.mockRejectedValue(new Error("viewer cannot create"));
  await expect(addVaultFeed(args, context())).rejects.toThrow("viewer cannot create");
  expect(state.fetch).not.toHaveBeenCalled(); vi.unstubAllEnvs();
});
it("offers only the file subscription contract for durable approval", () => {
  const definition = vaultToolDefinitions().find(tool => tool.name === "add_feed")!;
  expect(definition).toBeDefined(); expect(definition.inputSchema.required).toContain("idempotency_key");
  expect(definition.inputSchema.properties).not.toHaveProperty("retention_days");
  expect((definition.inputSchema.properties!.parent_path as {description:string}).description).toContain("subscription TextPack");
  expect((definition.inputSchema.properties!.name as {description:string}).description).toContain("URL hostname");
  expect(validateWorkspaceWriteProposal("add_feed", args).arguments).toEqual(args);
  expect(() => validateWorkspaceWriteProposal("add_feed", { ...args, retention_days: 5 })).toThrow();
});

it.each(["Feeds ", "Feeds.", "CON", "aux.txt", "Notes/LPT1", "Notes/Bad /Child", "Bad:name", "Bad?name"])("refuses nonportable destination %s before fetch, audit or write", async folder => {
 const { mutateVaultTool } = await import("../vault-mutations");
 await expect(addVaultFeed({...args,parent_path:folder},context())).rejects.toThrow("portable folder");
 await expect(mutateVaultTool("create_item",{title:"Fixture",folder_path:folder,idempotency_key:"invalid"},context())).rejects.toThrow("portable folder");
 expect(state.fetch).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled(); expect(authorize).not.toHaveBeenCalled(); expect(await fs.readdir(root)).toEqual([]);
});
it.each(["", "Feeds", "Projects/日本語", "CONtemporary", "Notes.v2"])("preserves portable destination %s", async folder => {
 const { validatePortableFolderPath } = await import("@/lib/vault/portable-folder-path");
 expect(validatePortableFolderPath(folder)).toBe(folder);
});
