import { describe, expect, it } from "vitest";

import type { Blog, Post } from "@/lib/content";
import {
  parsePostMarkdownFile,
  renderPostMarkdownFile,
} from "@/lib/markdown-files";
import {
  ensureMarkdownSubtitle,
  hasMarkdownSubtitle,
  markdownSubtitle,
  postBodyWithSubtitle,
  postSubtitle,
  replaceMarkdownSubtitle,
} from "@/lib/markdown-subtitle";
import { initialDraft, payloadFor } from "@/lib/post-edit-draft";

const blog: Blog = {
  handle: "test",
  name: "Test",
  author: "Writer",
  homeLayout: "column",
};

const article: Post = {
  id: "post-1",
  type: "article",
  slug: "typed-subtitle",
  title: "Typed subtitle",
  excerpt: "Legacy dek with *literal* punctuation.",
  body: "Body paragraph.",
  status: "draft",
};

describe("Markdown subtitle blocks", () => {
  it("promotes a legacy excerpt into a valid H6 block", () => {
    const body = postBodyWithSubtitle(article);
    expect(body).toBe(
      "###### Legacy dek with \\*literal\\* punctuation\\.\n\nBody paragraph.",
    );
    expect(markdownSubtitle(body)).toBe(
      "Legacy dek with literal punctuation.",
    );
  });

  it("round-trips the typed block through the Markdown file", () => {
    const post = {
      ...article,
      excerpt: undefined,
      body: "###### A **clear** subtitle\n\nBody with `code`.",
    };
    const rendered = renderPostMarkdownFile({ blog, post });
    const parsed = parsePostMarkdownFile(rendered);

    expect(rendered).not.toContain("\nexcerpt:");
    expect(parsed.body).toBe(`${post.body}\n`);
    expect(parsed.fields.excerpt).toBe("A clear subtitle");
    expect(renderPostMarkdownFile({ blog, post: { ...post, body: parsed.body } })).toBe(
      rendered,
    );
  });

  it("promotes, replaces, and demotes any text block without touching body text", () => {
    const promoted = replaceMarkdownSubtitle("First\n\nSecond", "Summary");
    expect(promoted).toBe("###### Summary\n\nFirst\n\nSecond");
    expect(replaceMarkdownSubtitle(promoted, "New summary")).toBe(
      "###### New summary\n\nFirst\n\nSecond",
    );
    expect(replaceMarkdownSubtitle(promoted, "")).toBe("First\n\nSecond");
  });

  it("does not treat an H6 inside a code fence as a subtitle", () => {
    const body = "```md\n###### Not a subtitle\n```\n\nBody";
    expect(hasMarkdownSubtitle(body)).toBe(false);
    expect(markdownSubtitle(body)).toBe("");
  });

  it("only treats a LEADING H6 as the subtitle, never a mid-body heading", () => {
    // A genuine mid-body H6 (e.g. imported markdown) must NOT be hijacked as the
    // subtitle, or a legacy article's real excerpt would be lost on first save.
    const body = "Intro paragraph.\n\n###### Deep heading\n\nMore.";
    expect(hasMarkdownSubtitle(body)).toBe(false);
    expect(markdownSubtitle(body)).toBe("");
    // A legacy article with a real excerpt keeps it: ensureMarkdownSubtitle
    // prepends the excerpt as a new leading subtitle, leaving the deep heading.
    const legacy = { ...article, excerpt: "Real dek", body };
    expect(postSubtitle(legacy)).toBe("Real dek");
    expect(ensureMarkdownSubtitle(body, "Real dek")).toBe(
      "###### Real dek\n\n" + body,
    );
  });

  it("defaults articles to a subtitle block but leaves notes as title plus body", () => {
    const articleDraft = initialDraft({ ...article, excerpt: undefined, body: "" });
    const noteDraft = initialDraft({
      ...article,
      type: "note",
      excerpt: undefined,
      body: "",
    });

    expect(articleDraft.body).toBe("######");
    expect(noteDraft.body).toBe("");
    expect(ensureMarkdownSubtitle(noteDraft.body)).toBe("");
  });

  it("derives the legacy save cache from Markdown instead of draft excerpt", () => {
    const draft = initialDraft(article);
    draft.excerpt = "Stale separate value";
    const payload = payloadFor(article.id!, draft, article.slug);
    expect(payload.excerpt).toBe("Legacy dek with literal punctuation.");
  });
});
