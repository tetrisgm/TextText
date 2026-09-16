import { describe, expect, it } from "vitest";
import { buildBookmarksHtml, parseBookmarksHtml } from "../bookmarks-html";

describe("Netscape bookmark files", () => {
  it("reads nested folders, dates, tags, and descriptions from a browser export", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
  <DT><H3 ADD_DATE="1700000000">Tech</H3>
  <DL><p>
    <DT><A HREF="https://a.test/one?utm_source=x" ADD_DATE="1700000001" TAGS="ai, rust">One &amp; only</A>
    <DD>A description of one.
    <DT><H3>Deeper</H3>
    <DL><p>
      <DT><A HREF="https://b.test/two" ADD_DATE="1700000002">Two</A>
    </DL><p>
  </DL><p>
  <DT><A HREF="ftp://nope.test/x">Not http</A>
  <DT><A HREF="https://c.test/three">Three</A>
</DL><p>`;
    const bookmarks = parseBookmarksHtml(html);
    expect(bookmarks.map((entry) => [entry.url, entry.title, entry.folder, entry.tags, entry.description])).toEqual([
      ["https://a.test/one?utm_source=x", "One & only", "Tech", ["ai", "rust"], "A description of one."],
      ["https://b.test/two", "Two", "Tech/Deeper", [], null],
      ["https://c.test/three", "Three", null, [], null],
    ]);
    expect(bookmarks[0].addedAt?.toISOString()).toBe("2023-11-14T22:13:21.000Z");
  });

  it("round-trips through the export", () => {
    const html = buildBookmarksHtml({
      title: "me",
      bookmarks: [
        { url: "https://a.test/x?y=1&z=2", title: 'Quoted "x"', addedAt: new Date(1700000000000), tags: ["one", "two"], folder: "Bookmarks", description: "Desc" },
        { url: "https://b.test/", title: "B", addedAt: new Date(1700000001000), tags: [], folder: "Tech", description: null },
      ],
    });
    const back = parseBookmarksHtml(html);
    expect(back.map((entry) => [entry.url, entry.title, entry.folder, entry.tags, entry.description])).toEqual([
      ["https://a.test/x?y=1&z=2", 'Quoted "x"', "Bookmarks", ["one", "two"], "Desc"],
      ["https://b.test/", "B", "Tech", [], null],
    ]);
  });

  it("refuses entity declarations", () => {
    expect(() => parseBookmarksHtml('<!DOCTYPE x [<!ENTITY e "v">]><DL><DT><A HREF="https://a.test">a</A></DL>')).toThrow(/entity/i);
  });
});
