import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { remarkWikiLinks } from "@/components/WikiLinkMarkdown";
import {
  backlinksForPost,
  workspacePoolFromParts,
} from "@/lib/pool/selectors";
import { workspaceWikiLinkMetadata } from "@/lib/pool/server";
import type { Blog, Post } from "@/lib/content";
import {
  createWikiLinkTargetResolver,
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
  homeLayout: "column",
};

describe("wikilink extraction and backlinks", () => {
  it("resolves only authoritative aliases into the visible snapshot", () => {
    const visible = post({
      id: "visible",
      slug: "current",
      title: "Current",
    });
    const resolve = createWikiLinkTargetResolver([visible], {
      current: "current",
      previous: "current",
      secret: "inaccessible",
    });

    expect(resolve("current")).toBe(visible);
    expect(resolve("previous")).toBe(visible);
    expect(resolve("secret")).toBeNull();
    expect(resolve("missing")).toBeNull();
  });

  it("keeps the workspace pool body warm-up empty and previews bounded", () => {
    const body = "n".repeat(10_000);
    const pool = workspacePoolFromParts({
      blog,
      blogId: "blog-1",
      counts: {},
      folders: [],
      posts: [post({ id: "note", type: "note", body })],
    });

    expect(pool.initialBodies).toEqual([]);
    expect(pool.posts[0]?.bodyPreview).toHaveLength(2048);
  });

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
