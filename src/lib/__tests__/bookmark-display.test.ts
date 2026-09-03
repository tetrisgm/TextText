import { describe, expect, it } from "vitest";
import { stripRedundantBookmarkLead } from "@/lib/bookmark-display";

const masthead = {
  title: "The Invisible Hand of Super Metroid",
  excerpt:
    "In this in-depth analysis, I offer my perspective on the subtle player direction tricks that makes Super Metroid a tight and focused experience, while never quite letting the player out of the...",
  sourceUrl: "https://www.gamedeveloper.com/design/the-invisible-hand",
  siteName: "Game Developer",
};

describe("stripRedundantBookmarkLead", () => {
  it("strips a leading title heading, description echo, and domain line", () => {
    const body = [
      "# The Invisible Hand of Super Metroid",
      "**In this in-depth analysis, I offer my perspective on the subtle player direction tricks that makes Super Metroid a tight and focused experience, while never quite letting the player out of the illusion that they are exploring Zebes on their own.**",
      "www.gamedeveloper.com",
      "Hugo Bille, Blogger",
      "The real article begins here.",
    ].join("\n\n");
    const result = stripRedundantBookmarkLead(body, masthead);
    expect(result.startsWith("Hugo Bille, Blogger")).toBe(true);
    expect(result).toContain("The real article begins here.");
  });

  it("keeps a body whose opening carries its own information", () => {
    const body = "An opening paragraph in its own words.\n\nMore prose.";
    expect(stripRedundantBookmarkLead(body, masthead)).toBe(body);
  });

  it("never strips past the opening run", () => {
    const body = [
      "Original opening.",
      "# The Invisible Hand of Super Metroid",
      "Prose.",
    ].join("\n\n");
    expect(stripRedundantBookmarkLead(body, masthead)).toBe(body);
  });

  it("handles empty and masthead-free inputs", () => {
    expect(stripRedundantBookmarkLead("", masthead)).toBe("");
    expect(stripRedundantBookmarkLead("# Title\n\nBody.", {})).toBe(
      "# Title\n\nBody.",
    );
  });
});
