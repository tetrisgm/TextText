import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { openPack, encodePack, replacePackIdentity } from "@/local-vault/pack";
import { writeVaultTextpack, deleteVaultTextpack, restoreVaultTextpack, listVaultTrash, readVaultTextpack, readVaultCollaboration, pushVaultCollaboration, mutateVaultDocument, mutateVaultPublication, listVaultTextpacks } from "@/sync/engine/store";
let root: string, bytes: Uint8Array, revision: string;
const itemId = "11111111-1111-4111-8111-111111111111";
const location = () => ({ root, workspaceId: "workspace", itemId });
const restore = () => ({ ...location(), operationId: "restore", basePath: "Notes/A.textpack", relativePath: "Notes/A.textpack", baseRevision: revision });
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-trash-"));
  const document = emptyDocumentSnapshot(); document.content.body = "Human text";
  bytes = buildTextpack("Note", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\nHuman text` });
  revision = (await writeVaultTextpack({ ...location(), operationId: "seed", relativePath: "Notes/A.textpack", baseRevision: null, bytes })).revision!;
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });
async function remove() { await deleteVaultTextpack({ ...location(), operationId: "delete", basePath: "Notes/A.textpack", baseRevision: revision }); }
it("restores the same identity with a fresh revision and fences old file and collaboration writers", async () => {
  const old = await readVaultCollaboration(location());
  await remove(); expect((await listVaultTrash(location())).items).toHaveLength(1);
  const restored = await restoreVaultTextpack(restore());
  expect(restored.itemId).toBe(itemId); expect(restored.revision).not.toBe(revision);
  expect((await listVaultTextpacks(location())).items[0]).toMatchObject({ lifecycle: "restore", restoreFromRevision: revision });
  const current = await readVaultCollaboration(location()); expect(current!.epoch).toBeGreaterThan(old!.epoch);
  await expect(pushVaultCollaboration({ ...location(), operationId: "old-live", epoch: old!.epoch, updates: ["AAA="], audit: { actorUserId: "actor", actorType: "external_agent" }, onReceipt: async () => {} })).rejects.toThrow("outside this collaboration");
  expect((await writeVaultTextpack({ ...location(), operationId: "old-file", relativePath: "Notes/A.textpack", baseRevision: revision, bytes })).status).toBe("conflict");
  expect(await restoreVaultTextpack(restore())).toEqual(restored);
  expect((await listVaultTrash(location())).items).toHaveLength(0);
});
it("shared pack encoding and document edits preserve lifecycle and subsequent ordinary saves work", async () => {
  await remove(); await restoreVaultTextpack(restore());
  let file = (await readVaultTextpack(location()))!;
  const opened = openPack(file.bytes, file.relativePath, file.revision, itemId);
  const edited = encodePack(opened, { ...opened.file, markdown: opened.file.markdown + "\nExternal new edit" });
  expect(unzipSync(edited)["texttext-lifecycle.json"]).toEqual(unzipSync(file.bytes)["texttext-lifecycle.json"]);
  expect((await writeVaultTextpack({ ...location(), operationId: "new-file", relativePath: file.relativePath, baseRevision: file.revision, bytes: edited })).status).toBe("written");
  file = (await readVaultTextpack(location()))!;
  await mutateVaultDocument({ ...location(), operationId: "agent-edit", expectedRevision: file.revision, mutation: { appendBody: "Agent new edit" }, audit: { actorUserId: "actor", actorType: "external_agent" }, onReceipt: async () => {} });
  const newer = (await readVaultTextpack(location()))!;
  expect(unzipSync(newer.bytes)["texttext-lifecycle.json"]).toEqual(unzipSync(file.bytes)["texttext-lifecycle.json"]);
  await restoreVaultTextpack(restore());
  expect((await readVaultTextpack(location()))!.bytes).toEqual(newer.bytes);
});
it("retains durable restore across interrupted audit delivery and rejects occupied destination", async () => {
  await remove();
  await fs.writeFile(path.join(root, "workspace", "Notes", "A.textpack"), "occupied");
  await expect(restoreVaultTextpack(restore())).rejects.toThrow("occupied");
  await fs.rm(path.join(root, "workspace", "Notes", "A.textpack"));
  const input = { ...restore(), audit: { actorUserId: "actor", actorType: "external_agent" as const }, onReceipt: async () => { throw new Error("audit offline"); } };
  await expect(restoreVaultTextpack(input)).rejects.toThrow("audit offline");
  const result = await restoreVaultTextpack({ ...input, onReceipt: async () => {} });
  expect(result.status).toBe("restored");
  expect((await readVaultTextpack(location()))!.revision).toBe(result.revision);
  await expect(restoreVaultTextpack({ ...input, relativePath: "Elsewhere/A.textpack", onReceipt: async () => {} })).rejects.toThrow("Operation id was reused");
  await expect(restoreVaultTextpack({ ...input, beforeCommit: async () => { throw new Error("revoked"); }, onReceipt: async () => {} })).rejects.toThrow("revoked");
});

it("fences first-generation archives after a second restore and permits independent copied identities", async () => {
  await remove(); await restoreVaultTextpack(restore());
  const first = (await readVaultTextpack(location()))!;
  const cloneId = "22222222-2222-4222-8222-222222222222";
  const opened = openPack(first.bytes, first.relativePath, first.revision, itemId);
  const cloneBytes = encodePack(opened, { ...opened.file, markdown: replacePackIdentity(opened.file.markdown, cloneId) });
  expect((await writeVaultTextpack({ ...location(), itemId: cloneId, operationId: "clone", relativePath: "Notes/Clone.textpack", baseRevision: null, bytes: cloneBytes })).status).toBe("written");
  await deleteVaultTextpack({ ...location(), operationId: "delete-two", basePath: first.relativePath, baseRevision: first.revision });
  await restoreVaultTextpack({ ...restore(), operationId: "restore-two", baseRevision: first.revision });
  expect((await writeVaultTextpack({ ...location(), operationId: "old-first-generation", relativePath: first.relativePath, baseRevision: first.revision, bytes: first.bytes })).status).toBe("conflict");
});
it("recovers interruption between file installation and metadata without resetting later edits", async () => {
  await remove();
  const rename = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).rename;
  vi.mocked(fs.rename).mockImplementation(async (from, to) => {
    if (String(to).endsWith(`/items/${itemId}.json`)) { vi.mocked(fs.rename).mockImplementation(rename); throw new Error("power interruption"); }
    return rename(from, to);
  });
  await expect(restoreVaultTextpack(restore())).rejects.toThrow("power interruption");
  const result = await restoreVaultTextpack(restore());
  expect(result.status).toBe("restored");
  const file = (await readVaultTextpack(location()))!;
  await mutateVaultDocument({ ...location(), operationId: "after-restart", expectedRevision: file.revision, mutation: { appendBody: "Keep this" }, audit: { actorUserId: "actor", actorType: "human" }, onReceipt: async () => {} });
  const edited = (await readVaultTextpack(location()))!;
  await restoreVaultTextpack(restore());
  expect((await readVaultTextpack(location()))!.bytes).toEqual(edited.bytes);
});
it("restores formerly published content privately", async () => {
  const published = await mutateVaultPublication({ ...location(), operationId: "publish", baseRevision: revision, published: true, audit: { actorUserId: "actor", actorType: "human" }, onReceipt: async () => {} });
  revision = published.revision!;
  await remove(); await restoreVaultTextpack(restore());
  const file = (await readVaultTextpack(location()))!;
  expect(Object.keys(unzipSync(file.bytes)).some(name => name === "publication.json" || name.endsWith("/publication.json"))).toBe(false);
});

it("does not merge an old baseline even when incoming bytes carry the restored marker", async () => {
  await remove(); await restoreVaultTextpack(restore());
  const restored = (await readVaultTextpack(location()))!;
  const opened = openPack(restored.bytes, restored.relativePath, restored.revision, itemId);
  const incoming = encodePack(opened, { ...opened.file, markdown: opened.file.markdown + "\nOld baseline edit" });
  const result = await writeVaultTextpack({ ...location(), operationId: "mixed-generation", relativePath: restored.relativePath, baseRevision: revision, bytes: incoming });
  expect(result.status).toBe("conflict");
  expect((await readVaultTextpack(location()))!.bytes).toEqual(restored.bytes);
});
