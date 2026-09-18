import { describe, expect, it } from "vitest";
import type { Post } from "@/lib/content";
import { documentFromLegacyPost, legacyProjectionFromDocument } from "@/lib/documents/legacy";
import { mergeMarkdownIntoDocument } from "@/lib/documents/sync";
import { parsePostMarkdownFile } from "@/lib/markdown-files";

/**
 * Every link a person wrote comes back.
 *
 * The snapshot used to keep one, in sourceUrl, so a media post citing two
 * essays lost the second on the first save that went through the document.
 * The column kept them and the document could not, and the document is what
 * a save writes from.
 */

const post = (links: Post["links"]): Post =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    type: "article",
    slug: "cited",
    title: "Cited",
    body: "text",
    status: "draft",
    visibility: "private",
    tags: [],
    links,
  }) as unknown as Post;

describe("links through the document", () => {
  it("keeps every link and its label across the round trip", () => {
    const links = [
      { href: "/@demo/method-note", label: "Method note" },
      { href: "/@demo/launch-essay", label: "Launch essay" },
      { href: "https://example.invalid/third", label: "A third" },
    ];
    const back = legacyProjectionFromDocument(documentFromLegacyPost(post(links)));
    expect(back.links).toEqual(links);
  });

  it("still reads a document written before the field existed", () => {
    const document = documentFromLegacyPost(post([{ href: "https://only.invalid", label: "Only" }]));
    // An older snapshot carries the source and nothing else.
    const older = {
      ...document,
      content: { ...document.content, fields: { sourceUrl: "https://only.invalid", sourceLabel: "Only" } },
    };
    expect(legacyProjectionFromDocument(older).links).toEqual([{ href: "https://only.invalid", label: "Only" }]);
  });

  it("carries a file's whole list into the document", () => {
    const base = documentFromLegacyPost(post(null));
    const parsed = parsePostMarkdownFile(
      ['---', 'links: [{"href":"https://a.invalid","label":"A"},{"href":"https://b.invalid","label":"B"}]', "---", "body"].join("\n"),
    );
    const merged = mergeMarkdownIntoDocument(base, parsed);
    expect(legacyProjectionFromDocument(merged).links).toEqual([
      { href: "https://a.invalid", label: "A" },
      { href: "https://b.invalid", label: "B" },
    ]);
    // And the single source everything else reads is still the first.
    expect(merged.content.fields.sourceUrl).toBe("https://a.invalid");
  });

  it("clears the list when a file says there are none", () => {
    const withLinks = documentFromLegacyPost(post([{ href: "https://a.invalid", label: "A" }]));
    const parsed = parsePostMarkdownFile(["---", "links: []", "---", "body"].join("\n"));
    const merged = mergeMarkdownIntoDocument(withLinks, parsed);
    expect(legacyProjectionFromDocument(merged).links).toBeNull();
  });
});
