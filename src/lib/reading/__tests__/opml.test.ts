import { describe, expect, it } from "vitest";
import { buildOpml, parseOpml } from "../opml";

describe("OPML", () => {
  it("reads nested subscription lists, keeps the folder, and dedupes by feed address", () => {
    const entries = parseOpml(`<?xml version="1.0"?>
<opml version="2.0"><head><title>Subs</title></head><body>
  <outline text="Tech" title="Tech">
    <outline type="rss" text="HN" title="Hacker News" xmlUrl="https://hnrss.org/frontpage" htmlUrl="https://news.ycombinator.com/" />
    <outline type="rss" text="Dup" xmlUrl="https://hnrss.org/frontpage" />
  </outline>
  <outline type="rss" text="Loose" xmlUrl="https://example.test/feed.xml" />
  <outline type="rss" text="Not http" xmlUrl="ftp://example.test/feed.xml" />
</body></opml>`);
    expect(entries).toEqual([
      { xmlUrl: "https://hnrss.org/frontpage", title: "Hacker News", htmlUrl: "https://news.ycombinator.com/", folder: "Tech" },
      { xmlUrl: "https://example.test/feed.xml", title: "Loose", htmlUrl: null, folder: null },
    ]);
  });

  it("refuses declarations and non-OPML documents", () => {
    expect(() => parseOpml('<!DOCTYPE opml [<!ENTITY x "y">]><opml><body/></opml>')).toThrow(/declarations/);
    expect(() => parseOpml("<rss><channel/></rss>")).toThrow(/not an OPML/);
  });

  it("writes a list that reads back into the same feeds", () => {
    const text = buildOpml({
      title: "me reading",
      sources: [
        { title: 'Quotes "and" <tags>', xmlUrl: "https://a.test/feed?x=1&y=2", htmlUrl: "https://a.test/", folder: "bookmarks" },
        { title: "Second", xmlUrl: "https://b.test/rss", htmlUrl: null, folder: "bookmarks/tech" },
      ],
    });
    const back = parseOpml(text);
    expect(back.map((entry) => [entry.xmlUrl, entry.title, entry.folder])).toEqual([
      ["https://a.test/feed?x=1&y=2", 'Quotes "and" <tags>', "bookmarks"],
      ["https://b.test/rss", "Second", "bookmarks/tech"],
    ]);
  });
});
