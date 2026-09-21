import { describe, expect, it } from "vitest";
import { captureFolderPath, captureIntent } from "@/lib/capture-intent";

describe("captureIntent", () => {
  it("keeps commentary with a pasted URL", () => {
    expect(captureIntent("https://example.com/article\n\nThis supports the introduction.\nKeep the second paragraph.")).toMatchObject({
      kind: "bookmark",
      sourceUrl: "https://example.com/article",
      body: "[example.com](https://example.com/article)\n\nThis supports the introduction.\nKeep the second paragraph.",
    });
  });

  it("preserves a thought longer than the title limit", () => {
    const thought = "A thought worth keeping. ".repeat(20);
    const captured = captureIntent(thought);
    expect(captured.title.length).toBeLessThanOrEqual(120);
    expect(captured.body).toBe(thought.trim());
  });
  it("routes a thought to Notes and keeps a useful title", () => {
    expect(
      captureIntent("A launch thought\n\nKeep the first run tiny."),
    ).toEqual({
      body: "Keep the first run tiny.",
      kind: "note",
      preferredFolderMode: "notes",
      sourceUrl: null,
      title: "A launch thought",
    });
  });

  it("keeps an imported conversation intact when its title comes from a prompt", () => {
    const conversation = [
      "ChatGPT conversation",
      "",
      "User: Explain why local files matter",
      "Assistant: They keep the durable source close.",
    ].join("\n");

    expect(captureIntent(conversation)).toMatchObject({
      body: conversation,
      kind: "note",
      title: "Explain why local files matter",
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
          { mode: "notes", path: "documentation" },
          { mode: "bookmarks", path: "bookmarks" },
          { mode: "notes", path: "notes" },
        ],
        "notes",
      ),
    ).toBe("notes");
  });
});
