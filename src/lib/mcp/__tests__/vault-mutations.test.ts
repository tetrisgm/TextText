import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import * as Y from "yjs";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { openPack } from "@/local-vault/pack";
import { readDocument } from "@/local-vault/model";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { documentSnapshotFromYDoc } from "@/lib/collab/document";
import { parseWorkspaceToolInput } from "@/lib/ai/tools";
import { buildTextpack } from "@/lib/github/textpack";
import { writeVaultTextpack, readVaultCollaboration, readVaultTextpack } from "@/sync/engine/store";
vi.mock("@/lib/store", async () => {
  const engine = await import("@/sync/engine/store");
  return {
    getUserIdBySub: async () => "actor", getOwnedBlog: async () => ({ handle: "fixture", name: "Fixture" }), getBlogEditRecord: async () => ({ id: "workspace", ownerId: "actor" }),
    readVaultTextpackIdentity: engine.readVaultTextpackIdentity, readVaultTextpack: engine.readVaultTextpack,
    mutateVaultDocument: (input: Parameters<typeof engine.mutateVaultDocument>[0] & { actorUserId: string }) => engine.mutateVaultDocument({ ...input, audit: { actorUserId: input.actorUserId, actorType: "external_agent" }, onReceipt: async () => {} }),
    writeVaultTextpack: (input: Parameters<typeof engine.writeVaultTextpack>[0] & { actorUserId: string }) => engine.writeVaultTextpack({ ...input, audit: { actorUserId: input.actorUserId, actorType: "external_agent" }, onReceipt: async () => {} }),
  };
});
vi.mock("@/auth", () => ({ auth: vi.fn(), isAuthConfigured: () => false }));
vi.mock("../vault-agent-presence", () => ({ withVaultAgentPresence: async (_context: unknown, action: () => Promise<unknown>) => action() }));
import { mutateVaultTool } from "../vault-mutations";
let root: string, revision: string;
const itemId = "11111111-1111-4111-8111-111111111111";
const authorize = vi.fn(async () => {});
const context = () => ({ root, workspaceId: "workspace", actorUserId: "actor", authorize });
beforeEach(async () => {
  vi.clearAllMocks(); root = await fs.mkdtemp(path.join(os.tmpdir(), "texttext-agent-command-"));
  const document = emptyDocumentSnapshot(); document.content.body = "Human original";
  const saved = await writeVaultTextpack({ root, workspaceId: "workspace", itemId, operationId: "seed", relativePath: "Notes/A.textpack", baseRevision: null, bytes: buildTextpack("Note", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\nHuman original` }) }); revision = saved.revision!;
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
async function body() {
  const state = await readVaultCollaboration({ root, workspaceId: "workspace", itemId });
  const doc = new Y.Doc(); try { Y.applyUpdate(doc, Buffer.from(state!.update, "base64")); return documentSnapshotFromYDoc(doc).content.body; } finally { doc.destroy(); }
}
describe("durable file MCP commands through public input schemas", () => {
  it("updates one photo's metadata through the public schema, retaining archive bytes and replaying once", async () => {
    const document = emptyDocumentSnapshot(); document.content.body = "Human original";
    document.content.assets = [{ id: "photo", kind: "image", src: "assets/photo.jpg", caption: "Keep caption" }, { id: "neighbor", kind: "image", src: "assets/neighbor.jpg", summary: "Keep neighbor" }];
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const saved = await writeVaultTextpack({ root, workspaceId: "workspace", itemId, operationId: "photo-seed", relativePath: "Notes/A.textpack", baseRevision: revision, bytes: buildTextpack("Note", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\nHuman original`, files: { "assets/photo.jpg": bytes } }) });
    const args = parseWorkspaceToolInput("update_item", { id: itemId, asset_metadata: { id: "photo", summary: "Generated summary", tags: ["light"] }, if_match_hash: saved.revision, idempotency_key: "photo-metadata" });
    await mutateVaultTool("update_item", args, context());
    const pack = await readVaultTextpack({ root, workspaceId: "workspace", itemId });
    const content = readDocument(openPack(pack!.bytes, "Notes/A.textpack", pack!.revision).file).content;
    expect(content.body).toBe("Human original");
    expect(content.assets).toEqual([{ ...document.content.assets[0], summary: "Generated summary", tags: ["light"] }, document.content.assets[1]]);
    expect(unzipSync(pack!.bytes)["Note.textbundle/assets/photo.jpg"]).toEqual(bytes);
    await mutateVaultTool("update_item", args, context());
    expect((await readVaultTextpack({ root, workspaceId: "workspace", itemId }))!.revision).toBe(pack!.revision);
    await expect(mutateVaultTool("update_item", { ...args, idempotency_key: "stale-photo", asset_metadata: { id: "photo", summary: "Stale replacement" } }, context())).rejects.toThrow("changed");
  });
  it.each(["create_item", "update_item"])("reads only a matching completed %s receipt without starting new writes", async name => {
    const args = name === "create_item" ? { title: "Receipt", body: "Once", idempotency_key: "receipt" } : { id: itemId, body: "Changed once", if_match_hash: revision, idempotency_key: "receipt" };
    await expect(mutateVaultTool(name, args, { ...context(), receiptOnly: true })).rejects.toThrow("No completed receipt");
    const result = await mutateVaultTool(name, args, context());
    expect(await mutateVaultTool(name, args, { ...context(), receiptOnly: true })).toEqual(result);
    await expect(mutateVaultTool(name, { ...args, body: "Different" }, { ...context(), receiptOnly: true })).rejects.toThrow("Operation id was reused");
    authorize.mockRejectedValueOnce(new Error("revoked"));
    await expect(mutateVaultTool(name, args, { ...context(), receiptOnly: true })).rejects.toThrow("revoked");
  });
  it("routes documented public append through the canonical executor to a real file", async () => {
    vi.stubEnv("TEXTTEXT_VAULT_ROOT", root);
    const { executeMcpTool } = await import("../tools");
    const authInfo = { token: "test", clientId: "test", scopes: ["sync"], extra: { sub: "subject", userId: "actor", connectionId: "test-connection" } };
    const result = await executeMcpTool("append_to_item", { id: itemId, markdown: "Public append", if_match_hash: revision, idempotency_key: "public-event" }, { authInfo });
    expect(result.isError).not.toBe(true);
    expect(await body()).toBe("Human original\n\nPublic append");
    vi.unstubAllEnvs();
  });
  it("replays a lost append acknowledgement exactly once despite the stale original hash", async () => {
    const args = parseWorkspaceToolInput("append_to_item", { id: itemId, markdown: "Agent append", if_match_hash: revision, idempotency_key: "event" });
    const first = await mutateVaultTool("append_to_item", args, context());
    const second = await mutateVaultTool("append_to_item", args, context());
    expect(second).toEqual(first); expect(await body()).toBe("Human original\n\nAgent append");
    await expect(mutateVaultTool("append_to_item", { ...args, markdown: "different" }, context())).rejects.toThrow("Operation id was reused");
  });
  it("rejects stale replacement and revoked replay without losing the original", async () => {
    const args = parseWorkspaceToolInput("update_item", { id: itemId, body: "Replace", if_match_hash: "a".repeat(64) });
    await expect(mutateVaultTool("update_item", args, context())).rejects.toThrow("changed");
    expect(await body()).toBe("Human original");
    authorize.mockRejectedValueOnce(new Error("revoked"));
    await expect(mutateVaultTool("update_item", { ...args, if_match_hash: revision }, context())).rejects.toThrow("revoked");
  });
  it("checks revocation inside the commit lock even when replaying a successful command", async () => {
    const args = { id: itemId, markdown: "Once", if_match_hash: revision, idempotency_key: "replay-revocation" };
    await mutateVaultTool("append_to_item", args, context());
    authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked under lock"));
    await expect(mutateVaultTool("append_to_item", args, context())).rejects.toThrow("revoked under lock");
    expect(await body()).toBe("Human original\n\nOnce");
  });
  it("serializes competing full replacements and preserves opaque files on section edits", async () => {
    const attempts = await Promise.allSettled(["One", "Two"].map((body) => mutateVaultTool("update_item", { id: itemId, body, if_match_hash: revision }, context())));
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const current = await readVaultTextpack({ root, workspaceId: "workspace", itemId });
    const document = emptyDocumentSnapshot(); document.content.body = "# Heading\n\nOld section";
    const asset = new Uint8Array([0, 255, 17, 4]);
    const saved = await writeVaultTextpack({ root, workspaceId: "workspace", itemId, operationId: "opaque-fixture", relativePath: "Notes/A.textpack", baseRevision: current!.revision,
      bytes: buildTextpack("Note", { document, markdown: `---\ntextTextId: ${itemId}\n---\n\n${document.content.body}`, files: { "assets/opaque.bin": asset } }) });
    await mutateVaultTool("update_item", { id: itemId, section: "Heading", expected_section_body: "Old section", body: "New section", if_match_hash: saved.revision }, context());
    const pack = await readVaultTextpack({ root, workspaceId: "workspace", itemId });
    expect(unzipSync(pack!.bytes)["Note.textbundle/assets/opaque.bin"]).toEqual(asset);
    expect(await body()).toContain("New section");
  });
  it("creates a readable deterministic file and replays create without duplication", async () => {
    const args = parseWorkspaceToolInput("create_item", { title: "New note", kind: "note", idempotency_key: "event" });
    const first = await mutateVaultTool("create_item", args, context());
    expect(await mutateVaultTool("create_item", args, context())).toEqual(first);
    expect(first.relativePath).toMatch(/^Notes\/New note-[a-f0-9]{8}\.textpack$/);
  });
  it("captures plain text and URLs into canonical files without fetching", async () => {
    for (const [capture, folder, kind] of [["Remember this\nThe complete thought.", "Notes", "note"], ["https://example.com/article", "Bookmarks", "bookmark"]]) {
      const args = parseWorkspaceToolInput("create_item", { capture, idempotency_key: capture });
      const result = await mutateVaultTool("create_item", args, context());
      expect(result.relativePath).toMatch(new RegExp(`^${folder}/`));
      expect(await mutateVaultTool("create_item", args, context())).toEqual(result);
      const pack = await readVaultTextpack({ root, workspaceId: "workspace", itemId: result.itemId });
      const entries = unzipSync(pack!.bytes);
      const document = JSON.parse(new TextDecoder().decode(entries["Document.textbundle/document.json"]));
      expect(document.presentation.template.id).toBe(`texttext.${kind}`);
      if (kind === "bookmark") expect(document.content.fields.sourceUrl).toBe(capture);
      else expect(document.content.body).toBe("The complete thought.");
    }
  });
  it("imports Markdown frontmatter and body with a fresh stable file identity", async () => {
    const markdown = '---\ntitle: Imported note\ntype: note\ntags: ["one", "two"]\nexcerpt: Summary\ncustomKey: preserved\n---\n\n# Body\n\nKeep this exactly.';
    const result = await mutateVaultTool("create_item", { markdown, idempotency_key: "markdown-import" }, context());
    const pack = await readVaultTextpack({ root, workspaceId: "workspace", itemId: result.itemId });
    const entries = unzipSync(pack!.bytes);
    const document = JSON.parse(new TextDecoder().decode(entries["Document.textbundle/document.json"]));
    expect(document.content).toMatchObject({ title: "Imported note", subtitle: "Summary", tags: ["one", "two"], body: "# Body\n\nKeep this exactly." });
    expect(new TextDecoder().decode(entries["Document.textbundle/text.md"])).toContain("customKey: preserved");
    expect(await mutateVaultTool("create_item", { markdown, idempotency_key: "markdown-import" }, context())).toEqual(result);
    await expect(mutateVaultTool("create_item", { markdown: '---\nstatus: published\n---\nBody' }, context())).rejects.toThrow("private");
    await expect(mutateVaultTool("create_item", { capture: "https://user:secret@example.com" }, context())).rejects.toThrow("without credentials");
  });
  it("fails closed on unsupported metadata and unsafe folders", async () => {
    await expect(mutateVaultTool("update_item", { id: itemId, status: "published" }, context())).rejects.toThrow("Unsupported");
    await expect(mutateVaultTool("create_item", { folder_path: "../private" }, context())).rejects.toThrow("Invalid folder");
  });
});


describe("custom template creation under the file commit lock", () => {
  async function template(version: number) {
    const id = `template-${version}`;
    const definition = { ...structuredClone(requireBuiltinTemplate("texttext.note")), id: "custom.research", version,
      fields: [{ id: "sourceUrl", label: "Source", type: "url" as const }, { id: "summary", label: "Summary", type: "text" as const }],
      starter: { title: `Research ${version}`, body: `# Findings ${version}`, fields: { sourceUrl: "https://example.com", summary: "Starter" } } };
    const document = emptyDocumentSnapshot({ id: definition.id, version });
    const result = await writeVaultTextpack({ root, workspaceId: "workspace", itemId: id, operationId: `seed-template-${version}`,
      relativePath: `Templates/${id}.textpack`, baseRevision: null,
      bytes: buildTextpack("Template", { document, template: definition, markdown: `---\ntextTextId: ${id}\n---\n` }) });
    return result;
  }
  const templateContext = () => ({ ...context(), authorizeTemplate: vi.fn(async () => {}) });
  async function read(id: string) {
    const pack = await readVaultTextpack({ root, workspaceId: "workspace", itemId: id });
    return { pack: pack!, document: readDocument(openPack(pack!.bytes, pack!.relativePath, pack!.revision, id).file) };
  }
  it("seeds latest or pinned starters and preserves the exact original receipt after a new version", async () => {
    await template(1);
    const args = parseWorkspaceToolInput("create_item", { template_id: "custom.research", idempotency_key: "starter" });
    const context = templateContext();
    const first = await mutateVaultTool("create_item", args, context);
    const original = await read(first.itemId);
    expect(original.document.content.title).toBe("Research 1");
    expect(original.document.content.body).toBe("# Findings 1");
    expect(original.pack.relativePath).toContain("Notes/Research 1-");
    await template(2);
    expect(await mutateVaultTool("create_item", args, context)).toEqual(first);
    expect((await read(first.itemId)).pack.bytes).toEqual(original.pack.bytes);
    const latest = await mutateVaultTool("create_item", { ...args, idempotency_key: "latest" }, context);
    expect((await read(latest.itemId)).document.presentation.template.version).toBe(2);
    const pinned = await mutateVaultTool("create_item", { ...args, template_version: 1, title: "Mine", body: "My writing", fields: { summary: "" }, idempotency_key: "pinned" }, context);
    expect((await read(pinned.itemId)).document.content).toMatchObject({ title: "Mine", body: "My writing" });
    expect((await read(pinned.itemId)).document.presentation.template.version).toBe(1);
    expect((await read(pinned.itemId)).document.content.fields).toMatchObject({ sourceUrl: "https://example.com", summary: "" });
    context.authorizeTemplate.mockRejectedValue(new Error("revoked"));
    await expect(mutateVaultTool("create_item", args, context)).rejects.toThrow("revoked");
    expect((await read(first.itemId)).pack.bytes).toEqual(original.pack.bytes);
  });
  it("keeps root destinations valid, skips invalid unrelated templates, and rejects unbound versions", async () => {
    await template(1);
    const invalidId = "invalid-template";
    const document = emptyDocumentSnapshot();
    const malformed = await writeVaultTextpack({ root, workspaceId: "workspace", itemId: invalidId, operationId: "invalid-seed",
      relativePath: "Templates/invalid.textpack", baseRevision: null,
      bytes: buildTextpack("Invalid", { document, markdown: `---\ntextTextId: ${invalidId}\n---\n` }) });
    await fs.writeFile(path.join(root, "workspace", malformed.relativePath), "not an archive");
    const result = await writeVaultTextpack({ root, workspaceId: "workspace", itemId: "root-note", operationId: "root-template",
      relativePath: "Untitled.textpack", baseRevision: null,
      bytes: buildTextpack("Note", { document, markdown: "---\ntextTextId: root-note\n---\n" }),
      templateCreation: { id: "custom.research", titleDefault: true, bodyDefault: true, fieldsDefault: true, folderDefault: false },
      beforeTemplateRead: async () => {} });
    expect(result.relativePath).toBe("Research 1-root-not.textpack");
    expect((await read(result.itemId)).document.content.body).toBe("# Findings 1");
    await expect(mutateVaultTool("create_item", { title: "Test", template_version: 1 }, templateContext())).rejects.toThrow("requires template_id");
  });
  it("rejects ambiguous versions and checks the resolved destination before publishing", async () => {
    const source = await template(1);
    await expect(mutateVaultTool("create_item", { template_id: "custom.research", idempotency_key: "denied-folder" },
      { ...templateContext(), authorize: async (_id, path) => { expect(path).toContain("Notes/Research 1-"); throw new Error("folder denied"); } })).rejects.toThrow("folder denied");
    const original = await readVaultTextpack({ root, workspaceId: "workspace", itemId: source.itemId });
    const pack = openPack(original!.bytes, original!.relativePath, original!.revision, source.itemId);
    const definition = JSON.parse(pack.file.templateJSON!);
    await writeVaultTextpack({ root, workspaceId: "workspace", itemId: "duplicate", operationId: "duplicate",
      relativePath: "Templates/duplicate.textpack", baseRevision: null,
      bytes: buildTextpack("Template", { document: readDocument(pack.file), template: definition, markdown: "---\ntextTextId: duplicate\n---\n" }) });
    await expect(mutateVaultTool("create_item", { template_id: "custom.research" }, templateContext())).rejects.toThrow("ambiguous");
  });
  it("fails closed when unavailable and detects a source changed during final authorization", async () => {
    const source = await template(1);
    const args = { template_id: "custom.research", idempotency_key: "race" };
    await expect(mutateVaultTool("create_item", args, { ...context(), authorizeTemplate: async () => { throw new Error("denied"); } })).rejects.toThrow("unavailable");
    let reads = 0;
    await expect(mutateVaultTool("create_item", args, { ...context(), authorizeTemplate: async () => {
      if (++reads === 2) await fs.appendFile(path.join(root, "workspace", source.relativePath), "changed");
    } })).rejects.toThrow("Template source changed");
    const files = await fs.readdir(path.join(root, "workspace", "Notes"));
    expect(files).toEqual(["A.textpack"]);
  });
});

it("updates declared custom fields through public dispatch with durable replay and preserves other content", async () => {
  vi.stubEnv("TEXTTEXT_VAULT_ROOT", root);
  const custom = { ...requireBuiltinTemplate("texttext.note"), id: "local.ratings", fields: [
    { id: "rating", label: "Rating", type: "number" as const, min: 0, max: 5, format: "plain" as const, required: false, visibility: "public" as const },
    { id: "summary", label: "Summary", type: "text" as const, maxLength: 100, required: false, visibility: "public" as const },
  ] };
  const document = emptyDocumentSnapshot({ id: custom.id, version: custom.version });
  document.content.body = "Human writing"; document.content.fields = { rating: 1, summary: "Keep", legacy: "Untouched" };
  const saved = await writeVaultTextpack({ root, workspaceId: "workspace", itemId, operationId: "custom-seed", relativePath: "Notes/A.textpack", baseRevision: revision, bytes: buildTextpack("Note", { document, template: custom, markdown: `---\ntextTextId: ${itemId}\n---\n\nHuman writing` }) });
  const args = parseWorkspaceToolInput("update_item", { id: itemId, fields: { rating: 4 }, if_match_hash: saved.revision, idempotency_key: "rate" });
  const { executeMcpTool } = await import("../tools");
  const authInfo = { token: "test", clientId: "test", scopes: ["sync"], extra: { sub: "subject", userId: "actor", connectionId: "fields-test" } };
  const result = await executeMcpTool("update_item", args, { authInfo });
  expect(result, JSON.stringify(result)).not.toHaveProperty("isError", true);
  const pack = (await readVaultTextpack({ root, workspaceId: "workspace", itemId }))!;
  const snapshot = readDocument(openPack(pack.bytes, pack.relativePath, pack.revision).file);
  expect(snapshot.content.fields).toEqual({ rating: 4, summary: "Keep", legacy: "Untouched" });
  expect(snapshot.content.body).toBe("Human writing"); expect(snapshot.presentation.template.id).toBe(custom.id);
  expect((await executeMcpTool("update_item", args, { authInfo })).structuredContent).toEqual(result.structuredContent);
  await expect(mutateVaultTool("update_item", { ...args, fields: { rating: 3 } }, context())).rejects.toThrow("reused");
  for (const fields of [{ rating: 6 }, { rating: "bad" }, { texttextRecordType: "template-retirement" }, { missing: "value" }]) {
    await expect(mutateVaultTool("update_item", { ...args, fields, if_match_hash: pack.revision, idempotency_key: JSON.stringify(fields) }, context())).rejects.toThrow();
    expect((await readVaultTextpack({ root, workspaceId: "workspace", itemId }))!.revision).toBe(pack.revision);
  }
  await expect(mutateVaultTool("update_item", { ...args, idempotency_key: "stale" }, context())).rejects.toThrow("changed");
  await mutateVaultTool("update_item", { ...args, fields: { rating: null }, if_match_hash: pack.revision, idempotency_key: "clear" }, context());
  const cleared = (await readVaultTextpack({ root, workspaceId: "workspace", itemId }))!;
  expect(readDocument(openPack(cleared.bytes, cleared.relativePath, cleared.revision).file).content.fields).toEqual({ summary: "Keep", legacy: "Untouched" });
  expect(await mutateVaultTool("update_item", args, { ...context(), receiptOnly: true })).toBeTruthy();
  authorize.mockRejectedValue(new Error("revoked"));
  await expect(mutateVaultTool("update_item", args, { ...context(), receiptOnly: true })).rejects.toThrow("revoked");
});

it("validates typed template field values without accepting unknown row properties", async () => {
  const { validateDocumentFieldMutation } = await import("@/lib/presentation/document-field-mutation");
  const { validateTemplateDefinition } = await import("@/lib/presentation/schema");
  const template = validateTemplateDefinition({ ...requireBuiltinTemplate("texttext.note"), fields: [
    { id: "state", label: "State", type: "enum", options: [{ value: "ready", label: "Ready" }] },
    { id: "steps", label: "Steps", type: "rows", maxRows: 1, fields: [{ id: "done", label: "Done", type: "boolean" }] },
    { id: "link", label: "Link", type: "url" },
  ] });
  expect(() => validateDocumentFieldMutation(template, { state: "ready", steps: [{ done: true }], link: "https://example.com" })).not.toThrow();
  for (const fields of [{ state: "other" }, { steps: [{ hidden: true }] }, { steps: [{ done: "yes" }] }, { steps: [{ done: true }, { done: false }] }, { link: "javascript:alert(1)" }] as Parameters<typeof validateDocumentFieldMutation>[1][]) {
    expect(() => validateDocumentFieldMutation(template, fields)).toThrow();
  }
});
