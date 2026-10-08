import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { getBuiltinTemplate } from "@/lib/presentation/templates";
import { prepareTemplateProposal } from "./template-proposal";
import type { VaultFile } from "./bridge";

const template = getBuiltinTemplate("texttext.note", 1)!;
const document = emptyDocumentSnapshot({ id: template.id, version: template.version });
const file: VaultFile = { path: "Notes/Research.textpack", hash: "a".repeat(64),
  markdown: "---\ntextTextId: abc\ncustom: keep\n---\n\nUnchanged writing.\n", documentJSON: JSON.stringify({ ...document, content: { ...document.content, fields: { custom: "keep" } } }), templateJSON: JSON.stringify(template),
  assets: [{ filename: "original.bin", contentType: "application/octet-stream", data: "AQID" }] };
const proposal = { path: file.path, hash: file.hash, templateJSON: JSON.stringify({ ...template, name: "My research reader" }) };

describe("file template previews", () => {
  it("changes only presentation and preserves exact Markdown and unknown snapshot metadata", () => {
    const before = JSON.stringify(file);
    const result = prepareTemplateProposal(file, proposal);
    expect(result.payload.markdown).toBe(file.markdown);
    expect(JSON.parse(result.payload.documentJSON).content.fields).toEqual({ custom: "keep" });
    expect(result.document.content.body).toBe("Unchanged writing.\n");
    expect(result.template.name).toBe("My research reader");
    expect(JSON.stringify(file)).toBe(before);
    expect(result.payload).not.toHaveProperty("assets");
  });
  it("rejects changed or different files instead of overwriting intervening edits", () => {
    expect(() => prepareTemplateProposal({ ...file, hash: "b".repeat(64) }, proposal)).toThrow(/changed/);
    expect(() => prepareTemplateProposal({ ...file, path: "Other.textpack" }, proposal)).toThrow(/changed/);
  });
  it("rejects executable layouts and mismatched authoring source before rendering", () => {
    expect(() => prepareTemplateProposal(file, { ...proposal, templateJSON: JSON.stringify({ ...template, item: { type: "script", code: "alert(1)" } }) })).toThrow();
    expect(() => prepareTemplateProposal(file, { ...proposal, templateAuthoringSourceJSON: '{"schemaVersion":99}' })).toThrow();
  });
});

import { prepareTemplateCommandPreview } from "./template-command-preview";

describe("persisted template command previews", () => {
  const blueprint = { name: "Research", fields: [{ id: "rating", label: "Rating", type: "number" }], collection: { layout: "list" }, starter: { body: "Starter, not this document" } };
  it("validates the blueprint against frozen real writing without editing the file", () => {
    const before = JSON.stringify(file);
    const result = prepareTemplateCommandPreview("create_item_type", { blueprint }, file);
    expect(result.document.content.body).toBe("Unchanged writing.\n");
    expect(result.template.name).toBe("Research");
    expect(result.proposal.hash).toBe(file.hash);
    expect(JSON.stringify(file)).toBe(before);
    expect(() => prepareTemplateCommandPreview("create_item_type", { blueprint: { ...blueprint, item: { type: "script" } } }, file)).toThrow();
  });
  it("rejects stale or incompatible update sources and preserves the base definition", () => {
    const original = { ...template, id: "local.research" };
    const source = { ...file, path: "Templates/Research.textpack", templateJSON: JSON.stringify(original), documentJSON: JSON.stringify({ ...document, presentation: { ...document.presentation, template: { id: original.id, version: original.version } } }) };
    const args = { template_id: original.id, base_version: original.version, source_hash: source.hash, definition: { ...original, name: "Improved" } };
    const result = prepareTemplateCommandPreview("update_item_type", args, file, source);
    expect(result.template.version).toBe(original.version + 1);
    expect(result.document.content.body).toBe("Unchanged writing.\n");
    expect(() => prepareTemplateCommandPreview("update_item_type", { ...args, source_hash: "stale" }, file, source)).toThrow(/changed/);
    expect(() => prepareTemplateCommandPreview("update_item_type", { ...args, base_version: 999 }, file, source)).toThrow(/changed/);
  });
});


describe("apply-template approval previews", () => {
  it("binds a built-in design to the exact file identity and hash", () => {
    const args = { id: "abc", if_match_hash: file.hash, template_id: "texttext.note", template_version: 1 };
    const prepared = prepareTemplateCommandPreview("set_item_template", args, file);
    expect(prepared.document.content.body).toBe("Unchanged writing.\n");
    expect(prepared.payload.markdown).toBe(file.markdown);
    expect(() => prepareTemplateCommandPreview("set_item_template", { ...args, id: "other" }, file)).toThrow(/changed/);
    expect(() => prepareTemplateCommandPreview("set_item_template", { ...args, if_match_hash: "stale" }, file)).toThrow(/changed/);
    expect(() => prepareTemplateCommandPreview("set_item_template", { ...args, template_id: "missing" }, file)).toThrow(/unavailable/);
  });
  it("requires the pinned custom source identity, version and revision", () => {
    const source = { ...file, path: "Templates/Look.textpack" };
    const args = { id: "abc", if_match_hash: file.hash, template_id: "texttext.note", template_version: 1, source_item_id: "abc", source_hash: file.hash };
    expect(prepareTemplateCommandPreview("set_item_template", args, file, source).template.id).toBe("texttext.note");
    expect(() => prepareTemplateCommandPreview("set_item_template", { ...args, source_item_id: "other" }, file, source)).toThrow(/changed/);
    expect(() => prepareTemplateCommandPreview("set_item_template", { ...args, source_hash: "stale" }, file, source)).toThrow(/changed/);
    expect(() => prepareTemplateCommandPreview("set_item_template", { ...args, template_version: 2 }, file, source)).toThrow(/changed/);
  });
});
