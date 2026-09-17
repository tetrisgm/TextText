import { describe, expect, it } from "vitest";
import { hostOf, initialsOf, markColor, nameMatchesHost, publisherFor, usableExcerpt } from "../publisher";

/**
 * A news row is scanned by its publisher before it is read by its headline,
 * so the name has to be the one a person recognises and the mark has to be
 * there every time.
 */

describe("who published an item", () => {
  it("names the site an aggregator links to, and keeps the aggregator as the route", () => {
    const publisher = publisherFor({
      publisherName: "Hacker News: Front Page",
      externalUrl: "https://www.theverge.com/2026/9/17/thing",
      permalink: "https://www.theverge.com/2026/9/17/thing",
    });
    expect(publisher.name).toBe("theverge.com");
    expect(publisher.via).toBe("Hacker News");
  });

  it("keeps a publisher's own name when the feed belongs to the site", () => {
    const publisher = publisherFor({
      publisherName: "The Verge",
      externalUrl: "https://www.theverge.com/2026/9/17/thing",
    });
    expect(publisher.name).toBe("The Verge");
    expect(publisher.via).toBeNull();
  });

  it("falls back to the feed's name when there is no link at all", () => {
    expect(publisherFor({ publisherName: "Probe Wire" }).name).toBe("Probe Wire");
    expect(publisherFor({ sourceFolderName: "Reading" }).name).toBe("Reading");
  });

  it("gives every publisher a mark, and the same one every time", () => {
    expect(initialsOf("The Verge")).toBe("VE");
    expect(initialsOf("Architectural Digest")).toBe("AD");
    expect(initialsOf("theverge.com")).toBe("TH");
    expect(markColor("The Verge")).toBe(markColor("The Verge"));
    expect(markColor("The Verge")).not.toBe(markColor("Ars Technica"));
    expect(markColor("x")).toMatch(/^hsl\(\d+ 58% 36%\)$/);
  });

  it("reads a host without its www, and refuses what is not a web page", () => {
    expect(hostOf("https://www.Example.COM/path")).toBe("example.com");
    expect(hostOf("javascript:alert(1)")).toBeNull();
    expect(hostOf(null)).toBeNull();
  });

  it("matches a feed name to its own host, ignoring the suffix", () => {
    expect(nameMatchesHost("Ars Technica", "arstechnica.com")).toBe(true);
    expect(nameMatchesHost("9to5Mac", "9to5mac.com")).toBe(true);
    expect(nameMatchesHost("Hacker News: Newest", "github.com")).toBe(false);
  });
});

describe("whether an excerpt is worth showing", () => {
  it("drops an aggregator's block of links", () => {
    expect(
      usableExcerpt("Article URL: https://example.com/a Comments URL: https://news.ycombinator.com/item?id=1 Points: 2 Comments: 0"),
    ).toBeNull();
  });

  it("keeps prose, without the links in it", () => {
    const kept = usableExcerpt("I needed a public demo to show usage, so I compiled the whole server to WASM. https://example.com/demo");
    expect(kept).toContain("compiled the whole server");
    expect(kept).not.toContain("https://");
  });

  it("has nothing to say about an empty excerpt", () => {
    expect(usableExcerpt(null)).toBeNull();
    expect(usableExcerpt("   ")).toBeNull();
  });
});
