import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { documentText } from "@/lib/collab/document";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { buildTextpack } from "@/lib/github/textpack";
import { parseWorkspaceToolInput } from "@/lib/ai/tools";
import { writeVaultTextpack, readVaultTextpack, readVaultCollaboration, mutateVaultDocument, pushVaultCollaboration } from "@/sync/engine/store";
import { openPack } from "@/local-vault/pack";
import { readDocument, readTemplate } from "@/local-vault/model";
vi.mock("@/lib/store", async () => {
  const engine = await import("@/sync/engine/store");
  return { listVaultTextpacks: engine.listVaultTextpacks, readVaultTemplate: engine.readVaultTemplate,
    mutateVaultDocument: (input: Parameters<typeof engine.mutateVaultDocument>[0] & { actorUserId: string; actorType: "human" | "external_agent" }) => engine.mutateVaultDocument({ ...input, audit: { actorUserId: input.actorUserId, actorType: input.actorType }, onReceipt: async () => {} }) };
});
import { executeVaultTemplateTool } from "../vault-templates";
let root: string, revision: string, sourceRevision: string;
const target = "11111111-1111-4111-8111-111111111111", source = "22222222-2222-4222-8222-222222222222";
const custom = { ...structuredClone(requireBuiltinTemplate("texttext.note")), id: "custom.test", name: "Custom note" };
const authorize = vi.fn<(id: string, path: string, write: boolean) => Promise<void>>(async () => {});
const location = () => ({ root, workspaceId: "workspace" });
const context = () => ({ ...location(), actorUserId: "actor", actorType: "external_agent" as const, authorize });
const input = () => parseWorkspaceToolInput("set_item_template", { id: target, template_id: custom.id, source_item_id: source, source_hash: sourceRevision, if_match_hash: revision, idempotency_key: "apply" });
beforeEach(async () => {
  vi.resetAllMocks(); root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-templates-"));
  for (const [id, relativePath, template] of [[target, "Notes/Original.textpack", requireBuiltinTemplate("texttext.article")], [source, "Templates/Custom.textpack", custom]] as const) {
    const document = emptyDocumentSnapshot({ id: template.id, version: template.version }); document.content.title = "Preserved title"; document.content.body = "Preserved body";
    const entries = unzipSync(buildTextpack("Document", { document, template, markdown: `---\ntextTextId: ${id}\n---\n\nPreserved body` }));
    entries["opaque.bin"] = new Uint8Array([1, 2, 3]);
    const saved = await writeVaultTextpack({ ...location(), itemId: id, operationId: id, relativePath, baseRevision: null, bytes: zipSync(entries) });
    if (id === target) revision = saved.revision!; else sourceRevision = saved.revision!;
  }
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
it("lists built-ins and validated file looks with pinned identity, without inaccessible contents", async () => {
  const list = await executeVaultTemplateTool("list_document_templates", {}, context());
  expect("templates" in list && list.templates.some(row => "source_item_id" in row && row.source_item_id === source)).toBe(true);
  authorize.mockRejectedValue(new Error("not accessible"));
  const filtered = await executeVaultTemplateTool("list_document_templates", { template_id: custom.id }, context());
  expect("templates" in filtered && filtered.templates).toEqual([]);
});
it("applies a custom look in the existing Yjs epoch, preserves content and opaque entries, and replays after source changes", async () => {
  const before = (await readVaultCollaboration({ ...location(), itemId: target }))!;
  const peer = new Y.Doc(); Y.applyUpdate(peer, Buffer.from(before.update, "base64"));
  const vector = Y.encodeStateVector(peer); documentText(peer, "body").insert(0, "Concurrent human ");
  const humanUpdate = Buffer.from(Y.encodeStateAsUpdate(peer, vector)).toString("base64"); peer.destroy();
  const first = await executeVaultTemplateTool("set_item_template", input(), context());
  const pack = (await readVaultTextpack({ ...location(), itemId: target }))!;
  const opened = openPack(pack.bytes, pack.relativePath, pack.revision, target);
  expect(readDocument(opened.file).content).toEqual(readDocument(openPack((await fs.readFile(path.join(root, "workspace/.texttext/history", target, `${revision}.textpack`))), "Notes/Original.textpack", revision, target).file).content);
  expect(readTemplate(opened.file, readDocument(opened.file)).id).toBe(custom.id);
  expect(unzipSync(pack.bytes)["opaque.bin"]).toEqual(new Uint8Array([1, 2, 3]));
  expect((await readVaultCollaboration({ ...location(), itemId: target }))!.epoch).toBe(before.epoch);
  await mutateVaultDocument({ ...location(), itemId: source, operationId: "source-edit", expectedRevision: sourceRevision, mutation: { appendBody: "Later source body" }, audit: { actorUserId: "actor", actorType: "human" }, onReceipt: async () => {} });
  expect(await executeVaultTemplateTool("set_item_template", input(), context())).toEqual(first);
  expect((await readVaultTextpack({ ...location(), itemId: target }))!.revision).toBe(pack.revision);
  const state = (await readVaultCollaboration({ ...location(), itemId: target }))!;
  expect(JSON.parse(state.presentation.templateJSON!).id).toBe(custom.id);
  await pushVaultCollaboration({ ...location(), itemId: target, epoch: before.epoch, operationId: "human-peer", updates: [humanUpdate], audit: { actorUserId: "human", actorType: "human" }, onReceipt: async () => {} });
  const merged = (await readVaultTextpack({ ...location(), itemId: target }))!;
  const mergedFile = openPack(merged.bytes, merged.relativePath, merged.revision).file;
  expect(readDocument(mergedFile).content.body).toBe("Concurrent human Preserved body");
  expect(readTemplate(mergedFile, readDocument(mergedFile)).id).toBe(custom.id);
});
it("fences stale target and source revisions and rechecks source permission under commit", async () => {
  await expect(executeVaultTemplateTool("set_item_template", { ...input(), if_match_hash: "a".repeat(64) }, context())).rejects.toThrow("changed");
  await expect(executeVaultTemplateTool("set_item_template", { ...input(), source_hash: "a".repeat(64) }, context())).rejects.toThrow("source changed");
  authorize.mockImplementation(async id => { if (id === source) throw new Error("source revoked"); });
  await expect(executeVaultTemplateTool("set_item_template", input(), context())).rejects.toThrow("source revoked");
  expect((await readVaultTextpack({ ...location(), itemId: target }))!.revision).toBe(revision);
});
it("applies built-ins and rejects reused keys, while revoked replay cannot return contents", async () => {
  const args = { id: target, template_id: "texttext.note", if_match_hash: revision, idempotency_key: "builtin" };
  await executeVaultTemplateTool("set_item_template", args, context());
  await expect(executeVaultTemplateTool("set_item_template", { ...args, template_id: "texttext.gallery" }, context())).rejects.toThrow("Operation id was reused");
  authorize.mockRejectedValue(new Error("revoked"));
  await expect(executeVaultTemplateTool("set_item_template", args, context())).rejects.toThrow("revoked");
});
it("rejects malformed embedded custom render definitions", async () => {
  const sourcePack = (await readVaultTextpack({ ...location(), itemId: source }))!;
  const entries = unzipSync(sourcePack.bytes), name = Object.keys(entries).find(name => name.endsWith("/template.json"))!;
  entries[name] = strToU8(JSON.stringify({ ...custom, render: { type: "script", code: "untrusted" } }));
  // A raw file edit is discovered, but its template still must validate before use.
  await fs.writeFile(path.join(root, "workspace", sourcePack.relativePath), zipSync(entries));
  const changed = (await readVaultTextpack({ ...location(), itemId: source }))!;
  await expect(executeVaultTemplateTool("set_item_template", { ...input(), source_hash: changed.revision }, context())).rejects.toThrow();
  expect((await readVaultTextpack({ ...location(), itemId: target }))!.revision).toBe(revision);
});
