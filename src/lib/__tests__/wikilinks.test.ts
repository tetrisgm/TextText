import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import MarkdownIt from "markdown-it";
import { Schema } from "@tiptap/pm/model";
import {
  defaultMarkdownSerializer,
  MarkdownSerializer,
} from "prosemirror-markdown";
import { describe, expect, it } from "vitest";
import {
  installWikiLinkMarkdownRule,
  wikiLinkMarkdownSpec,
} from "@/components/editor/WikiLink";
import { remarkWikiLinks } from "@/components/WikiLinkMarkdown";
import {
  backlinksForPost,
  workspacePoolFromParts,
} from "@/lib/pool/selectors";
import { workspaceWikiLinkMetadata } from "@/lib/pool/server";
import type { Blog, Post } from "@/lib/content";
import {
  extractWikiLinks,
  publicWikiLinkRenderTargets,
  renderTargetForResolution,
} from "@/lib/wikilinks";

function post(patch: Partial<Post> = {}): Post {
  return {
    id: "post-1",
    type: "article",
    slug: "source",
    title: "Source",
    body: "",
    status: "draft",
    ...patch,
  };
}

const blog: Blog = {
  handle: "garden",
  name: "Garden",
  author: "Writer",
  cardStyle: "cover",
  homeLayout: "single",
};

describe("wikilink markdown", () => {
  it("round-trips a labeled inline atom byte-for-byte", () => {
    const markdownIt = new MarkdownIt();
    installWikiLinkMarkdownRule(markdownIt);
    const source = "[[field-notes|Label with spaces]]";
    const html = markdownIt.renderInline(source);
    expect(html).toBe(
      '<span class="wiki-link-node" data-wiki-link="field-notes" data-wiki-label="Label with spaces">Label with spaces</span>',
    );

    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { content: "inline*", group: "block" },
        text: { group: "inline" },
        wikiLink: {
          inline: true,
          group: "inline",
          atom: true,
          attrs: { target: {}, label: {} },
        },
      },
    });
    const wikiNode = schema.nodes.wikiLink!.create({
      target: "field-notes",
      label: "Label with spaces",
    });
    const document = schema.nodes.doc!.create(
      null,
      schema.nodes.paragraph!.create(null, wikiNode),
    );
    const serializer = new MarkdownSerializer(
      {
        doc: (state, node) => state.renderContent(node),
        paragraph: defaultMarkdownSerializer.nodes.paragraph,
        text: defaultMarkdownSerializer.nodes.text,
        wikiLink: wikiLinkMarkdownSpec.serialize,
      },
      {},
    );
    expect(serializer.serialize(document)).toBe(source);
  });

  it("does not swallow ordinary links, escaped openers, or double-escape", () => {
    const markdownIt = new MarkdownIt();
    installWikiLinkMarkdownRule(markdownIt);
    const html = markdownIt.renderInline(
      "[Web](https://example.com) [[field-notes|Field notes]] \\[[literal]]",
    );
    expect(html).toContain('<a href="https://example.com">Web</a>');
    expect(html.match(/class="wiki-link-node"/g)).toHaveLength(1);
    expect(html).toContain(">Field notes</span>");
    expect(html).toContain("[[literal]]");
    expect(html).not.toContain("&amp;#91;");
  });
});

describe("wikilink extraction and backlinks", () => {
  it("extracts prose links while ignoring inline and fenced code", () => {
    const markdown = [
      "See [[field-notes|Field notes]] and [[next-step]].",
      "`[[inline-code]]`",
      "```md",
      "[[fenced-code]]",
      "```",
    ].join("\n");
    expect(extractWikiLinks(markdown)).toEqual([
      { target: "field-notes", label: "Field notes" },
      { target: "next-step", label: "next-step" },
    ]);
  });

  it("computes backlinks from full bodies and resolves slug history", () => {
    const target = post({ id: "target", slug: "current-slug", title: "Target" });
    const source = post({
      id: "source",
      slug: "source",
      body: `${"x".repeat(2200)} [[old-slug|Target]]`,
    });
    const metadata = workspaceWikiLinkMetadata([target, source], {
      "current-slug": "current-slug",
      "old-slug": "current-slug",
      source: "source",
    });
    expect(metadata.outboundLinks?.source).toEqual([
      { target: "old-slug", label: "Target" },
    ]);
    const pool = workspacePoolFromParts({
      blog,
      blogId: "blog-1",
      counts: {},
      folders: [],
      posts: [target, source],
      ...metadata,
    });
    const poolTarget = pool.posts.find((entry) => entry.id === "target")!;
    expect(backlinksForPost(pool, poolTarget).map((entry) => entry.id)).toEqual([
      "source",
    ]);
  });
});

describe("public wikilink privacy", () => {
  it("renders private and missing targets as plain label text", () => {
    const privateNote = post({
      id: "private",
      type: "note",
      slug: "private-note",
      status: "draft",
    });
    expect(
      renderTargetForResolution(blog, {
        kind: "exact",
        target: "private-note",
        post: privateNote,
      }),
    ).toBeNull();

    const html = renderToStaticMarkup(
      React.createElement(
        ReactMarkdown,
        { remarkPlugins: [remarkGfm, remarkWikiLinks({})] },
        "Read [[private-note|Private label]] and [[missing|Missing label]].",
      ),
    );
    expect(html).toContain("Private label");
    expect(html).toContain("Missing label");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("private-note");
  });

  it("links only an explicitly supplied safe public target", () => {
    const publicPost = post({
      slug: "public-post",
      status: "published",
    });
    const target = renderTargetForResolution(blog, {
      kind: "exact",
      target: "public-post",
      post: publicPost,
    });
    expect(target).toEqual({
      slug: "public-post",
      href: "/t/garden/public-post",
    });
    const html = renderToStaticMarkup(
      React.createElement(
        ReactMarkdown,
        {
          remarkPlugins: [
            remarkGfm,
            remarkWikiLinks({ "public-post": target! }),
          ],
        },
        "[[public-post|Read it]]",
      ),
    );
    expect(html).toContain('href="/t/garden/public-post"');
    expect(html).toContain("Read it");
  });

  it("builds public render targets only from published public posts", () => {
    const targets = publicWikiLinkRenderTargets({
      blog,
      posts: [
        post({
          id: "pub",
          slug: "public-post",
          status: "published",
          visibility: "public",
        }),
        post({ id: "draft", slug: "draft-post", visibility: "public" }),
        post({
          id: "unlisted",
          slug: "unlisted-post",
          status: "published",
          visibility: "link",
        }),
        post({
          id: "note",
          type: "note",
          slug: "note-post",
          status: "published",
          visibility: "public",
        }),
      ],
      slugAliases: {
        "old-public": "public-post",
        "old-unlisted": "unlisted-post",
      },
    });
    expect(Object.keys(targets).sort()).toEqual(["old-public", "public-post"]);
    expect(targets["public-post"]).toEqual({
      slug: "public-post",
      href: "/t/garden/public-post",
    });
    expect(targets["old-public"]).toEqual(targets["public-post"]);
  });
});
