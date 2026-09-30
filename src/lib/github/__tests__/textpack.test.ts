import { describe, expect, it } from "vitest";
import { strToU8, unzipSync, zipSync } from "fflate";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildTextpack, gitBlobSha, parseTextpack, textpackFileName } from "../textpack";

describe("textpack", () => {
  const parts = { markdown: "---\ntitle: Hi\n---\n\nHello.\n", document: { schemaVersion: 1, content: { title: "Hi" } }, template: { id: "texttext.article", version: 1 }, sourceUrl: "https://example.com/a" };

  it("round-trips markdown, document, template, and source url", () => {
    const bytes = buildTextpack("hi", parts);
    const back = parseTextpack(bytes);
    expect(back.markdown).toBe(parts.markdown);
    expect(back.document).toEqual(parts.document);
    expect(back.template).toEqual(parts.template);
    expect(back.sourceUrl).toBe(parts.sourceUrl);
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual(["hi.textbundle/document.json", "hi.textbundle/info.json", "hi.textbundle/template.json", "hi.textbundle/text.md"]);
  });

  it("round-trips the editable template source only alongside its compiled template", () => {
    const templateAuthoringSource = { kind: "item-type-blueprint", schemaVersion: 1, blueprint: { name: "Hi" } };
    const bytes = buildTextpack("hi", { ...parts, templateAuthoringSource });
    expect(parseTextpack(bytes).templateAuthoringSource).toEqual(templateAuthoringSource);
    expect(Object.keys(unzipSync(bytes))).toContain("hi.textbundle/template-source.json");

    const withoutTemplate = buildTextpack("hi", { markdown: parts.markdown, document: parts.document, templateAuthoringSource });
    expect(parseTextpack(withoutTemplate).templateAuthoringSource).toBeUndefined();
    expect(Object.keys(unzipSync(withoutTemplate))).not.toContain("hi.textbundle/template-source.json");
  });

  it("keeps the document when optional template files contain invalid JSON", () => {
    const files = unzipSync(buildTextpack("hi", parts));
    files["hi.textbundle/template.json"] = strToU8("{");
    files["hi.textbundle/template-source.json"] = strToU8("{");
    const back = parseTextpack(zipSync(files));
    expect(back.document).toEqual(parts.document);
    expect(back.template).toBeUndefined();
    expect(back.templateAuthoringSource).toBeUndefined();
  });

  it("preserves binary assets, opaque files and extension metadata while editing", () => {
    const files = unzipSync(buildTextpack("hi", parts));
    const image = new Uint8Array([0, 255, 42, 128]);
    files["hi.textbundle/assets/photo.gif"] = image;
    files["hi.textbundle/extensions/private.dat"] = image;
    files["hi.textbundle/info.json"] = strToU8(JSON.stringify({ version: 2, sourceURL: parts.sourceUrl, custom: { keep: true }, "net.texttext.assets": { photo: { url: "https://example.com/photo" } } }));
    const parsed = parseTextpack(zipSync(files));
    const output = buildTextpack("renamed", { ...parsed, markdown: "Edited" });
    const back = parseTextpack(output);
    expect(back.markdown).toBe("Edited");
    expect(back.files!["assets/photo.gif"]).toEqual(image);
    expect(back.files!["extensions/private.dat"]).toEqual(image);
    expect(back.info?.custom).toEqual({ keep: true });
    expect(back.info?.["net.texttext.assets"]).toEqual({ photo: { url: "https://example.com/photo" } });
    expect(buildTextpack("renamed", back)).toEqual(output);
  });

  it("keeps every embedded image from the real portable gallery after a rename and edit", () => {
    const before = parseTextpack(readFileSync("presets/builtin/gallery.textpack"));
    const after = parseTextpack(buildTextpack("My gallery", { ...before, markdown: before.markdown + "\nMy note.\n" }));
    const assets = Object.keys(before.files!).filter((path) => path.startsWith("assets/"));
    expect(assets).toHaveLength(4);
    for (const path of assets) expect(after.files![path]).toEqual(before.files![path]);
    expect(after.templateAuthoringSource).toEqual(before.templateAuthoringSource);
  });

  it("refuses ambiguous roots, traversal and excessive expansion", () => {
    const files = unzipSync(buildTextpack("hi", parts));
    expect(() => parseTextpack(zipSync({ ...files, "other/text.md": strToU8("other") }))).toThrow(/root/);
    expect(() => parseTextpack(zipSync({ ...files, "hi.textbundle/../escape": strToU8("bad") }))).toThrow(/entry/);
    expect(() => buildTextpack("../escape", parts)).toThrow(/name/);
    expect(() => buildTextpack("hi", { ...parts, files: { "../escape": strToU8("bad") } })).toThrow(/path/);
    const large = zipSync({ ...files, "hi.textbundle/assets/bomb": new Uint8Array(65 * 1024 * 1024) });
    expect(() => parseTextpack(large)).toThrow(/limit/);
  });

  it("is byte-for-byte deterministic so unchanged items reuse their blob", () => {
    expect(Buffer.from(buildTextpack("hi", parts)).equals(Buffer.from(buildTextpack("hi", parts)))).toBe(true);
    expect(gitBlobSha(buildTextpack("hi", parts))).toBe(gitBlobSha(buildTextpack("hi", parts)));
    expect(gitBlobSha(buildTextpack("hi", { ...parts, markdown: "changed" }))).not.toBe(gitBlobSha(buildTextpack("hi", parts)));
  });

  it("computes the same sha git would", () => {
    expect(gitBlobSha(new TextEncoder().encode("hello\n"))).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });

  it("writes identical valid archives east and west of UTC", () => {
    const script = `const { buildTextpack, gitBlobSha } = require('./src/lib/github/textpack.ts'); console.log(gitBlobSha(buildTextpack('hi', ${JSON.stringify(parts)})));`;
    const hashes = ["UTC", "America/Los_Angeles", "Asia/Tokyo"].map((TZ) =>
      execFileSync(process.execPath, ["--import", "tsx", "-e", script], { env: { ...process.env, TZ }, encoding: "utf8" }).trim(),
    );
    expect(new Set(hashes).size).toBe(1);
  });

  it("refuses a zip that is not a textpack and names files safely", () => {
    expect(() => parseTextpack(buildTextpack("x", parts).slice(0, 10))).toThrow();
    expect(textpackFileName("my post")).toBe("my-post.textpack");
    expect(textpackFileName("../..")).toBe("item.textpack");
  });
});
