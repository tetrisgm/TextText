import { describe, expect, it } from "vitest";
import { tidyPublisherName } from "../publisher-name";
import { STARTER_FEEDS } from "../starter-feeds";

/**
 * The publisher's name sits above every headline at close to headline size,
 * so a feed's catalogue title showing through there is the loudest wrong
 * thing on the surface. These are the titles the starter publishers actually
 * send, taken from their live feeds.
 */

describe("the name a person would say", () => {
  it("keeps the brand out of a feed's catalogue title", () => {
    const cases: Array<[string, string]> = [
      ["World news | The Guardian", "The Guardian"],
      ["Hacker News: Front Page", "Hacker News"],
      ["NPR Topics: News", "NPR"],
      ["Ars Technica - All content", "Ars Technica"],
      ["Rock Paper Shotgun Latest Articles Feed", "Rock Paper Shotgun"],
      ["Polygon.com", "Polygon"],
      ["RSS: Daring Fireball", "Daring Fireball"],
      ["Technology | The Verge", "The Verge"],
      ["Dezeen RSS feed", "Dezeen"],
    ];
    for (const [raw, want] of cases) expect(tidyPublisherName(raw), raw).toBe(want);
  });

  it("leaves a name that is already a masthead alone", () => {
    for (const name of ["BBC News", "WIRED", "TechCrunch", "Nature", "NASA", "Quanta Magazine", "MIT Technology Review", "The Verge"]) {
      expect(tidyPublisherName(name), name).toBe(name);
    }
  });

  it("never returns nothing", () => {
    expect(tidyPublisherName("|")).toBe("|");
    expect(tidyPublisherName(":")).toBe(":");
    expect(tidyPublisherName("   ")).toBe("");
    expect(tidyPublisherName("Feed")).toBe("Feed");
  });

  it("does not mangle the starter catalogue's own names", () => {
    for (const feed of STARTER_FEEDS) {
      const tidied = tidyPublisherName(feed.name);
      expect(tidied.length, feed.name).toBeGreaterThan(0);
      // The tidier may shorten a name, never invent one.
      expect(feed.name.toLowerCase(), feed.name).toContain(tidied.toLowerCase());
    }
  });
});
