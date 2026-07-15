import { describe, expect, it } from "vitest";

import type { Blog, Folder, Post } from "@/lib/content";
import { markdownFileHash } from "@/lib/content-hash";
import {
  parsePostMarkdownFile,
  renderFolderManifest,
  renderPostMarkdownFile,
  type ParsedPostFields,
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

const fullArticle: Post = {
  id: "post-1",
  type: "article",
  slug: "everything-bagel",
  title: "The Everything Bagel",
  excerpt: "One post, every field.",
  accent: "#8a2be2",
  cover: "https://cdn.example.com/covers/bagel.jpg",
  coverCaption: "A very full bagel",
  coverHeight: 420,
  body: "First paragraph.\n\nSecond paragraph with **bold** text.\n\n> A quote.",
  date: "2026-07-01",
  status: "published",
  pinned: true,
  createdAt: "2026-06-30T08:00:00.000Z",
  updatedAt: "2026-07-01T09:30:00.000Z",
};

const project: Post = {
  id: "post-2",
  type: "project",
  slug: "glass-teapot",
  title: "Glass Teapot",
  excerpt: "A see-through kettle.",
  body: "Photos and process notes.",
  date: "2026-05-12",
  status: "published",
  gallery: [
    { src: "https://cdn.example.com/g/1.jpg", caption: "The first pour" },
    { src: "https://cdn.example.com/g/2.mp4", poster: "https://cdn.example.com/g/2.jpg" },
    { src: "https://cdn.example.com/g/3.jpg" },
  ],
  links: [
    { label: "Source", href: "https://example.com/source" },
    { label: "https://example.com/demo", href: "https://example.com/demo" },
  ],
};

const talk: Post = {
  id: "post-3",
  type: "talk",
  slug: "why-teapots",
  title: "Why Teapots?",
  body: "Abstract and speaker notes.",
  date: "2025-11-02",
  status: "published",
  videoUrl: "https://youtu.be/dQw4w9WgXcQ",
  venue: "TeapotConf, Lisbon",
  duration: "32 min",
};

const untitledDraft: Post = {
  type: "article",
  slug: "untitled-6f2a",
  title: "",
  body: "",
  status: "draft",
};

const trickyText: Post = {
  id: "post-5",
  type: "article",
  slug: "tricky",
  title: 'She said: "it\'s 100% éclair" 🍰',
  excerpt: "Colons: quotes \" and\nnewlines? 日本語 too.",
  body: 'Line one: with a colon.\n\n"Quoted" text, unicode ☃, emoji 🎉.\n\ntabs\tand   spaces survive.',
  status: "published",
};

const dashedBody: Post = {
  id: "post-6",
  type: "article",
  slug: "dashes",
  title: "Full of Dashes",
  body: "Intro.\n\n---\n\ntitle: fake frontmatter inside the body\nstatus: published\n---\n\nOutro after a second rule.",
  status: "draft",
};

// What parse should recover from a rendered file: every set field, with
// gallery/links normalized the way render normalizes them.
function expectedFields(post: Post): ParsedPostFields {
  const fields: ParsedPostFields = {
    slug: post.slug,
    type: post.type,
    status: post.status,
  };
  if (post.title) fields.title = post.title;
  if (post.excerpt) fields.excerpt = post.excerpt.trim();
  if (post.date) fields.date = post.date;
  if (post.accent) fields.accent = post.accent;
  if (post.cover) fields.cover = post.cover;
  if (post.coverCaption) fields.coverCaption = post.coverCaption;
  if (post.coverHeight !== undefined) fields.coverHeight = post.coverHeight;
  if (post.pinned) fields.pinned = true;
  if (post.gallery && post.gallery.length > 0) {
    fields.gallery = post.gallery.map((item) => ({
      src: item.src,
      ...(item.caption ? { caption: item.caption } : {}),
      ...(item.poster ? { poster: item.poster } : {}),
    }));
  }
  if (post.links && post.links.length > 0) fields.links = post.links;
  if (post.videoUrl) fields.videoUrl = post.videoUrl;
  if (post.venue) fields.venue = post.venue;
  if (post.duration) fields.duration = post.duration;
  return fields;
}

describe("render -> parse round trip", () => {
  const menagerie: Array<[string, Post]> = [
    ["article with everything", fullArticle],
    ["project with gallery and links", project],
    ["talk with venue, duration, videoUrl", talk],
    ["minimal untitled draft", untitledDraft],
    ["quotes, colons, newlines, unicode, emoji", trickyText],
    ["body containing --- lines and fake frontmatter", dashedBody],
  ];

  it.each(menagerie)("round-trips %s", (_label, post) => {
    const file = renderPostMarkdownFile({
      blog,
      canonicalUrl: `https://write.example/t/demo/${post.slug}`,
      post,
    });
    const parsed = parsePostMarkdownFile(file);

    expect(parsed.fields).toEqual(expectedFields(post));
    // The trim contract: render trims the body and appends one newline;
    // parse eats the blank separator lines, so an empty body comes back "".
    expect(parsed.body).toBe(post.body.trim() ? `${post.body.trim()}\n` : "");
    expect(parsed.unknownKeys).toEqual([]);
  });

  it("renders a date line for published posts only", () => {
    // A draft's date is derived (createdAt fallback), not authored; if it
    // were rendered, publishing by flipping status in the file would carry it
    // into savePost and backdate the publish instead of stamping now.
    const published = renderPostMarkdownFile({ blog, post: fullArticle });
    expect(published).toContain('\ndate: "2026-07-01"\n');
    const draft = renderPostMarkdownFile({
      blog,
      post: { ...fullArticle, status: "draft" },
    });
    expect(draft).not.toContain("\ndate:");
  });

  it("keeps the body byte-identical through a second render", () => {
    const file = renderPostMarkdownFile({ blog, post: dashedBody });
    const parsed = parsePostMarkdownFile(file);
    const again = renderPostMarkdownFile({
      blog,
      post: { ...dashedBody, body: parsed.body },
    });
    expect(again).toBe(file);
  });
});

describe("hand-written human frontmatter", () => {
  it("parses unquoted strings, bare numbers, and bare booleans", () => {
    const parsed = parsePostMarkdownFile(
      [
        "---",
        "title: My Summer Post",
        "kind: article",
        "status: draft",
        "date: 2026-07-04",
        "excerpt: Colons: fine in the middle",
        "coverHeight: 420",
        "pinned: true",
        "accent: #065ec6",
        "---",
        "",
        "Hello from a plain text editor.",
        "",
      ].join("\n"),
    );

    expect(parsed.fields).toEqual({
      title: "My Summer Post",
      type: "article",
      status: "draft",
      date: "2026-07-04",
      excerpt: "Colons: fine in the middle",
      coverHeight: 420,
      pinned: true,
      accent: "#065ec6",
    });
    expect(parsed.body).toBe("Hello from a plain text editor.\n");
    expect(parsed.unknownKeys).toEqual([]);
  });

  it("maps both kind vocabularies onto post types", () => {
    expect(
      parsePostMarkdownFile("---\nkind: media_post\n---\nx").fields.type,
    ).toBe("project");
    expect(
      parsePostMarkdownFile("---\nkind: video_post\n---\nx").fields.type,
    ).toBe("talk");
    expect(parsePostMarkdownFile("---\ntype: talk\n---\nx").fields.type).toBe(
      "talk",
    );
    // type (the native vocabulary) wins when both are present.
    expect(
      parsePostMarkdownFile("---\nkind: media_post\ntype: article\n---\nx")
        .fields.type,
    ).toBe("article");
  });

  it("slugifies a human-typed slug", () => {
    const parsed = parsePostMarkdownFile("---\nslug: My GREAT Post!!\n---\nx");
    expect(parsed.fields.slug).toBe("my-great-post");
  });

  it("skips empty values instead of setting empty fields", () => {
    const parsed = parsePostMarkdownFile("---\ntitle:\nexcerpt: \n---\nbody");
    expect(parsed.fields).toEqual({});
  });
});

describe("wrong types throw, naming the key", () => {
  it("rejects a number where text belongs", () => {
    expect(() => parsePostMarkdownFile("---\ntitle: 123\n---\nx")).toThrow(
      /title/,
    );
  });

  it("rejects a non-boolean pinned", () => {
    expect(() => parsePostMarkdownFile('---\npinned: "yes"\n---\nx')).toThrow(
      /pinned/,
    );
  });

  it("rejects a non-numeric coverHeight", () => {
    expect(() =>
      parsePostMarkdownFile("---\ncoverHeight: tall\n---\nx"),
    ).toThrow(/coverHeight/);
  });

  it("rejects an unknown status", () => {
    expect(() => parsePostMarkdownFile("---\nstatus: archived\n---\nx")).toThrow(
      /status/,
    );
  });

  it("rejects an unknown kind or type", () => {
    expect(() => parsePostMarkdownFile("---\nkind: banana\n---\nx")).toThrow(
      /kind/,
    );
    expect(() => parsePostMarkdownFile("---\ntype: banana\n---\nx")).toThrow(
      /type/,
    );
  });

  it("rejects a malformed accent", () => {
    expect(() => parsePostMarkdownFile("---\naccent: blue\n---\nx")).toThrow(
      /accent/,
    );
  });

  it("rejects an unparseable date", () => {
    expect(() =>
      parsePostMarkdownFile("---\ndate: not a real day\n---\nx"),
    ).toThrow(/date/);
  });

  it("rejects a non-list gallery and non-list links", () => {
    expect(() => parsePostMarkdownFile("---\ngallery: 5\n---\nx")).toThrow(
      /gallery/,
    );
    expect(() => parsePostMarkdownFile('---\nlinks: "nope"\n---\nx')).toThrow(
      /links/,
    );
  });

  it("rejects block YAML with a pointer at the offending line", () => {
    const file = "---\ngallery:\n  - src: /a.jpg\n---\nx";
    expect(() => parsePostMarkdownFile(file)).toThrow(/- src/);
  });
});

describe("gallery and links entry handling", () => {
  it("drops gallery entries without src and links without href", () => {
    const parsed = parsePostMarkdownFile(
      [
        "---",
        'gallery: [{"caption":"no src"},{"src":"/keep.jpg"}]',
        'links: [{"label":"no href"},{"href":"https://example.com"}]',
        "---",
        "x",
      ].join("\n"),
    );
    expect(parsed.fields.gallery).toEqual([{ src: "/keep.jpg" }]);
    expect(parsed.fields.links).toEqual([
      { label: "https://example.com", href: "https://example.com" },
    ]);
  });
});

describe("unknown keys", () => {
  it("collects unknown keys without failing the parse", () => {
    const parsed = parsePostMarkdownFile(
      '---\ntitle: Known\nwibble: 1\ncustomField: "x"\n---\nbody',
    );
    expect(parsed.fields.title).toBe("Known");
    expect(parsed.unknownKeys).toEqual(["wibble", "customField"]);
  });

  it("treats render metadata keys as known", () => {
    const parsed = parsePostMarkdownFile(
      [
        "---",
        'schema: "write.markdown-file.v1"',
        'workspace: "The Demo Broadsheet"',
        'folder: "demo"',
        'folderName: "The Demo Broadsheet"',
        'mode: "blog"',
        'canonical: "https://write.example/t/demo/x"',
        "---",
        "x",
      ].join("\n"),
    );
    expect(parsed.unknownKeys).toEqual([]);
  });
});

describe("files without frontmatter", () => {
  it("parses a plain markdown file as all body", () => {
    const text = "# Hello\n\nJust markdown.\n\n---\n\nWith a rule mid-body.\n";
    const parsed = parsePostMarkdownFile(text);
    expect(parsed).toEqual({ fields: {}, body: text, unknownKeys: [] });
  });

  it("treats an unterminated opening --- as body", () => {
    const text = "---\n\nA document that starts with a horizontal rule.\n";
    const parsed = parsePostMarkdownFile(text);
    expect(parsed).toEqual({ fields: {}, body: text, unknownKeys: [] });
  });
});

describe("folder manifest v2", () => {
  const posts = [fullArticle, project, untitledDraft];
  const postUrlFor = (post: Post) =>
    `https://write.example/t/demo/${post.slug}`;
  const fileUrlFor = (post: Post) =>
    `https://write.example/t/demo/${post.slug}/index.md`;

  it("carries folder identity, mode, and activeView", () => {
    const manifest = renderFolderManifest(blog, posts, { folder });
    expect(manifest.schema).toBe("write.folder.v1");
    expect(manifest.folder.handle).toBe("demo");
    expect(manifest.folder.name).toBe("The Demo Broadsheet");
    expect(manifest.folder.id).toBe("folder-1");
    expect(manifest.folder.path).toBe("blog");
    expect(manifest.folder.mode).toBe("blog");
    expect(manifest.folder.activeView).toBe("timeline");
    expect(manifest.folder.views).toEqual(["timeline", "index", "grid", "single"]);
  });

  it("keeps the v1 shape when called without options", () => {
    const manifest = renderFolderManifest(blog, posts);
    expect(manifest.folder.mode).toBe("blog");
    expect(manifest.folder.id).toBeUndefined();
    expect(manifest.folder.path).toBeUndefined();
    const item = manifest.items[0];
    expect(item.file).toBe("posts/everything-bagel.md");
    expect(item.kind).toBe("article");
    expect(item.slug).toBe("everything-bagel");
    expect(item.title).toBe("The Everything Bagel");
    expect(item.status).toBe("published");
    expect(item.url).toBeUndefined();
    expect(item.canonicalUrl).toBeUndefined();
    expect(item.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives each item id, dates, url, and a file hash", () => {
    const manifest = renderFolderManifest(blog, posts, {
      folder,
      fileUrlFor,
      postUrlFor,
    });
    const item = manifest.items[0];
    expect(item.id).toBe("post-1");
    expect(item.date).toBe("2026-07-01");
    expect(item.createdAt).toBe("2026-06-30T08:00:00.000Z");
    expect(item.updatedAt).toBe("2026-07-01T09:30:00.000Z");
    expect(item.url).toBe(
      "https://write.example/t/demo/everything-bagel/index.md",
    );
    expect(item.canonicalUrl).toBe(
      "https://write.example/t/demo/everything-bagel",
    );
    expect(item.hash).toBe(
      markdownFileHash(
        renderPostMarkdownFile({
          blog,
          canonicalUrl: postUrlFor(fullArticle),
          post: fullArticle,
        }),
      ),
    );

    // Drafts pass through with their real status when the caller includes them.
    const draft = manifest.items[2];
    expect(draft.status).toBe("draft");
    expect(draft.id).toBeUndefined();
  });

  it("changes the hash when the body changes", () => {
    const before = renderFolderManifest(blog, [fullArticle], {
      folder,
      fileUrlFor,
      postUrlFor,
    });
    const after = renderFolderManifest(
      blog,
      [{ ...fullArticle, body: `${fullArticle.body}\n\nAn edit.` }],
      { folder, fileUrlFor, postUrlFor },
    );
    expect(after.items[0].hash).not.toBe(before.items[0].hash);
  });
});

describe("accent opt-out round trip", () => {
  it("preserves an explicit empty accent (opt-out of the blog accent)", () => {
    const optOut: Post = {
      ...fullArticle,
      accent: "",
    };
    const rendered = renderPostMarkdownFile({ blog, post: optOut });
    expect(rendered).toContain('accent: ""');
    const parsed = parsePostMarkdownFile(rendered);
    expect(parsed.fields.accent).toBe("");
  });

  it("still omits accent entirely when the post has none", () => {
    const inherit: Post = { ...fullArticle, accent: undefined };
    const rendered = renderPostMarkdownFile({ blog, post: inherit });
    expect(rendered).not.toContain("accent:");
    const parsed = parsePostMarkdownFile(rendered);
    expect(parsed.fields.accent).toBeUndefined();
  });
});

describe("closing delimiter forgiveness", () => {
  it("accepts trailing whitespace on the closing --- line", () => {
    const file = '---\ntitle: "Spaced"\n---   \n\nBody text.\n';
    const parsed = parsePostMarkdownFile(file);
    expect(parsed.fields.title).toBe("Spaced");
    expect(parsed.body).toBe("Body text.\n");
  });
});
