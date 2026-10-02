import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { getBuiltinTemplate } from "@/lib/presentation/templates";
import { collectionDocument, collectionMembers, noteCardDocument, queryFolderMembers } from "./folder-collection";

const spec = getBuiltinTemplate("texttext.note", 1)!.collection;
const preview = (title: string, score: number) => ({ title, excerpt: "excerpt", document: { ...emptyDocumentSnapshot(), content: { ...emptyDocumentSnapshot().content, title, fields: { score } } } });
describe("folder collection projections", () => {
  it("limits a folder template to immediate children but preserves recursive All items", () => {
    const items = ["Root.textpack", "Folder view.textpack", "Deep/Child.textpack", "Templates/Note.textpack"].map((path) => ({ path }));
    expect(collectionMembers(items, "", true, "Folder view.textpack").map((item) => item.path)).toEqual(["Root.textpack"]);
    expect(collectionMembers(items, "", false)).toHaveLength(3);
  });
  it("orders members naturally by relative path before the caller paginates", () => {
    const items = Array.from({ length: 30 }, (_, index) => {
      const number = 30 - index;
      const name = number === 1 ? "Gallery 001" : number === 2 ? "gallery 2" : `Gallery ${number}`;
      return { path: `${name}.textpack` };
    });
    const firstPage = collectionMembers(items, "", false).slice(0, 24).map((item) => item.path);
    expect(firstPage[0]).toBe("Gallery 001.textpack");
    expect(firstPage[1]).toBe("gallery 2.textpack");
    expect(firstPage.at(-1)).toBe("Gallery 24.textpack");
  });
  it("sorts and filters all members before the caller paginates", () => {
    const items = Array.from({ length: 30 }, (_, index) => ({ path: `${index}.textpack` }));
    const previews = Object.fromEntries(items.map((item, index) => [item.path, preview(String(index), index)]));
    const result = queryFolderMembers(items, previews, { ...spec, sort: [{ field: "content.fields.score", direction: "desc" }], filters: [{ field: "content.fields.score", op: "gte", value: 5 }] });
    expect(result).toHaveLength(25);
    expect(result.slice(0, 24)[0].path).toBe("29.textpack");
    expect(result[24].path).toBe("5.textpack");
  });
  it("fails explicitly rather than treating unread metadata or unavailable dates as empty", () => {
    expect(() => queryFolderMembers([{ path: "a" }], {}, { ...spec, sort: [] })).toThrow(/details/);
    expect(() => queryFolderMembers([{ path: "a" }], { a: { ...preview("A", 1), metadataTruncated: true } }, { ...spec, sort: [] })).toThrow(/query limits/);
    expect(() => queryFolderMembers([], {}, { ...spec, sort: [{ field: "updatedAt", direction: "desc" }] })).toThrow(/Date sorting/);
  });
  it("uses only a bounded thumbnail and does not mutate the source snapshot", () => {
    const original = preview("Title", 1);
    Object.assign(original.document.content.fields, { cover: "https://example.com/original.jpg" });
    original.document.content.assets = [{ id: "original", kind: "image", src: "remote-original.jpg" }];
    const result = collectionDocument(original, "Fallback", "blob:thumbnail");
    expect(result.content.assets[0].src).toBe("blob:thumbnail");
    expect(result.content.fields.cover).toBe("blob:thumbnail");
    expect(collectionDocument(original, "Fallback").content.fields.cover).toBeUndefined();
    expect(original.document.content.fields).toHaveProperty("cover", "https://example.com/original.jpg");
    expect(original.document.content.assets[0].src).toBe("remote-original.jpg");
  });
  it("renders note cards from the formatted preview without changing list excerpts", () => {
    const card = { ...preview("Card", 1), cardBody: "Paragraph\n\n- First\n- Second" };
    expect(noteCardDocument(card, "Fallback").content.body).toBe(card.cardBody);
    expect(collectionDocument(card, "Fallback").content.body).toBe("excerpt");
  });
  it("sorts complete title metadata despite unrelated omitted article annotations", () => {
    const items = [{ path: "z" }, { path: "a" }];
    const previews = { z: { ...preview("Zulu", 2), metadataTruncated: true, incompleteFields: ["content.fields.annotations"] }, a: preview("Alpha", 1) };
    expect(queryFolderMembers(items, previews, { ...spec, sort: [{ field: "title", direction: "asc" }] }).map((item) => item.path)).toEqual(["a", "z"]);
    expect(() => queryFolderMembers(items, previews, { ...spec, sort: [{ field: "content.fields.annotations", direction: "asc" }] })).toThrow(/query limits/);
  });
});
