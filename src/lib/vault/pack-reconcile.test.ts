import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { buildTextpack } from "@/lib/github/textpack";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { parsePostMarkdownFile } from "@/lib/markdown-files";
import { reconcileTextpacks } from "./pack-reconcile";

function pack(body = "one\ntwo\nthree", title = "Title") {
  const document = emptyDocumentSnapshot();
  document.content.body = body;
  document.content.title = title;
  return buildTextpack("Note", { document, markdown: `---\ntitle: ${JSON.stringify(title)}\n---\n\n${body}` });
}
function change(bytes: Uint8Array, entries: Record<string, string | Uint8Array | null>) {
  const files = unzipSync(bytes);
  for (const [name, value] of Object.entries(entries)) {
    if (value === null) delete files[`Note.textbundle/${name}`];
    else files[`Note.textbundle/${name}`] = typeof value === "string" ? strToU8(value) : new Uint8Array(value);
  }
  return zipSync(files, { mtime: new Date(1980, 0, 1) });
}

describe("full TextPack reconciliation", () => {
  it("preserves simultaneous file appends at the same position exactly once", () => {
    const base = pack("Shared 🌍");
    const local = change(base, { "text.md": '---\ntitle: "Title"\n---\n\nShared 🌍\nPC CLI edit' });
    const remote = pack("Shared 🌍\nMac editor edit");
    const result = reconcileTextpacks(base, local, remote);
    expect(result.status).toBe("merged");
    if (result.status !== "merged") throw new Error("Expected merge");
    const files = unzipSync(result.bytes);
    const expected = "Shared 🌍\nMac editor edit\nPC CLI edit";
    expect(JSON.parse(strFromU8(files["Note.textbundle/document.json"])).content.body).toBe(expected);
    expect(parsePostMarkdownFile(strFromU8(files["Note.textbundle/text.md"])).body).toBe(expected);
  });

  it("merges Markdown-only agent edits with app title changes and preserves assets", () => {
    const base = change(pack(), { "assets/image.bin": new Uint8Array([0, 255, 4]) });
    const local = change(base, { "text.md": '---\ntitle: "Title"\n---\n\nONE\ntwo\nthree' });
    const remote = change(pack("one\ntwo\nthree", "Renamed"), { "assets/image.bin": new Uint8Array([0, 255, 4]) });
    const result = reconcileTextpacks(base, local, remote);
    expect(result.status).toBe("merged");
    if (result.status !== "merged") throw new Error("Expected merge");
    const files = unzipSync(result.bytes);
    expect(JSON.parse(strFromU8(files["Note.textbundle/document.json"])).content).toMatchObject({ title: "Renamed", body: "ONE\ntwo\nthree" });
    const parsed = parsePostMarkdownFile(strFromU8(files["Note.textbundle/text.md"]));
    expect(parsed.fields.title).toBe("Renamed");
    expect(parsed.body).toBe("ONE\ntwo\nthree");
    expect(files["Note.textbundle/assets/image.bin"]).toEqual(new Uint8Array([0, 255, 4]));
  });

  it("preserves independent binary additions but refuses concurrent binary edits", () => {
    const base = change(pack(), { "assets/a.bin": new Uint8Array([1]) });
    const local = change(base, { "assets/b.bin": new Uint8Array([2]) });
    const remote = change(base, { "assets/c.bin": new Uint8Array([3]) });
    const result = reconcileTextpacks(base, local, remote);
    expect(result.status).toBe("merged");
    if (result.status !== "merged") throw new Error("Expected merge");
    expect(Object.keys(unzipSync(result.bytes))).toEqual(expect.arrayContaining([
      "Note.textbundle/assets/a.bin", "Note.textbundle/assets/b.bin", "Note.textbundle/assets/c.bin",
    ]));
    expect(reconcileTextpacks(base, change(base, { "assets/a.bin": new Uint8Array([2]) }), change(base, { "assets/a.bin": new Uint8Array([3]) }))).toEqual({ status: "conflict", paths: ["/entries/assets/a.bin"] });
  });

  it("refuses overlapping document edits and template deletion against edits", () => {
    expect(reconcileTextpacks(pack(), pack("left"), pack("right"))).toMatchObject({ status: "conflict" });
    const base = change(pack(), { "template.json": '{"version":1}' });
    expect(reconcileTextpacks(base, change(base, { "template.json": null }), change(base, { "template.json": '{"version":2}' }))).toEqual({ status: "conflict", paths: ["/entries/template.json"] });
  });

  it("preserves independent non-document frontmatter metadata", () => {
    const base = pack();
    const local = change(base, { "text.md": '---\ntitle: "Title"\nstarred: true\n---\n\none\ntwo\nthree' });
    const remote = change(base, { "text.md": '---\ntitle: "Title"\nstatus: "published"\n---\n\none\ntwo\nthree' });
    const result = reconcileTextpacks(base, local, remote);
    expect(result.status).toBe("merged");
    if (result.status !== "merged") throw new Error("Expected merge");
    const markdown = strFromU8(unzipSync(result.bytes)["Note.textbundle/text.md"]);
    expect(markdown).toContain("starred: true");
    expect(markdown).toContain('status: "published"');
  });
});
