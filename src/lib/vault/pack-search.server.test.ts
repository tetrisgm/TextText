import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { searchVaultPack } from "./pack-search.server";

describe("TextPack content search", () => {
  it("finds text beyond the card excerpt without expanding assets", () => {
    const text = `---\ntitle: "Saved article"\n---\n\n${"Opening paragraph. ".repeat(35)}\nA distinctive sentence deep in the article.`;
    const bytes = zipSync({ "Article.textbundle/text.md": strToU8(text), "Article.textbundle/assets/photo.png": new Uint8Array(1024) });
    expect(searchVaultPack(bytes, "Bookmarks/Article.textpack", ["distinctive", "article"])).toEqual({ title: "Saved article", snippet: "A distinctive sentence deep in the article." });
    expect(searchVaultPack(bytes, "Bookmarks/Article.textpack", ["missing"])).toBeNull();
  });
  it("rejects an archive with no searchable text", () => {
    expect(() => searchVaultPack(zipSync({ "assets/photo.png": new Uint8Array(10) }), "Bookmarks/Broken.textpack", ["broken"])).toThrow(/searchable text/);
  });
});
