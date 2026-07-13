// The pure parts of the sync API routes: conditional-request matchers, error
// shape, and manifest item building. The bearer-auth + database glue is not
// covered here (it needs a live db); see src/app/api/sync/v1/auth.ts.

import { describe, expect, it } from "vitest";

import {
  clientSaveError,
  ifMatchSatisfied,
  ifNoneMatchSatisfied,
  isUuid,
  renderSyncFile,
  syncError,
  syncFileUrl,
  syncManifestItem,
} from "@/app/api/sync/v1/sync";
import type { Blog, Post } from "@/lib/content";
import { markdownFileHash } from "@/lib/content-hash";
import { parsePostMarkdownFile } from "@/lib/markdown-files";

const blog: Blog = {
  handle: "demo",
  name: "The Demo Broadsheet",
  author: "Demo Author",
  cardStyle: "cover",
  homeLayout: "timeline",
};

const post: Post = {
  id: "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60",
  type: "article",
  slug: "hello-sync",
  title: "Hello Sync",
  excerpt: "A post for the sync tests.",
  body: "First paragraph.\n\nSecond paragraph.",
  date: "2026-07-01",
  status: "published",
  createdAt: "2026-06-30T08:00:00.000Z",
  updatedAt: "2026-07-01T09:30:00.000Z",
};

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

describe("syncError", () => {
  it("emits the status and a JSON {error} body", async () => {
    const response = syncError(412, "conflict");
    expect(response.status).toBe(412);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "conflict" });
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
    expect(parsed.body.trim()).toBe(post.body.trim());
  });
});

describe("syncManifestItem", () => {
  it("points at the sync file url with the file's hash", () => {
    const item = syncManifestItem(blog, post);
    expect(item.url).toBe(syncFileUrl(post.id ?? ""));
    expect(item.url).toBe(`/api/sync/v1/files/${post.id}`);
    expect(item.hash).toBe(renderSyncFile(blog, post).hash);
    expect(item.id).toBe(post.id);
    expect(item.slug).toBe(post.slug);
    expect(item.status).toBe("published");
    expect(item.updatedAt).toBe(post.updatedAt);
  });
});
