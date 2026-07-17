// Adversarial verification of the files substrate: hostile round trips,
// hand-typed frontmatter edge cases, hash stability, manifest compatibility,
// and the folder.json route's conditional-GET contract (exercised for real
// against the demo seed; the dynamic import below keeps db/client.ts on the
// demo path even if the shell that launched vitest exports DATABASE_URL).

import { beforeAll, describe, expect, it } from "vitest";

import type { Blog, Folder, Post } from "@/lib/content";
import { markdownFileHash } from "@/lib/content-hash";
import {
  parsePostMarkdownFile,
  renderFolderManifest,
  renderPostMarkdownFile,
} from "@/lib/markdown-files";

const blog: Blog = {
  handle: "demo",
  name: "The Demo Broadsheet",
  author: "Demo Author",
  accent: "#065ec6",
  cardStyle: "cover",
  homeLayout: "timeline",
};

const folder: Folder = {
  id: "folder-1",
  name: "Blog",
  path: "blog",
  mode: "blog",
  position: 0,
};

const basePost: Post = {
  id: "post-adv",
  type: "article",
  slug: "adversarial",
  title: "Adversarial",
  body: "Plain body.",
  date: "2026-07-01",
  status: "published",
};

describe("bodies that impersonate frontmatter", () => {
  it("round-trips a body whose FIRST line is ---", () => {
    const post: Post = {
      ...basePost,
      body: '---\ntitle: sneaky impostor\nstatus: draft\n---\n\nThe real body.',
    };
    const file = renderPostMarkdownFile({ blog, post });
    const parsed = parsePostMarkdownFile(file);

    // The real frontmatter wins; the impostor block stays in the body.
    expect(parsed.fields.title).toBe("Adversarial");
    expect(parsed.fields.status).toBe("published");
    expect(parsed.body).toBe(`${post.body}\n`);

    const again = renderPostMarkdownFile({
      blog,
      post: { ...post, body: parsed.body },
    });
    expect(again).toBe(file);
  });

  it("round-trips a body that is exactly ---", () => {
    const post: Post = { ...basePost, body: "---" };
    const parsed = parsePostMarkdownFile(renderPostMarkdownFile({ blog, post }));
    expect(parsed.body).toBe("---\n");
    expect(parsed.fields.slug).toBe("adversarial");
  });

  it("keeps a --- body line that follows the close with no blank separator", () => {
    const parsed = parsePostMarkdownFile('---\ntitle: "x"\n---\n---\nrule body\n');
    expect(parsed.fields.title).toBe("x");
    expect(parsed.body).toBe("---\nrule body\n");
  });
});

describe("CRLF files", () => {
  it("parses a hand-written CRLF file", () => {
    const parsed = parsePostMarkdownFile(
      "---\r\ntitle: Hello CRLF\r\nstatus: draft\r\n---\r\n\r\nBody line one.\r\nLine two.\r\n",
    );
    expect(parsed.fields).toEqual({ title: "Hello CRLF", status: "draft" });
    expect(parsed.body).toBe("Body line one.\r\nLine two.\r\n");
    expect(parsed.unknownKeys).toEqual([]);
  });

  it("parses a rendered file after CRLF conversion with identical fields", () => {
    const post: Post = {
      ...basePost,
      excerpt: "A dek.",
      pinned: true,
      coverHeight: 420,
      body: "One.\n\nTwo.",
    };
    const lfFile = renderPostMarkdownFile({ blog, post });
    // Rendered strings JSON-escape their newlines, so this cannot corrupt values.
    const crlfFile = lfFile.replace(/\n/g, "\r\n");
    const fromLf = parsePostMarkdownFile(lfFile);
    const fromCrlf = parsePostMarkdownFile(crlfFile);
    expect(fromCrlf.fields).toEqual(fromLf.fields);
    expect(fromCrlf.body).toBe(
      "###### A dek\\.\r\n\r\nOne.\r\n\r\nTwo.\r\n",
    );
  });
});

describe("values that are valid JSON of the wrong type", () => {
  it("throws for bare true/123/[1] where text belongs, naming the key", () => {
    expect(() => parsePostMarkdownFile("---\ntitle: true\n---\nx")).toThrow(/title/);
    expect(() => parsePostMarkdownFile("---\ntitle: 123\n---\nx")).toThrow(/title/);
    expect(() => parsePostMarkdownFile("---\ntitle: [1]\n---\nx")).toThrow(/title/);
  });

  it("keeps quoted JSON-lookalikes as text", () => {
    const parsed = parsePostMarkdownFile('---\ntitle: "true"\nvenue: "123"\n---\nx');
    expect(parsed.fields.title).toBe("true");
    expect(parsed.fields.venue).toBe("123");
  });

  it("round-trips a post whose title IS the string true", () => {
    // Render quotes it (JSON.stringify), so parse must give the string back.
    const post: Post = { ...basePost, title: "true" };
    const file = renderPostMarkdownFile({ blog, post });
    expect(file).toContain('title: "true"');
    expect(parsePostMarkdownFile(file).fields.title).toBe("true");
  });

  it("round-trips a post whose title is numeric text", () => {
    const post: Post = { ...basePost, title: "123" };
    const parsed = parsePostMarkdownFile(renderPostMarkdownFile({ blog, post }));
    expect(parsed.fields.title).toBe("123");
  });
});

describe("hostile hand-typed frontmatter", () => {
  it("accepts a key with no space after the colon", () => {
    const parsed = parsePostMarkdownFile(
      "---\ntitle:No Space\ncoverHeight:420\n---\nx",
    );
    expect(parsed.fields.title).toBe("No Space");
    expect(parsed.fields.coverHeight).toBe(420);
  });

  it("parses an empty frontmatter block as no fields", () => {
    expect(parsePostMarkdownFile("---\n---\nbody\n")).toEqual({
      fields: {},
      body: "body\n",
      unknownKeys: [],
    });
    // Degenerate file with no trailing newline and no body at all.
    expect(parsePostMarkdownFile("---\n---")).toEqual({
      fields: {},
      body: "",
      unknownKeys: [],
    });
  });

  it("keeps colons inside values, including ' : ' and URLs", () => {
    const parsed = parsePostMarkdownFile(
      [
        "---",
        "excerpt: before : after",
        "videoUrl: https://youtu.be/dQw4w9WgXcQ",
        "cover: http://cdn.example.com/img.jpg?x=1:2",
        "---",
        "x",
      ].join("\n"),
    );
    expect(parsed.fields.excerpt).toBe("before : after");
    expect(parsed.fields.videoUrl).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(parsed.fields.cover).toBe("http://cdn.example.com/img.jpg?x=1:2");
  });

  it("drops a poster-only gallery entry (no src, nothing to show)", () => {
    const parsed = parsePostMarkdownFile(
      '---\ngallery: [{"poster":"/p.jpg"},{"src":"/real.jpg","poster":"/q.jpg"}]\n---\nx',
    );
    expect(parsed.fields.gallery).toEqual([
      { src: "/real.jpg", poster: "/q.jpg" },
    ]);
  });

  it("rounds float coverHeights and rejects quoted ones", () => {
    expect(
      parsePostMarkdownFile("---\ncoverHeight: 420.7\n---\nx").fields.coverHeight,
    ).toBe(421);
    expect(
      parsePostMarkdownFile("---\ncoverHeight: -12.4\n---\nx").fields.coverHeight,
    ).toBe(-12);
    expect(() =>
      parsePostMarkdownFile('---\ncoverHeight: "420"\n---\nx'),
    ).toThrow(/coverHeight/);
  });

  it("accepts an unquoted ISO date and rejects nonsense and bare-number dates", () => {
    expect(parsePostMarkdownFile("---\ndate: 2026-07-04\n---\nx").fields.date).toBe(
      "2026-07-04",
    );
    expect(() => parsePostMarkdownFile("---\ndate: yesterday-ish\n---\nx")).toThrow(
      /date/,
    );
    // Bare 2026 is JSON number 2026; strict types say quote it.
    expect(() => parsePostMarkdownFile("---\ndate: 2026\n---\nx")).toThrow(/date/);
  });

  it("slugifies spaces, uppercase, and punctuation", () => {
    expect(
      parsePostMarkdownFile("---\nslug: Weird Slug!! With CAPS\n---\nx").fields.slug,
    ).toBe("weird-slug-with-caps");
    // A slug that reduces to nothing is skipped, not set to "".
    expect(
      parsePostMarkdownFile("---\nslug: !!!\n---\nx").fields.slug,
    ).toBeUndefined();
  });

  it("survives a leading UTF-8 BOM instead of demoting frontmatter to body", () => {
    const parsed = parsePostMarkdownFile('﻿---\ntitle: "BOM"\n---\nbody\n');
    expect(parsed.fields.title).toBe("BOM");
    expect(parsed.body).toBe("body\n");
  });
});

describe("hash stability and sensitivity", () => {
  const post: Post = {
    ...basePost,
    excerpt: "A dek.",
    accent: "#8a2be2",
    cover: "https://cdn.example.com/c.jpg",
    coverCaption: "Caption",
    coverHeight: 420,
    pinned: true,
    gallery: [{ src: "/g.jpg", caption: "g" }],
    links: [{ label: "L", href: "https://example.com" }],
    videoUrl: "https://youtu.be/dQw4w9WgXcQ",
    venue: "Somewhere",
    duration: "10 min",
  };
  const canonicalUrl = "https://write.example/t/demo/adversarial";
  // null means "render with NO canonical line"; an explicit undefined would
  // trip the default parameter and silently hash the same file as base.
  const hashOf = (p: Post, url: string | null = canonicalUrl) =>
    markdownFileHash(
      renderPostMarkdownFile({ blog, canonicalUrl: url ?? undefined, post: p }),
    );

  it("is byte-stable across two renders of the same post", () => {
    expect(hashOf({ ...post })).toBe(hashOf({ ...post }));
  });

  it("changes when any field, the body, or the canonical URL changes", () => {
    const variants: Record<string, string> = {
      base: hashOf(post),
      title: hashOf({ ...post, title: "Adversarial!" }),
      slug: hashOf({ ...post, slug: "adversarial-2" }),
      type: hashOf({ ...post, type: "project" }),
      status: hashOf({ ...post, status: "draft" }),
      excerpt: hashOf({ ...post, excerpt: "B dek." }),
      date: hashOf({ ...post, date: "2026-07-02" }),
      accent: hashOf({ ...post, accent: "#8a2be3" }),
      cover: hashOf({ ...post, cover: "https://cdn.example.com/d.jpg" }),
      coverCaption: hashOf({ ...post, coverCaption: "Caption 2" }),
      coverHeight: hashOf({ ...post, coverHeight: 421 }),
      pinned: hashOf({ ...post, pinned: false }),
      galleryCaption: hashOf({ ...post, gallery: [{ src: "/g.jpg", caption: "h" }] }),
      linkHref: hashOf({
        ...post,
        links: [{ label: "L", href: "https://example.org" }],
      }),
      videoUrl: hashOf({ ...post, videoUrl: "https://youtu.be/aaaaaaaaaaa" }),
      venue: hashOf({ ...post, venue: "Elsewhere" }),
      duration: hashOf({ ...post, duration: "11 min" }),
      body: hashOf({ ...post, body: "Plain body!" }),
      canonical: hashOf(post, "https://write.example/t/demo/other"),
      noCanonical: hashOf(post, null),
    };
    const hashes = Object.values(variants);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("does NOT change on non-content fields (id, timestamps, folderId)", () => {
    expect(
      hashOf({
        ...post,
        id: "other-id",
        folderId: "f2",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-02T00:00:00.000Z",
      }),
    ).toBe(hashOf(post));
  });
});

describe("manifest compatibility and integrity", () => {
  const fileUrlFor = (post: Post) =>
    `https://write.example/t/demo/${post.slug}/index.md`;
  const postUrlFor = (post: Post) => `https://write.example/t/demo/${post.slug}`;

  it("serializes with no undefined leakage in either v1 or v2 shape", () => {
    for (const options of [undefined, { folder, fileUrlFor, postUrlFor }]) {
      const manifest = renderFolderManifest(blog, [basePost], options);
      expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    }
  });

  it("keeps every v1 field with v1 values when options are omitted", () => {
    const manifest = renderFolderManifest(blog, [basePost]);
    expect(manifest.schema).toBe("write.folder.v1");
    expect(manifest.folder).toMatchObject({
      handle: "demo",
      name: "The Demo Broadsheet",
      mode: "blog",
      views: ["timeline", "index", "grid", "single"],
      itemKinds: ["article", "media_post", "video_post"],
      activeView: "timeline",
    });
    expect(manifest.items[0]).toMatchObject({
      file: "posts/adversarial.md",
      kind: "article",
      slug: "adversarial",
      title: "Adversarial",
      status: "published",
    });
  });

  it("hashes each item exactly as the index.md route renders it", () => {
    const manifest = renderFolderManifest(blog, [basePost], {
      folder,
      fileUrlFor,
      postUrlFor,
    });
    expect(manifest.items[0].hash).toBe(
      markdownFileHash(
        renderPostMarkdownFile({
          blog,
          canonicalUrl: postUrlFor(basePost),
          post: basePost,
        }),
      ),
    );
  });

  it("is stable across two manifest renders", () => {
    const a = renderFolderManifest(blog, [basePost], { folder, postUrlFor });
    const b = renderFolderManifest(blog, [basePost], { folder, postUrlFor });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("folder.json route conditional GET", () => {
  type RouteModule = typeof import("../../app/t/[handle]/folder.json/route");
  let GET: RouteModule["GET"];

  beforeAll(async () => {
    // db/client.ts reads DATABASE_URL at import time; clear it BEFORE the
    // route's import chain loads so the store serves the demo seed.
    delete process.env.DATABASE_URL;
    ({ GET } = await import("../../app/t/[handle]/folder.json/route"));
  });

  const demoRequest = (headers?: Record<string, string>) =>
    GET(new Request("http://localhost:3000/t/demo/folder.json", { headers }), {
      params: Promise.resolve({ handle: "demo" }),
    });

  it("serves the v2 manifest with an ETag that hashes the exact body", async () => {
    const response = await demoRequest();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    const body = await response.text();
    expect(response.headers.get("ETag")).toBe(`"${markdownFileHash(body)}"`);

    const manifest = JSON.parse(body);
    expect(manifest.schema).toBe("write.folder.v1");
    expect(manifest.folder.mode).toBe("blog");
    expect(manifest.folder.id).toBe("demo-blog-folder");
    expect(manifest.folder.path).toBe("blog");
    for (const item of manifest.items) {
      expect(item.status).toBe("published");
      expect(item.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(item.url).toMatch(/\/index\.md$/);
    }
  });

  it("replies 304 with ETag and no body on an exact If-None-Match", async () => {
    const first = await demoRequest();
    const etag = first.headers.get("ETag")!;
    const second = await demoRequest({ "If-None-Match": etag });
    expect(second.status).toBe(304);
    expect(second.headers.get("ETag")).toBe(etag);
    expect(second.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(await second.text()).toBe("");
  });

  it("matches any candidate in a comma-separated list", async () => {
    const etag = (await demoRequest()).headers.get("ETag")!;
    const response = await demoRequest({
      "If-None-Match": `"stale-one", ${etag}, "stale-two"`,
    });
    expect(response.status).toBe(304);
  });

  it("uses the RFC 9110 WEAK comparison, so W/ prefixed validators match", async () => {
    const etag = (await demoRequest()).headers.get("ETag")!;
    const response = await demoRequest({ "If-None-Match": `W/${etag}` });
    expect(response.status).toBe(304);
  });

  it("treats If-None-Match: * as matching the current representation", async () => {
    const response = await demoRequest({ "If-None-Match": "*" });
    expect(response.status).toBe(304);
  });

  it("serves 200 for a stale validator", async () => {
    const response = await demoRequest({ "If-None-Match": '"deadbeef"' });
    expect(response.status).toBe(200);
  });

  it("404s an unknown handle before touching folders", async () => {
    const response = await GET(
      new Request("http://localhost:3000/t/nope/folder.json"),
      { params: Promise.resolve({ handle: "nope" }) },
    );
    expect(response.status).toBe(404);
  });
});
