import { describe, expect, it } from "vitest";
import { FeedParseError, discoverFeedLinks, parseFeed } from "../feed-parse";
import { imageFromEntry } from "../ingest.server";

// Scenario ids from the plan's Appendix A are carried in test names so the
// checkpoint report can be traced back to the catalog.

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Browser Notes</title>
  <link>https://browser.example/</link>
  <description>Engine news</description>
  <language>en</language>
  <item>
    <guid isPermaLink="false">post-1</guid>
    <title>Website-provided agent actions &amp; more</title>
    <link>https://browser.example/posts/actions?utm_source=rss</link>
    <dc:creator>Ada</dc:creator>
    <pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>A short <b>summary</b>.</p>]]></description>
    <content:encoded><![CDATA[<h2>Actions</h2><p>The proposal <a href="https://spec.example/x">adds</a> an interface.</p><script>alert(1)</script><ul><li>One</li><li>Two</li></ul>]]></content:encoded>
    <enclosure url="https://browser.example/a.mp3" type="audio/mpeg" length="1"/>
  </item>
  <item>
    <title>Only a title and link</title>
    <link>https://browser.example/posts/bare</link>
  </item>
  <item>
    <guid>https://browser.example/posts/permalink-guid/</guid>
    <title>Permalink guid</title>
  </item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
  <title>Willison</title>
  <link rel="alternate" href="https://willison.example/"/>
  <subtitle>Weblog</subtitle>
  <entry>
    <id>tag:willison.example,2026:/2026/Sep/1/actions/</id>
    <title type="html">Browser &lt;em&gt;actions&lt;/em&gt;</title>
    <link rel="alternate" href="https://willison.example/2026/Sep/1/actions/"/>
    <link rel="related" href="https://browser.example/posts/actions"/>
    <author><name>Simon</name></author>
    <published>2026-09-01T12:00:00Z</published>
    <updated>2026-09-02T08:00:00Z</updated>
    <summary type="text">Two paragraphs

of plain text.</summary>
    <content type="html">&lt;p&gt;Full &lt;i&gt;body&lt;/i&gt; here.&lt;/p&gt;</content>
  </entry>
</feed>`;

const JSONFEED = JSON.stringify({
  version: "https://jsonfeed.org/version/1.1",
  title: "Lab notes",
  home_page_url: "https://lab.example/",
  items: [
    {
      id: "note-42",
      url: "https://lab.example/notes/42",
      external_url: "https://vendor.example/release",
      title: "Release notes",
      content_text: "Version 2 shipped.\n\nIt is faster.",
      date_published: "2026-09-03T09:00:00Z",
      authors: [{ name: "Grace" }],
    },
    { id: "", title: "" },
  ],
});

describe("parseFeed (ING-01 supported formats)", () => {
  it("parses RSS 2.0 with namespaced content, CDATA, entities and enclosures", () => {
    const feed = parseFeed(RSS, "application/rss+xml");
    expect(feed.format).toBe("rss");
    expect(feed.title).toBe("Browser Notes");
    expect(feed.siteUrl).toBe("https://browser.example/");
    expect(feed.language).toBe("en");
    expect(feed.entries).toHaveLength(3);

    const [first, bare, permalinkGuid] = feed.entries;
    expect(first.declaredId).toBe("post-1");
    expect(first.externalKey).toBe("id:post-1");
    expect(first.title).toBe("Website-provided agent actions & more");
    expect(first.authors).toEqual(["Ada"]);
    expect(first.publishedAt).toBe("Mon, 01 Sep 2026 10:00:00 GMT");
    expect(first.availability).toBe("full");
    expect(first.bodyMarkdown).toContain("## Actions");
    expect(first.bodyMarkdown).toContain("[adds](https://spec.example/x)");
    expect(first.bodyMarkdown).toContain("- One");
    expect(first.bodyMarkdown).not.toContain("alert");
    expect(first.bodyMarkdown).not.toContain("<script");
    expect(first.excerpt).toBe("A short summary.");
    expect(first.attachments).toEqual([
      { url: "https://browser.example/a.mp3", mimeType: "audio/mpeg" },
    ]);

    expect(bare.availability).toBe("metadata");
    expect(bare.externalKey).toBe("url:https://browser.example/posts/bare");

    // An RSS guid with no isPermaLink attribute is a permalink per the spec,
    // compared as a URL so the trailing slash does not make a second entry.
    expect(permalinkGuid.externalKey).toBe(
      "url:https://browser.example/posts/permalink-guid",
    );
    expect(permalinkGuid.permalink).toBe("https://browser.example/posts/permalink-guid/");
  });

  it("parses Atom with html titles, related links and text summaries", () => {
    const feed = parseFeed(ATOM, "application/atom+xml");
    expect(feed.format).toBe("atom");
    expect(feed.title).toBe("Willison");
    expect(feed.siteUrl).toBe("https://willison.example/");
    const [entry] = feed.entries;
    expect(entry.declaredId).toBe("tag:willison.example,2026:/2026/Sep/1/actions/");
    expect(entry.externalKey).toBe("id:tag:willison.example,2026:/2026/Sep/1/actions/");
    expect(entry.title).toBe("Browser actions");
    expect(entry.permalink).toBe("https://willison.example/2026/Sep/1/actions/");
    // A linkblog's related target is kept separately; it is not the permalink.
    expect(entry.externalUrl).toBe("https://browser.example/posts/actions");
    expect(entry.authors).toEqual(["Simon"]);
    expect(entry.publishedAt).toBe("2026-09-01T12:00:00Z");
    expect(entry.updatedAt).toBe("2026-09-02T08:00:00Z");
    expect(entry.availability).toBe("full");
    expect(entry.bodyMarkdown).toBe("Full _body_ here.");
    expect(entry.excerpt).toBe("Two paragraphs of plain text.");
  });

  it("parses JSON Feed 1.1 and drops entries with nothing usable", () => {
    const feed = parseFeed(JSONFEED, "application/feed+json");
    expect(feed.format).toBe("jsonfeed");
    expect(feed.entries).toHaveLength(1);
    expect(feed.droppedEntries).toBe(1);
    const [entry] = feed.entries;
    expect(entry.externalKey).toBe("id:note-42");
    expect(entry.permalink).toBe("https://lab.example/notes/42");
    expect(entry.externalUrl).toBe("https://vendor.example/release");
    expect(entry.bodyMarkdown).toBe("Version 2 shipped.\n\nIt is faster.");
    expect(entry.availability).toBe("full");
    expect(entry.authors).toEqual(["Grace"]);
  });

  it("decides by body, not by content type", () => {
    expect(parseFeed(JSONFEED, "text/html").format).toBe("jsonfeed");
    expect(parseFeed(RSS, "text/plain").format).toBe("rss");
  });
});

describe("parseFeed refusals (SEC-02 fetch boundary)", () => {
  it("refuses a DOCTYPE before parsing", () => {
    const hostile = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x "y">]><rss><channel><title>&x;</title></channel></rss>`;
    expect(() => parseFeed(hostile)).toThrow(FeedParseError);
    try {
      parseFeed(hostile);
    } catch (error) {
      expect((error as FeedParseError).code).toBe("refused_dtd");
    }
  });

  it("refuses non-feed documents plainly", () => {
    expect(() => parseFeed("<html><body>no</body></html>")).toThrow(/Not an RSS/);
    expect(() => parseFeed("{\"hello\":1}")).toThrow(/Not a JSON Feed/);
    expect(() => parseFeed("not xml at all <<<")).toThrow(FeedParseError);
  });

  it("never lets javascript: or data: URLs through as links or images", () => {
    const feed = parseFeed(`<rss><channel><title>t</title><item><title>x</title><link>https://a.example/x</link>
      <description><![CDATA[<a href="javascript:alert(1)">bad</a> <img src="data:image/png;base64,AAAA"> <a href="https://ok.example/">ok</a>]]></description></item></channel></rss>`);
    const body = feed.entries[0].bodyMarkdown;
    expect(body).not.toContain("javascript:");
    expect(body).not.toContain("data:");
    expect(body).toContain("[ok](https://ok.example/)");
    expect(body).toContain("bad");
  });
});

describe("discoverFeedLinks (ING-02 autodiscovery)", () => {
  it("returns declared alternates resolved against the page, in order, once each", () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml">
      <link rel="alternate" type="application/atom+xml" href="https://other.example/atom">
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
      <link rel="stylesheet" href="/x.css">
      <link rel="alternate" type="text/html" href="/fr/">
    </head></html>`;
    expect(discoverFeedLinks(html, "https://site.example/blog/")).toEqual([
      { url: "https://site.example/feed.xml", title: "Posts", type: "application/rss+xml" },
      { url: "https://other.example/atom", title: null, type: "application/atom+xml" },
    ]);
  });
});

describe("Media RSS pictures", () => {
  it("takes media:content, media:thumbnail and itunes:image as image attachments", () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
        <channel>
          <title>Pictures</title>
          <link>https://pictures.example/</link>
          <item>
            <title>With a media content</title>
            <link>https://pictures.example/a</link>
            <guid isPermaLink="false">a</guid>
            <media:content url="https://pictures.example/a.jpg" medium="image" />
          </item>
          <item>
            <title>With a thumbnail in a group</title>
            <link>https://pictures.example/b</link>
            <guid isPermaLink="false">b</guid>
            <media:group><media:thumbnail url="https://pictures.example/b.jpg" /></media:group>
          </item>
          <item>
            <title>With a video, which is not a picture</title>
            <link>https://pictures.example/c</link>
            <guid isPermaLink="false">c</guid>
            <media:content url="https://pictures.example/c.mp4" type="video/mp4" />
          </item>
        </channel>
      </rss>`;
    const feed = parseFeed(xml, "https://pictures.example/feed.xml");
    const [withContent, withThumbnail, withVideo] = feed.entries;
    expect(imageFromEntry(withContent)).toBe("https://pictures.example/a.jpg");
    expect(imageFromEntry(withThumbnail)).toBe("https://pictures.example/b.jpg");
    expect(imageFromEntry(withVideo)).toBeNull();
  });

  it("does not mistake content:encoded for a picture", () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <title>Words</title>
          <link>https://words.example/</link>
          <item>
            <title>Only words</title>
            <link>https://words.example/a</link>
            <guid isPermaLink="false">a</guid>
            <content:encoded><![CDATA[<p>No picture here.</p>]]></content:encoded>
          </item>
        </channel>
      </rss>`;
    const [entry] = parseFeed(xml, "https://words.example/feed.xml").entries;
    expect(entry.attachments).toEqual([]);
    expect(imageFromEntry(entry)).toBeNull();
  });
});
