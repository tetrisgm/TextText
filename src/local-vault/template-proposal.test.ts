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
