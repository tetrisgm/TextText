import { describe, expect, it } from "vitest";
import { itemDestination } from "../writing";

describe("item destination", () => {
  it("keeps notes, articles and custom authored documents under Writing", () => {
    expect(itemDestination({ type: "article" })).toBe("notes");
    expect(itemDestination({ type: "note" })).toBe("notes");
    expect(itemDestination({ type: "article", template: { id: "review", version: 1 } })).toBe("notes");
  });
  it("distinguishes feed arrivals from deliberately filed and manual bookmarks", () => {
    expect(itemDestination({ type: "bookmark", origin: "feed" })).toBe("news");
    expect(itemDestination({ type: "bookmark", origin: "feed", filed: true })).toBe("bookmarks");
    expect(itemDestination({ type: "bookmark" })).toBe("bookmarks");
  });
});
