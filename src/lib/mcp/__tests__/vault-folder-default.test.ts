import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as engine from "@/sync/engine/store";
import { openPack } from "@/local-vault/pack";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { readDocument } from "@/local-vault/model";
import { readFolderView, readFolderItemDefault, folderCollectionTemplate } from "@/local-vault/folder-view";
vi.mock("@/lib/store", async () => {
  const engine = await import("@/sync/engine/store");
  return { setVaultFolderTemplate: (input: Parameters<typeof engine.setVaultFolderTemplate>[0]) => engine.setVaultFolderTemplate({ ...input, audit: { actorUserId: "actor", actorType: "human" }, onReceipt: async () => {} }), writeVaultTextpack: engine.writeVaultTextpack };
});
import { executeVaultTemplateTool } from "../vault-templates";
import { mutateVaultTool } from "../vault-mutations";
let root: string;
const auth = vi.fn(async () => {});
const location = () => ({ root, workspaceId: "workspace" });
const context = () => ({ ...location(), actorUserId: "actor", actorType: "human" as const, authorize: auth, authorizeTemplate: auth, authorizeFolder: auth });
const args = () => ({ folder_path: "Notes", template_id: "texttext.article", template_version: 1, if_match_hash: null, idempotency_key: "default" });
beforeEach(async () => { auth.mockReset().mockResolvedValue(undefined); root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-folder-default-")); await fs.mkdir(path.join(root, "workspace", "Notes"), { recursive: true }); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
it("pins a default separately from collection layout and applies only to future generic creation", async () => {
  const saved = await executeVaultTemplateTool("set_folder_template", args(), context());
  expect(saved).toMatchObject({ status: "written" });
  if (!("itemId" in saved)) throw Error("missing item");
  const file = await engine.readVaultTextpack({ ...location(), itemId: saved.itemId });
  const view = readFolderView(openPack(file!.bytes, file!.relativePath, file!.revision).file)!;
  expect(readFolderItemDefault(view)?.template.id).toBe("texttext.article");
  expect(folderCollectionTemplate(view)).toBeUndefined();
  const generic = await mutateVaultTool("create_item", { title: "My title", body: "My body", folder_path: "Notes", idempotency_key: "generic" }, context());
  const explicit = await mutateVaultTool("create_item", { title: "Explicit", kind: "note", folder_path: "Notes", idempotency_key: "explicit" }, context());
  for (const [result, type] of [[generic, "texttext.article"], [explicit, "texttext.note"]] as const) {
    const pack = await engine.readVaultTextpack({ ...location(), itemId: result.itemId });
    const document = readDocument(openPack(pack!.bytes, pack!.relativePath, pack!.revision).file);
    expect(document.presentation.template.id).toBe(type);
    if (result === generic) expect(document.content).toMatchObject({ title: "My title", body: "My body" });
  }
  expect(await executeVaultTemplateTool("set_folder_template", args(), context())).toEqual(saved);
  await expect(executeVaultTemplateTool("set_folder_template", { ...args(), idempotency_key: "stale" }, context())).rejects.toThrow("changed");
  auth.mockRejectedValue(new Error("revoked"));
  await expect(executeVaultTemplateTool("set_folder_template", args(), context())).rejects.toThrow("revoked");
});
it("never overwrites an ordinary file occupying the configuration path", async () => {
  await fs.writeFile(path.join(root, "workspace", "Notes", "Folder view.textpack"), "not a template");
  await expect(executeVaultTemplateTool("set_folder_template", args(), context())).rejects.toThrow("occupies");
  expect(await fs.readFile(path.join(root, "workspace", "Notes", "Folder view.textpack"), "utf8")).toBe("not a template");
});
it("updates only the definition with a guarded hash and rejects duplicate marked files", async () => {
  const first = await executeVaultTemplateTool("set_folder_template", args(), context());
  if (!("itemId" in first) || !("revision" in first)) throw Error("missing receipt");
  const second = await executeVaultTemplateTool("set_folder_template", { ...args(), template_id: "texttext.note", if_match_hash: first.revision, idempotency_key: "replace" }, context());
  expect(second).toMatchObject({ itemId: first.itemId, status: "written" });
  const pack = await engine.readVaultTextpack({ ...location(), itemId: first.itemId });
  await fs.writeFile(path.join(root, "workspace", "Notes", "Duplicate.textpack"), pack!.bytes);
  await expect(mutateVaultTool("create_item", { title: "New", folder_path: "Notes", idempotency_key: "duplicate" }, context())).rejects.toThrow("multiple folder views");
});
it("allows ordinary corrupt siblings and missing destination folders without treating them as settings", async () => {
  await fs.writeFile(path.join(root, "workspace", "Notes", "Broken.textpack"), "bad zip");
  const result = await mutateVaultTool("create_item", { title: "Good", folder_path: "Notes", idempotency_key: "good" }, context());
  expect(result.status).toBe("written");
  const other = await mutateVaultTool("create_item", { title: "Good", folder_path: "New folder", idempotency_key: "new-folder" }, context());
  expect(other.status).toBe("written");
});
it("rejects a definition changed by an external writer during final authorization", async () => {
  const first = await executeVaultTemplateTool("set_folder_template", args(), context());
  if (!("itemId" in first) || !("revision" in first)) throw Error("missing receipt");
  let calls = 0;
  const authorizeFolder = async () => { if (++calls === 2) await fs.writeFile(path.join(root, "workspace", "Notes", "Folder view.textpack"), "externally changed"); };
  await expect(executeVaultTemplateTool("set_folder_template", { ...args(), if_match_hash: first.revision, idempotency_key: "race" }, { ...context(), authorizeFolder })).rejects.toThrow("changed");
  expect(await fs.readFile(path.join(root, "workspace", "Notes", "Folder view.textpack"), "utf8")).toBe("externally changed");
});
it("supports explicit root creation while omitted folder still creates Notes", async () => {
  await executeVaultTemplateTool("set_folder_template", { ...args(), folder_path: "" }, context());
  const result = await mutateVaultTool("create_item", { folder_path: "", title: "Root", idempotency_key: "root" }, context());
  const item = await engine.readVaultTextpack({ ...location(), itemId: result.itemId });
  expect(item!.relativePath).not.toContain("/");
  expect(readDocument(openPack(item!.bytes, item!.relativePath, item!.revision).file).presentation.template.id).toBe("texttext.article");
});

it("fences custom source changes after authorization and replays completed defaults after source edits", async () => {
  const id = "77777777-7777-4777-8777-777777777777";
  const template = { ...requireBuiltinTemplate("texttext.note"), id: "custom.default", name: "Custom default" };
  const bytes = buildTextpack("Document", { template, document: emptyDocumentSnapshot({ id: template.id, version: 1 }), markdown: `---\ntextTextId: ${id}\n---\n` });
  const source = await engine.writeVaultTextpack({ ...location(), itemId: id, relativePath: "Templates/Default.textpack", operationId: "source", baseRevision: null, bytes });
  const changed = buildTextpack("Document", { template: { ...template, name: "Changed name" }, document: emptyDocumentSnapshot({ id: template.id, version: 1 }), markdown: `---\ntextTextId: ${id}\n---\nChanged` });
  const request = { ...args(), template_id: template.id, source_item_id: id, source_hash: source.revision };
  const saved = await executeVaultTemplateTool("set_folder_template", request, context());
  await fs.writeFile(path.join(root, "workspace", "Templates", "Default.textpack"), changed);
  await expect(executeVaultTemplateTool("set_folder_template", request, context())).resolves.toEqual(saved);
  await fs.writeFile(path.join(root, "workspace", "Templates", "Default.textpack"), bytes);
  let reads = 0;
  const authorize = async () => { if (++reads === 2) await fs.writeFile(path.join(root, "workspace", "Templates", "Default.textpack"), changed); };
  await expect(executeVaultTemplateTool("set_folder_template", { ...request, if_match_hash: "revision" in saved ? saved.revision : null, idempotency_key: "race-source" }, { ...context(), authorize })).rejects.toThrow("source changed");
});
