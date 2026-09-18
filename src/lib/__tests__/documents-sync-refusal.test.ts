import { describe, expect, it } from "vitest";
import { refuseUnsupportedMarkdown } from "@/lib/documents/sync";
import { parsePostMarkdownFile } from "@/lib/markdown-files";

/**
 * A save that cannot keep what the file says must say so. Accepting the write
 * and then rendering the line away takes it from the person's own copy too,
 * which is the one outcome with nothing left to recover from.
 */

const file = (frontmatter: string) => parsePostMarkdownFile(`---\n${frontmatter}\n---\nbody`);

describe("what text.md cannot keep", () => {
  it("names an unknown key instead of deleting the line", () => {
    expect(() => refuseUnsupportedMarkdown(file("author: Ramine"))).toThrow(/author/);
    // The message has to say what to do, or a refusal is just a wall.
    expect(() => refuseUnsupportedMarkdown(file("author: Ramine"))).toThrow(/body/);
  });

  it("no longer refuses a second link, because the document keeps them now", () => {
    const two = file('links: [{"href":"https://a.example"},{"href":"https://b.example"}]');
    expect(() => refuseUnsupportedMarkdown(two)).not.toThrow();
  });

  it("accepts a file that says only what a save keeps", () => {
    expect(() =>
      refuseUnsupportedMarkdown(file('title: Fine\nlinks: [{"href":"https://a.example"}]')),
    ).not.toThrow();
    expect(() => refuseUnsupportedMarkdown(parsePostMarkdownFile("no frontmatter at all"))).not.toThrow();
  });
});
