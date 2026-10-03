import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { strToU8, unzipSync } from "fflate";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { openPack, encodePack } from "@/local-vault/pack";
import { readDocument, writePayload } from "@/local-vault/model";
import { publishedVaultAsset, publishedVaultView, readVaultPublicationFromPack } from "./publication";
import { moveVaultTextpack, mutateVaultPublication, pushVaultCollaboration, readVaultCollaboration,
  readVaultTextpack, writeVaultTextpack, type VaultMutationReceipt } from "./server-store";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
const workspaceId = "workspace-1", itemId = "item-1";
const actor = { actorUserId: randomUUID(), actorType: "human" as const };
const originalPath = "Notes/Shared.textpack";

function pack(body: string, publication?: Uint8Array, template?: TemplateDefinition) {
  const document = emptyDocumentSnapshot();
  document.content.title = "Shared";
  document.content.body = body;
  document.content.tags = ["Private planning"];
  document.content.fields.secret = "Never in the public projection";
  document.content.assets = [{ id: "picture", kind: "image", src: "assets/picture.png" }];
  return buildTextpack("Shared", { document, template, markdown: `---\ntextTextId: ${itemId}\n---\n\n${body}`,
    files: { "assets/picture.png": png, "comments.json": strToU8("private discussion"),
      ...(publication ? { "publication.json": publication } : {}) } });
}

describe("file-backed vault publication", () => {
  let root: string;
  const receipts = vi.fn(async (receipt: VaultMutationReceipt) => { void receipt; });
  const location = () => ({ root, workspaceId, itemId, onReceipt: receipts });
  beforeEach(async () => {
    receipts.mockClear();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-vault-publication-"));
    await writeVaultTextpack({ ...location(), relativePath: originalPath, operationId: "seed",
      baseRevision: null, bytes: pack("First version\n\n![Picture](assets/picture.png)") });
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("publishes the saved revision, leaves private entries out of the public view, and revokes assets immediately", async () => {
    const before = (await readVaultTextpack(location()))!;
    expect(publishedVaultView(before.bytes, workspaceId, itemId)).toBeNull();
    const publishId = randomUUID();
    const publish = () => mutateVaultPublication({ ...location(), operationId: publishId,
      baseRevision: before.revision, published: true, audit: actor });
    const result = await publish();
    expect(result.status).toBe("written");
    expect(await publish()).toEqual(result);
    expect(receipts.mock.calls.map(([receipt]) => receipt.actionName)).toEqual(["vault.publish", "vault.publish"]);
    const published = (await readVaultTextpack(location()))!;
    const view = publishedVaultView(published.bytes, workspaceId, itemId)!;
    expect(view.document.content.body).toContain("First version");
    expect(view.document.content.fields).not.toHaveProperty("secret");
    expect(view.document.content.tags).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("Private planning");
    expect(JSON.stringify(view)).not.toContain("private discussion");
    expect(view.document.content.assets[0].src).toContain(`/api/public/vault/${workspaceId}/${itemId}/assets/picture.png`);
    expect(Buffer.from(publishedVaultAsset(published.bytes, workspaceId, itemId, "assets/picture.png")!.data).equals(png)).toBe(true);
    expect(publishedVaultAsset(published.bytes, workspaceId, itemId, "comments.json")).toBeNull();
    const unchanged = await mutateVaultPublication({ ...location(), operationId: randomUUID(),
      baseRevision: published.revision, published: true, audit: actor });
    expect(unchanged.status).toBe("unchanged");
    expect(receipts).toHaveBeenCalledTimes(2);
    const unpublish = await mutateVaultPublication({ ...location(), operationId: randomUUID(),
      baseRevision: published.revision, published: false, audit: actor });
    expect(unpublish.status).toBe("written");
    const privateAgain = (await readVaultTextpack(location()))!;
    expect(publishedVaultView(privateAgain.bytes, workspaceId, itemId)).toBeNull();
    expect(publishedVaultAsset(privateAgain.bytes, workspaceId, itemId, "assets/picture.png")).toBeNull();
    expect(receipts.mock.calls.at(-1)?.[0].actionName).toBe("vault.unpublish");
  });

  it("omits private template editor data from the public renderer props", () => {
    const source = requireBuiltinTemplate("texttext.article");
    const template: TemplateDefinition = { ...source, name: "Private look name", description: "Private look description",
      starter: { body: "Private starter" },
      example: { title: "Private example", body: "Private example body", fields: {}, tags: [] },
      collection: { ...source.collection, item: { type: "text", bind: "content.title", role: "title",
        fallback: "Private collection fallback" } } };
    const marker = strToU8(JSON.stringify({ schemaVersion: 1, status: "public",
      publishedAt: new Date().toISOString(), operationId: randomUUID() }));
    const view = publishedVaultView(pack("Published body", marker, template), workspaceId, itemId)!;
    expect(view.document.content.body).toBe("Published body");
    const clientProps = JSON.stringify(view);
    for (const value of ["Private look name", "Private look description", "Private starter",
      "Private example", "Private collection fallback", "Private planning"]) {
      expect(clientProps).not.toContain(value);
    }
  });

  it("uses saved story preview details for public metadata without exposing unbound fields", () => {
    const document = emptyDocumentSnapshot();
    document.content.title = "Article heading";
    document.content.subtitle = "Article subtitle";
    document.content.body = "Story body\n\n![Featured](assets/picture.png)";
    document.content.fields.texttextPreviewTitle = "Shared headline";
    document.content.fields.texttextPreviewSubtitle = "Shared description";
    document.content.fields.texttextFeaturedImage = "assets/picture.png";
    document.content.fields.secret = "Private field";
    document.content.assets = [{ id: "picture", kind: "image", src: "assets/picture.png" }];
    const bytes = buildTextpack("Article heading", { document,
      template: requireBuiltinTemplate("texttext.article"),
      markdown: `---\ntextTextId: ${itemId}\n---\n\n${document.content.body}`,
      files: { "assets/picture.png": png } });
    expect(publishedVaultView(bytes, workspaceId, itemId)).toBeNull();
    const marker = strToU8(JSON.stringify({ schemaVersion: 1, status: "public",
      publishedAt: new Date().toISOString(), operationId: randomUUID() }));
    const published = buildTextpack("Article heading", { document,
      template: requireBuiltinTemplate("texttext.article"),
      markdown: `---\ntextTextId: ${itemId}\n---\n\n${document.content.body}`,
      files: { "assets/picture.png": png, "publication.json": marker } });
    const view = publishedVaultView(published, workspaceId, itemId)!;
    expect(view.preview).toEqual({ title: "Shared headline", subtitle: "Shared description",
      imageUrl: `/api/public/vault/${workspaceId}/${itemId}/assets/picture.png` });
    expect(view.document.content.title).toBe("Article heading");
    expect(view.document.content.fields).not.toHaveProperty("texttextPreviewTitle");
    expect(view.document.content.fields).not.toHaveProperty("secret");
    expect(JSON.stringify(view)).not.toContain("Private field");
  });

  it("rejects marker injection/removal through ordinary writes, while stale document edits merge around a publish", async () => {
    const original = (await readVaultTextpack(location()))!;
    const forged = pack("First version\n\n![Picture](assets/picture.png)", strToU8(JSON.stringify({ schemaVersion: 1, status: "public",
      publishedAt: new Date().toISOString(), operationId: randomUUID() })));
    await expect(writeVaultTextpack({ ...location(), relativePath: originalPath, operationId: "forged",
      baseRevision: original.revision, bytes: forged })).rejects.toThrow("Publish or Unpublish");
    await expect(writeVaultTextpack({ ...location(), relativePath: "Injected.textpack", itemId: "injected",
      operationId: "import", baseRevision: null,
      bytes: buildTextpack("Injected", { document: emptyDocumentSnapshot(),
        markdown: "---\ntextTextId: injected\n---\n\n", files: { "publication.json": strToU8("{}") } }) })).rejects.toThrow("Publish or Unpublish");
    const published = await mutateVaultPublication({ ...location(), operationId: randomUUID(),
      baseRevision: original.revision, published: true, audit: actor });
    expect(published.status).toBe("written");
    const staleEdit = pack("An editor's saved text");
    const merged = await writeVaultTextpack({ ...location(), relativePath: originalPath, operationId: "stale-edit",
      baseRevision: original.revision, bytes: staleEdit });
    expect(merged.status).toBe("written");
    const live = (await readVaultTextpack(location()))!;
    expect(publishedVaultView(live.bytes, workspaceId, itemId)?.document.content.body).toBe("An editor's saved text");
    await expect(writeVaultTextpack({ ...location(), relativePath: originalPath, operationId: "strip-marker",
      baseRevision: live.revision, bytes: staleEdit })).rejects.toThrow("Publish or Unpublish");
    expect(readVaultPublicationFromPack((await readVaultTextpack(location()))!.bytes)).not.toBeNull();
    expect((await mutateVaultPublication({ ...location(), operationId: randomUUID(),
      baseRevision: original.revision, published: false, audit: actor })).status).toBe("stale");
  });

  it("keeps publication through a move, ordinary template save, and a Yjs checkpoint update", async () => {
    const before = (await readVaultTextpack(location()))!;
    const baseline = (await readVaultCollaboration(location()))!;
    await mutateVaultPublication({ ...location(), operationId: randomUUID(),
      baseRevision: before.revision, published: true, audit: actor });
    const afterPublish = (await readVaultCollaboration(location()))!;
    expect(afterPublish).toMatchObject({ epoch: baseline.epoch, seq: baseline.seq, update: baseline.update });
    const push = await pushVaultCollaboration({ ...location(), operationId: "yjs-push", epoch: afterPublish.epoch,
      updates: ["AAA="], audit: actor });
    expect(push.status).toBe("written");
    const current = (await readVaultTextpack(location()))!;
    expect(readVaultPublicationFromPack(current.bytes)).not.toBeNull();
    const opened = openPack(current.bytes, current.relativePath, current.revision, itemId);
    const document = readDocument(opened.file); document.content.body = "Saved through editor";
    const saved = encodePack(opened, writePayload(opened.file, document));
    await writeVaultTextpack({ ...location(), relativePath: originalPath, operationId: "editor-save",
      baseRevision: current.revision, bytes: saved });
    const edited = (await readVaultTextpack(location()))!;
    expect(readVaultPublicationFromPack(edited.bytes)).not.toBeNull();
    const moved = await moveVaultTextpack({ ...location(), operationId: "move", basePath: originalPath,
      baseRevision: edited.revision, relativePath: "Moved.textpack" });
    expect(moved.status).toBe("moved");
    const live = (await readVaultTextpack(location()))!;
    expect(live.relativePath).toBe("Moved.textpack");
    expect(publishedVaultView(live.bytes, workspaceId, itemId)?.document.content.body).toBe("Saved through editor");
    const entries = unzipSync(live.bytes);
    expect(Object.keys(entries).some(name => name.endsWith("/publication.json"))).toBe(true);
    expect(Object.keys(entries).some(name => name.endsWith("/comments.json"))).toBe(true);
  });

  it("rechecks owner authorization under the lock before changing visibility", async () => {
    const current = (await readVaultTextpack(location()))!;
    await expect(mutateVaultPublication({ ...location(), operationId: randomUUID(),
      baseRevision: current.revision, published: true, audit: actor,
      beforeCommit: async () => { throw new Error("Owner access revoked"); } })).rejects.toThrow("Owner access revoked");
    expect(readVaultPublicationFromPack((await readVaultTextpack(location()))!.bytes)).toBeNull();
    expect(receipts).not.toHaveBeenCalled();
  });
});
