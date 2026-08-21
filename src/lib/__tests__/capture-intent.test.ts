import { describe, expect, it } from "vitest";
import { captureFolderPath, captureIntent } from "@/lib/capture-intent";

describe("captureIntent", () => {
  it("routes a thought to Notes and keeps a useful title", () => {
    expect(captureIntent("A launch thought\n\nKeep the first run tiny.")).toEqual({
      body: "A launch thought\n\nKeep the first run tiny.",
      kind: "note",
      preferredFolderMode: "notes",
      sourceUrl: null,
      title: "A launch thought",
    });
  });

  it("routes a URL to Bookmarks with readable markdown", () => {
    expect(captureIntent("paper.design/docs/mcp")).toEqual({
      body: "[paper.design](https://paper.design/docs/mcp)",
      kind: "bookmark",
      preferredFolderMode: "bookmarks",
      sourceUrl: "https://paper.design/docs/mcp",
      title: "paper.design",
    });
  });
});

describe("captureFolderPath", () => {
  it("chooses the primary shallow folder for the requested mode", () => {
    expect(
      captureFolderPath(
        [
          { mode: "notes", path: "projects/notes" },
          { mode: "bookmarks", path: "bookmarks" },
          { mode: "notes", path: "notes" },
        ],
        "notes",
      ),
    ).toBe("notes");
  });
});
