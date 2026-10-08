import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { requireBuiltinTemplate } from "@/lib/presentation/templates";
import { newItemPack } from "./new-item-pack";
import { openPack, replacePackIdentity } from "./pack";
import { readDocument } from "./model";

describe("complete new-item import", () => {
  it("contains writing, template and assets before the first filesystem write", () => {
    const template = requireBuiltinTemplate("texttext.note");
    const document = emptyDocumentSnapshot({ id: template.id, version: template.version });
    document.content.title = "Research";
    document.content.body = "## Findings\n\nAgent-written text.  \n\n![Evidence](assets/evidence.png)";
    document.content.fields = { category: "Research", texttextNoteColor: "blue" };
    const original = JSON.stringify(document);
    const data = new Uint8Array([1, 2, 3, 4]);
    const pack = openPack(newItemPack(document, { template }, [{ filename: "evidence.png", data, contentType: "image/png" }]), "Notes/Research.textpack", "revision");
    expect(readDocument(pack.file).content).toEqual(document.content);
    expect(JSON.parse(pack.file.templateJSON!)).toEqual(template);
    expect(pack.entries[pack.prefix + "assets/evidence.png"]).toEqual(data);
    expect(JSON.stringify(document)).toBe(original);
    // The import transport assigns a final identity without changing the content.
    expect(readDocument({ ...pack.file, markdown: replacePackIdentity(pack.file.markdown, "final-item") }).content).toEqual(document.content);
    expect(Object.keys(pack.entries).some(path => path.includes("private"))).toBe(false);
  });
  it("rejects an incompatible definition or invalid asset before an import can start", () => {
    const template = requireBuiltinTemplate("texttext.note");
    const document = emptyDocumentSnapshot({ id: template.id, version: template.version });
    expect(() => newItemPack(document, { template: { ...template, id: "local.other" } })).toThrow("does not match");
    expect(() => newItemPack(document, { template }, [{ filename: "../private", data: new Uint8Array() }])).toThrow("Invalid TextPack asset filename");
    expect(() => newItemPack(document, { template, sourceJSON: '{"unrecognized":true}' })).toThrow();
  });
});
