import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { getBuiltinTemplate } from "@/lib/presentation/templates";
import { collectionDocument, collectionMembers, queryFolderMembers } from "./folder-collection";

const spec = getBuiltinTemplate("texttext.note", 1)!.collection;
const preview = (title: string, score: number) => ({ title, excerpt: "excerpt", document: { ...emptyDocumentSnapshot(), content: { ...emptyDocumentSnapshot().content, title, fields: { score } } } });
describe("folder collection projections", () => {
  it("limits a folder template to immediate children but preserves recursive All items", () => {
    const items = ["Root.textpack", "Folder view.textpack", "Deep/Child.textpack", "Templates/Note.textpack"].map((path) => ({ path }));
    expect(collectionMembers(items, "", true, "Folder view.textpack").map((item) => item.path)).toEqual(["Root.textpack"]);
    expect(collectionMembers(items, "", false)).toHaveLength(3);
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
    original.document.content.assets = [{ id: "original", kind: "image", src: "remote-original.jpg" }];
    const result = collectionDocument(original, "Fallback", "blob:thumbnail");
    expect(result.content.assets[0].src).toBe("blob:thumbnail");
    expect(original.document.content.assets[0].src).toBe("remote-original.jpg");
  });
});
