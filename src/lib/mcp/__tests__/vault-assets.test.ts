import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { unzipSync, zipSync } from "fflate";
import { prepareVisualAsset } from "@/lib/visual-assets";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { buildTextpack } from "@/lib/github/textpack";
import { openPack } from "@/local-vault/pack";
import { readDocument } from "@/local-vault/model";
import { mutateVaultDocument, readVaultTextpack, readVaultCollaboration, writeVaultTextpack } from "@/sync/engine/store";
const fetchImage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/vault/image-fetch", () => ({ preparePublicImage: fetchImage }));
vi.mock("@/lib/store", async () => {
 const engine = await import("@/sync/engine/store");
 return { getUserIdBySub: async () => "actor", getOwnedBlog: async () => ({ handle: "fixture", name: "Fixture" }), getBlogEditRecord: async () => ({ id: "workspace", ownerId: "actor" }), readVaultTextpackIdentity: engine.readVaultTextpackIdentity, readVaultTextpack: engine.readVaultTextpack,
 mutateVaultDocument: (input: Parameters<typeof engine.mutateVaultDocument>[0] & { actorUserId: string }) => engine.mutateVaultDocument({ ...input, audit: { actorUserId: input.actorUserId, actorType: "external_agent" }, onReceipt: async () => {} }) };
});
vi.mock("@/auth", () => ({ auth: vi.fn(), isAuthConfigured: () => false }));
vi.mock("../vault-agent-presence", () => ({ withVaultAgentPresence: async (_context: unknown, action: () => Promise<unknown>) => action() }));
let root: string, revision: string, prepared: Awaited<ReturnType<typeof prepareVisualAsset>>;
const id = "11111111-1111-4111-8111-111111111111";
const prepare = vi.fn(); const authorize = vi.fn(async () => {});
const loc = () => ({ root, workspaceId: "workspace", itemId: id });
const request = () => ({ ...loc(), operationId: "asset", expectedRevision: revision, mutation: {}, attachment: { request: { sourceUrl: "https://example.com/photo.png", placement: "gallery" as const }, prepare }, audit: { actorUserId: "actor", actorType: "external_agent" as const }, beforeCommit: authorize, onReceipt: async () => {} });
beforeEach(async () => {
 root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-assets-")); vi.resetAllMocks();
 const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
 prepared = await prepareVisualAsset({ name: "image.png", size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer }); prepare.mockResolvedValue(prepared); fetchImage.mockResolvedValue(prepared);
 const template = requireBuiltinTemplate("texttext.article"); const document = emptyDocumentSnapshot({ id: template.id, version: template.version }); document.content.body = "Human writing";
 const entries = unzipSync(buildTextpack("Note", { document, template, markdown: `---\ntextTextId: ${id}\n---\n\nHuman writing` })); entries["opaque.bin"] = new Uint8Array([7, 8]);
 revision = (await writeVaultTextpack({ ...loc(), operationId: "seed", relativePath: "Blog/A.textpack", baseRevision: null, bytes: zipSync(entries) })).revision!;
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
it.each(["gallery", "cover", "body_end"] as const)("atomically attaches %s bytes, mapping and document in the same epoch", async placement => {
 const before = await readVaultCollaboration(loc()); const input = request(); input.attachment.request = { ...input.attachment.request, placement } as typeof input.attachment.request;
 const receipt = await mutateVaultDocument(input); const pack = (await readVaultTextpack(loc()))!; const opened = openPack(pack.bytes, pack.relativePath, pack.revision);
 const doc = readDocument(opened.file); const asset = doc.content.assets[0];
 expect(doc.content.assets).toHaveLength(1); expect(unzipSync(pack.bytes)[opened.prefix + asset.src]).toEqual(new Uint8Array(prepared.original)); expect(unzipSync(pack.bytes)["opaque.bin"]).toEqual(new Uint8Array([7, 8]));
 expect(opened.file.assets?.some(a => a.filename.endsWith(".png"))).toBe(true);
 expect((await readVaultCollaboration(loc()))!.epoch).toBe(before!.epoch);
 if (placement === "cover") expect(doc.content.fields.cover).toBe(asset.src);
 if (placement === "body_end") expect(doc.content.body).toContain(`](${asset.src})`); else expect(doc.content.body).toBe("Human writing");
 expect(await mutateVaultDocument(input)).toEqual(receipt); expect(prepare).toHaveBeenCalledOnce();
 await expect(mutateVaultDocument({ ...input, attachment: { ...input.attachment, request: { ...input.attachment.request, sourceUrl: "https://example.com/other.png" } } })).rejects.toThrow("reused");
});
it("rechecks edits and permission after unlocked preparation without committing orphan bytes", async () => {
 prepare.mockImplementation(async () => { await mutateVaultDocument({ ...request(), attachment: undefined, operationId: "peer", mutation: { appendBody: "Peer" } }); return prepared; });
 await expect(mutateVaultDocument(request())).rejects.toThrow("changed");
 expect(readDocument(openPack((await readVaultTextpack(loc()))!.bytes, "Blog/A.textpack", "").file).content.assets).toEqual([]);
 expect(prepare).toHaveBeenCalledOnce();
});
it("rejects revoked and expired operations before fetching and recovers lost audit ACK without refetching", async () => {
 await expect(mutateVaultDocument({ ...request(), receiptOnly: true })).rejects.toThrow("No completed receipt"); expect(prepare).not.toHaveBeenCalled();
 authorize.mockRejectedValueOnce(new Error("revoked")); await expect(mutateVaultDocument(request())).rejects.toThrow("revoked"); expect(prepare).not.toHaveBeenCalled();
 let fail = true; const input = { ...request(), onReceipt: async () => { if (fail) { fail = false; throw new Error("lost ACK"); } } };
 await expect(mutateVaultDocument(input)).rejects.toThrow("lost ACK"); const receipt = await mutateVaultDocument(input); expect(await mutateVaultDocument({ ...input, receiptOnly: true })).toEqual(receipt); expect(prepare).toHaveBeenCalledOnce();
 authorize.mockRejectedValue(new Error("revoked")); await expect(mutateVaultDocument(input)).rejects.toThrow("revoked");
});

it("routes the public image command to canonical files with a stable key and no refetch on replay", async () => {
 vi.stubEnv("TEXTTEXT_VAULT_ROOT", root);
 const { executeMcpTool } = await import("../tools");
 const authInfo = { token: "fixture", clientId: "fixture", scopes: ["sync"], extra: { sub: "subject", userId: "actor", connectionId: "asset-fixture" } };
 const args = { id, source_url: "https://example.com/photo.png", placement: "gallery", if_match_hash: revision, idempotency_key: "public-asset" };
 const first = await executeMcpTool("add_item_asset", args, { authInfo });
 expect(first, JSON.stringify(first)).not.toHaveProperty("isError", true);
 expect((await executeMcpTool("add_item_asset", args, { authInfo })).structuredContent).toEqual(first.structuredContent);
 expect(fetchImage).toHaveBeenCalledOnce();
 expect((await executeMcpTool("add_item_asset", args, { authInfo: { ...authInfo, scopes: ["readonly"] } })).isError).toBe(true);
});
it("does not write when access is revoked during preparation", async () => {
 prepare.mockImplementation(async () => { authorize.mockRejectedValue(new Error("revoked")); return prepared; });
 await expect(mutateVaultDocument(request())).rejects.toThrow("revoked");
 expect((await readVaultTextpack(loc()))!.revision).toBe(revision);
});
