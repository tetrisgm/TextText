import { describe, expect, it } from "vitest";
import { MARK_COLORS, hostOf, initialsOf, markColor, nameMatchesHost, publisherFor } from "../publisher";

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
    expect(MARK_COLORS).toContain(markColor("x"));
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

describe("the monogram tiles", () => {
  const luminance = (hex: string) =>
    [1, 3, 5]
      .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);

  it("every tile carries white initials at AA", () => {
    for (const color of MARK_COLORS) {
      const ratio = (1 + 0.05) / (luminance(color) + 0.05);
      expect(ratio, color).toBeGreaterThanOrEqual(4.5);
    }
  });
});
