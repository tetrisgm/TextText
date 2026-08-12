// The pure parts of the sync API routes: conditional-request matchers, error
// shape, and manifest item building. The bearer-auth + database glue is not
// covered here (it needs a live db); see src/app/api/sync/v1/auth.ts.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clientSaveError,
  ifMatchSatisfied,
  ifNoneMatchSatisfied,
  isUuid,
  parseSyncFileRepresentation,
  renderSyncFolderManifest,
  renderSyncDocumentFile,
  renderSyncFile,
  syncChangePollUnavailable,
  syncError,
  syncDatabaseUnavailable,
  syncFilePath,
  syncFileUrl,
  syncManifestItem,
} from "@/app/api/sync/v1/sync";
import type { Blog, Post } from "@/lib/content";
import { markdownFileHash } from "@/lib/content-hash";
import { documentFromLegacyPost } from "@/lib/documents/legacy";
import {
  parsePostMarkdownFile,
  renderFolderManifest,
  renderPostMarkdownFile,
} from "@/lib/markdown-files";
import { postBodyWithSubtitle } from "@/lib/markdown-subtitle";

const blog: Blog = {
  handle: "demo",
  name: "The Demo Broadsheet",
  author: "Demo Author",
  cardStyle: "cover",
  homeLayout: "timeline",
};

const legacyPost: Post = {
  id: "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60",
  representation: "textbundle",
  type: "article",
  slug: "hello-sync",
  title: "Hello Sync",
  excerpt: "A post for the sync tests.",
  body: "First paragraph.\n\nSecond paragraph.",
  date: "2026-07-01",
  status: "published",
  createdAt: "2026-06-30T08:00:00.000Z",
  updatedAt: "2026-07-01T09:30:00.000Z",
  folderId: "31b53543-f5de-4a46-937f-c645bfcaa9c3",
  revision: 42,
};
const post: Post = {
  ...legacyPost,
  document: documentFromLegacyPost(legacyPost),
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ifMatchSatisfied", () => {
  const etag = '"abc123"';

  it("matches the exact strong etag", () => {
    expect(ifMatchSatisfied('"abc123"', etag)).toBe(true);
  });

  it("accepts the bare hash as a courtesy", () => {
    expect(ifMatchSatisfied("abc123", etag)).toBe(true);
  });

  it("matches inside a comma-separated list", () => {
    expect(ifMatchSatisfied('"zzz", "abc123"', etag)).toBe(true);
  });

  it("matches *", () => {
    expect(ifMatchSatisfied("*", etag)).toBe(true);
  });

  it("accepts a proxy-weakened validator (our etag is a content hash)", () => {
    // Vercel weakens the ETag to W/"..." when it gzips the GET the client hashed
    // against; that denotes the SAME content, so it must satisfy a later write.
    expect(ifMatchSatisfied('W/"abc123"', etag)).toBe(true);
    // A client that stripped the quotes before the weak prefix sends "W/hash".
    expect(ifMatchSatisfied('"W/abc123"', etag)).toBe(true);
  });

  it("rejects a stale etag", () => {
    expect(ifMatchSatisfied('"old"', etag)).toBe(false);
    expect(ifMatchSatisfied('W/"old"', etag)).toBe(false);
    expect(ifMatchSatisfied("", etag)).toBe(false);
  });
});

describe("ifNoneMatchSatisfied", () => {
  const etag = '"abc123"';

  it("matches the exact etag", () => {
    expect(ifNoneMatchSatisfied('"abc123"', etag)).toBe(true);
  });

  it("matches a proxy-weakened W/ candidate (weak comparison)", () => {
    expect(ifNoneMatchSatisfied('W/"abc123"', etag)).toBe(true);
  });

  it("matches inside a list and on *", () => {
    expect(ifNoneMatchSatisfied('"zzz", W/"abc123"', etag)).toBe(true);
    expect(ifNoneMatchSatisfied("*", etag)).toBe(true);
  });

  it("rejects a stale etag", () => {
    expect(ifNoneMatchSatisfied('"old"', etag)).toBe(false);
  });
});

describe("isUuid", () => {
  it("accepts uuids and rejects everything else", () => {
    expect(isUuid("0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60")).toBe(true);
    expect(isUuid("0B4F6A52-8C1D-4E3A-9B7F-2D5E8A1C3F60")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f6")).toBe(false);
  });
});

describe("parseSyncFileRepresentation", () => {
  it("keeps headerless legacy sync creates as markdown", () => {
    expect(parseSyncFileRepresentation(null)).toBe("markdown");
  });

  it.each(["textbundle", "markdown", "text"] as const)(
    "accepts the %s representation",
    (representation) => {
      expect(parseSyncFileRepresentation(` ${representation} `)).toBe(
        representation,
      );
    },
  );

  it("rejects empty, unknown, and non-canonical values", () => {
    expect(parseSyncFileRepresentation("")).toBeNull();
    expect(parseSyncFileRepresentation("pdf")).toBeNull();
    expect(parseSyncFileRepresentation("Markdown")).toBeNull();
    expect(parseSyncFileRepresentation("markdown, text")).toBeNull();
  });
});

describe("syncError", () => {
  it("emits the status and a JSON {error} body", async () => {
    const response = syncError(412, "conflict");
    expect(response.status).toBe(412);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "conflict" });
  });
});

describe("syncDatabaseUnavailable", () => {
  it("returns a retryable 503 for a Neon quota outage", async () => {
    const response = syncDatabaseUnavailable(
      Object.assign(new Error("Your project has exceeded the data transfer quota"), {
        status: 402,
        retryable: true,
      }),
    );

    expect(response?.status).toBe(503);
    expect(response?.headers.get("retry-after")).toBe("300");
    await expect(response?.json()).resolves.toEqual({
      error: "Sync is temporarily unavailable",
    });
  });

  it("does not hide an unrelated programming error", () => {
    expect(syncDatabaseUnavailable(new TypeError("bad code"))).toBeNull();
  });
});

describe("syncChangePollUnavailable", () => {
  it("keeps an unknown long-poll failure on the retry path", async () => {
    const response = syncChangePollUnavailable(new TypeError("bad code"));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    await expect(response.json()).resolves.toEqual({
      error: "Sync is temporarily unavailable",
    });
  });

  it("preserves the longer backoff for a known database outage", () => {
    const response = syncChangePollUnavailable(
      Object.assign(new Error("quota"), { status: 402 }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("300");
  });
});

describe("clientSaveError", () => {
  it("recognizes the slug-conflict message a client can fix", () => {
    expect(clientSaveError(new Error("That URL is already used"))).toBe(
      "That URL is already used",
    );
  });

  it("returns null for internal failures and non-errors", () => {
    expect(clientSaveError(new Error("Failed query: update posts ..."))).toBeNull();
    expect(clientSaveError("That URL is already used")).toBeNull();
    expect(clientSaveError(null)).toBeNull();
  });
});

describe("renderSyncFile", () => {
  it("hashes exactly the text it renders", () => {
    const file = renderSyncFile(blog, post);
    expect(file.hash).toBe(markdownFileHash(file.text));
  });

  it("round-trips through the parser", () => {
    const parsed = parsePostMarkdownFile(renderSyncFile(blog, post).text);
    expect(parsed.fields.slug).toBe(post.slug);
    expect(parsed.fields.title).toBe(post.title);
    expect(parsed.body.trim()).toBe(postBodyWithSubtitle(post).trim());
    expect(parsed.unknownKeys).not.toContain("syncRevision");
  });

  it("uses a sync-only revision field as metadata CAS currency", () => {
    const before = renderSyncFile(blog, post);
    const afterMove = renderSyncFile(blog, {
      ...post,
      folderId: "43625c1a-da74-45ac-8db0-790c1c22088e",
      revision: 43,
    });
    const publicBefore = renderPostMarkdownFile({ blog, post });
    const publicAfter = renderPostMarkdownFile({
      blog,
      post: {
        ...post,
        folderId: "43625c1a-da74-45ac-8db0-790c1c22088e",
        revision: 43,
      },
    });

    expect(before.text).toContain("syncRevision: 42");
    expect(afterMove.text).toContain("syncRevision: 43");
    expect(afterMove.hash).not.toBe(before.hash);
    expect(publicAfter).toBe(publicBefore);
    expect(publicBefore).not.toContain("syncRevision:");
  });

  it("does not put the local representation into canonical bytes or hashes", () => {
    const baseline = renderSyncFile(blog, post);
    for (const representation of ["markdown", "text"] as const) {
      expect(renderSyncFile(blog, { ...post, representation })).toEqual(baseline);
    }
  });
});

describe("renderSyncDocumentFile", () => {
  it("changes its validator for presentation-only edits", () => {
    const baseline = renderSyncDocumentFile(blog, post);
    const restyled = renderSyncDocumentFile(blog, {
      ...post,
      document: {
        schemaVersion: 1,
        content: {
          title: post.title,
          subtitle: post.excerpt,
          body: post.body,
          fields: {},
          tags: [],
          assets: [],
        },
        presentation: {
          template: { id: "texttext.gallery", version: 1 },
          theme: { accent: "#0066cc" },
        },
      },
    });

    expect(restyled.hash).not.toBe(baseline.hash);
    expect(renderSyncFile(blog, { ...post, document: undefined })).toEqual(
      renderSyncFile(blog, {
        ...post,
        document: {
          schemaVersion: 1,
          content: {
            title: post.title,
            subtitle: post.excerpt,
            body: post.body,
            fields: {},
            tags: [],
            assets: [],
          },
          presentation: {
            template: { id: "texttext.gallery", version: 1 },
            theme: { accent: "#0066cc" },
          },
        },
      }),
    );
  });

  it("rejects a persisted item without its canonical document", () => {
    expect(() =>
      renderSyncDocumentFile(blog, { ...post, document: undefined }),
    ).toThrow("missing its canonical document");
  });
});

describe("syncManifestItem", () => {
  it("points at the sync file url with the file's hash", () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "texttext.example");
    const item = syncManifestItem(blog, post);
    expect(item.url).toBe(syncFileUrl(post.id ?? ""));
    expect(item.url).toBe(`/api/sync/v1/files/${post.id}`);
    expect(item.canonicalUrl).toBe(
      "https://demo.texttext.example/blog/hello-sync",
    );
    expect(item.hash).toBe(renderSyncFile(blog, post).hash);
    expect(item.id).toBe(post.id);
    expect(item.slug).toBe(post.slug);
    expect(item.status).toBe("published");
    expect(item.updatedAt).toBe(post.updatedAt);
    expect(item.representation).toBe("textbundle");
    expect(item.file).toBe("posts/hello-sync.textbundle");
  });

  it.each([
    ["textbundle", "posts/hello-sync.textbundle"],
    ["markdown", "posts/hello-sync.md"],
    ["text", "posts/hello-sync.txt"],
  ] as const)("uses the %s filename", (representation, filename) => {
    const represented = { ...post, representation };
    expect(syncFilePath(represented)).toBe(filename);
    expect(syncManifestItem(blog, represented)).toMatchObject({
      file: filename,
      representation,
    });
  });

  it("adds representation to every sync item without changing public manifests", () => {
    const sync = renderSyncFolderManifest(blog, [post]);
    const publicManifest = renderFolderManifest(blog, [post]);

    expect(sync.items[0].representation).toBe("textbundle");
    expect(sync.items[0].file).toBe("posts/hello-sync.textbundle");
    expect(publicManifest.items[0].file).toBe("posts/hello-sync.md");
    expect(publicManifest.items[0]).not.toHaveProperty("representation");
  });
});
