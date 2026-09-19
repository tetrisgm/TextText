import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
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
