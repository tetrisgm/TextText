import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { createFolderViewPack, readFolderView, resolveFolderView, folderViewMembers, updateFolderViewPack, folderViewPath } from "./folder-view";
import { openPack } from "./pack";

const template = BUILTIN_TEMPLATES.find((entry) => entry.id === "texttext.gallery")!;
function fixture(folder = "Gallery") {
  const result = createFolderViewPack(folder, template);
  return openPack(result.bytes, result.path, "revision-1");
}

describe("file-backed folder views", () => {
  it("creates a self-contained definition with a real identity and complete template", () => {
    const pack = fixture();
    const view = readFolderView(pack.file)!;
    expect(view.document.content.fields.texttextFolderView).toBe("v1");
    expect(view.template).toEqual(template);
    expect(pack.itemId).toBeTruthy();
    expect(fixture().itemId).not.toBe(pack.itemId);
    expect(resolveFolderView([pack.file], "Gallery")).toEqual(view);
    expect(resolveFolderView([pack.file], "")).toBeNull();
  });
  it("never recognizes or hides an ordinary file by its name", () => {
    const pack = fixture();
    const plain = { ...pack.file, documentJSON: JSON.stringify(emptyDocumentSnapshot()) };
    expect(readFolderView(plain)).toBeNull();
    expect(readFolderView({ ...plain, documentJSON: "broken JSON" })).toBeNull();
    expect(folderViewMembers([plain], "Gallery")).toEqual([plain]);
    expect(resolveFolderView([], "Gallery")).toBeNull();
    expect(() => createFolderViewPack("Gallery", template, [plain])).toThrow("already occupies");
    expect(() => createFolderViewPack("Gallery", template, [{ path: "gallery/FOLDER VIEW.textpack" }])).toThrow("already occupies");
  });
  it("selects immediate members without mutating, renaming, or reidentifying them", () => {
    const pack = fixture(), view = readFolderView(pack.file)!;
    const member = Object.freeze({ path: "Gallery/Photo.textpack", title: "Photo", id: "original-id" });
    const children = Object.freeze([pack.file, member, { path: "Gallery/Nested/Photo.textpack" }, { path: "Other/Photo.textpack" }]);
    expect(folderViewMembers(children, "Gallery", view)).toEqual([member]);
    expect(folderViewMembers(children, "Gallery", view)[0]).toBe(member);
    expect(() => folderViewMembers(children, "Other", view)).toThrow("different folder");
  });
  it("rejects malformed recognized definitions, unmatched templates, and ambiguous views", () => {
    const pack = fixture();
    expect(() => readFolderView({ ...pack.file, templateJSON: null })).toThrow("missing");
    expect(() => readFolderView({ ...pack.file, templateJSON: "{}" })).toThrow();
    const document = JSON.parse(pack.file.documentJSON!);
    document.content.fields.texttextFolderView = "v2";
    expect(() => readFolderView({ ...pack.file, documentJSON: JSON.stringify(document) })).toThrow("unsupported");
    document.content.fields.texttextFolderView = "v1";
    document.presentation.template.id = "other";
    expect(() => readFolderView({ ...pack.file, documentJSON: JSON.stringify(document) })).toThrow("do not match");
    expect(() => resolveFolderView([pack.file, { ...pack.file, path: "Gallery/Alternate.textpack" }], "Gallery")).toThrow("multiple");
  });
  it("stages only the view file with its revision, preserving identity and opaque entries", () => {
    const pack = fixture();
    const opaque = new Uint8Array([1, 2, 3]);
    pack.entries[pack.prefix + "assets/cover.bin"] = opaque;
    pack.entries[pack.prefix + "extension.json"] = new TextEncoder().encode('{"keep":true}');
    pack.file.markdown += "\nAuthor-maintained explanation, with trailing spaces.  \n";
    pack.file.templateAuthoringSourceJSON = '{"obsolete":true}';
    pack.entries[pack.prefix + "template-source.json"] = new TextEncoder().encode(pack.file.templateAuthoringSourceJSON);
    const before = JSON.stringify(pack.file);
    const custom = { ...template, id: "custom.contact-sheet", collection: { ...template.collection, columns: 4 as const } };
    const update = updateFolderViewPack(pack, "revision-1", custom);
    const reopened = openPack(update.bytes, update.path, "revision-2");
    expect(update.path).toBe(pack.file.path);
    expect(update.expectedHash).toBe("revision-1");
    expect(reopened.itemId).toBe(pack.itemId);
    expect(reopened.file.markdown).toBe(pack.file.markdown);
    expect(JSON.parse(reopened.file.documentJSON!).content).toEqual(JSON.parse(pack.file.documentJSON!).content);
    expect(reopened.file.templateAuthoringSourceJSON).toBeNull();
    expect(reopened.entries[pack.prefix + "template-source.json"]).toBeUndefined();
    expect(readFolderView(reopened.file)?.template.collection.columns).toBe(4);
    expect(reopened.entries[pack.prefix + "assets/cover.bin"]).toEqual(opaque);
    expect(reopened.entries[pack.prefix + "extension.json"]).toEqual(pack.entries[pack.prefix + "extension.json"]);
    expect(JSON.stringify(pack.file)).toBe(before);
    expect(() => updateFolderViewPack(pack, "stale", custom)).toThrow("changed");
  });
  it("rejects paths outside an ordinary folder", () => {
    for (const path of ["../Other", "/absolute", "A//B", "A/./B", "A\\B", "A\u0000B"]) expect(() => folderViewPath(path)).toThrow();
    expect(folderViewPath("")).toBe("Folder view.textpack");
  });
});
