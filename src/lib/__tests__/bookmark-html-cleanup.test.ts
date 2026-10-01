import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BookmarkCapture } from "@/lib/content";

const mocks = vi.hoisted(() => ({
  deleteBlob: vi.fn(),
  getPostById: vi.fn(),
  markCapturePending: vi.fn(),
  recordAction: vi.fn(),
  resolveItemAccess: vi.fn(),
  resolveSyncWorkspace: vi.fn(),
  revalidateBlogPaths: vi.fn(),
  saveBookmarkCapture: vi.fn(),
}));

vi.mock("@/lib/media-storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/media-storage")>(),
  isMediaStorageConfigured: () => true,
  del: mocks.deleteBlob,
  put: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction }));
vi.mock("@/lib/permissions", () => ({
  resolveItemAccess: mocks.resolveItemAccess,
}));
vi.mock("@/lib/revalidate-blog", () => ({
  revalidateBlogPaths: mocks.revalidateBlogPaths,
}));
vi.mock("@/app/api/sync/v1/auth", () => ({
  resolveSyncWorkspace: mocks.resolveSyncWorkspace,
}));
vi.mock("@/lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/store")>();
  return {
    ...actual,
    getPostById: mocks.getPostById,
    markCapturePending: mocks.markCapturePending,
    saveBookmarkCapture: mocks.saveBookmarkCapture,
  };
});

import { POST } from "@/app/api/sync/v1/captures/[postId]/route";
import {
  legacyBookmarkHtmlUrl,
  mergeBookmarkCapture,
  stripLegacyBookmarkHtmlUrl,
} from "@/lib/store";

const legacyCapture = {
  url: "https://example.com/article",
  title: "Article",
  htmlUrl: "https://store.public.blob.vercel-storage.com/page.html-legacy",
} as BookmarkCapture;

const savedBlobToken = process.env.MEDIA_ORIGIN;

beforeEach(() => {
  process.env.MEDIA_ORIGIN = "https://texttext.example";
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.resolveSyncWorkspace.mockResolvedValue({
    blog: {
      handle: "demo",
      name: "Demo",
      author: "Demo",
      homeLayout: "grid",
    },
    userId: "user-1",
  });
  mocks.resolveItemAccess.mockResolvedValue({ isOwner: true });
  mocks.getPostById.mockResolvedValue({
    id: "bookmark-1",
    type: "bookmark",
    slug: "article",
    title: "Article",
    body: "",
    links: [{ label: "Article", href: "https://example.com/article" }],
    capture: legacyCapture,
    status: "draft",
  });
  mocks.markCapturePending.mockResolvedValue({
    id: "bookmark-1",
    slug: "article",
    captureStatus: "pending",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedBlobToken === undefined) delete process.env.MEDIA_ORIGIN;
  else process.env.MEDIA_ORIGIN = savedBlobToken;
});

describe("legacy bookmark HTML metadata", () => {
  it("finds and strips an existing htmlUrl without changing other fields", () => {
    expect(legacyBookmarkHtmlUrl(legacyCapture)).toBe(
      "https://store.public.blob.vercel-storage.com/page.html-legacy",
    );
    expect(stripLegacyBookmarkHtmlUrl(legacyCapture)).toEqual({
      url: "https://example.com/article",
      title: "Article",
    });
  });

  it("does not let htmlUrl survive either side of a capture merge", () => {
    const incoming = {
      url: "https://example.com/article",
      description: "Fresh capture",
      htmlUrl: "https://store.public.blob.vercel-storage.com/new.html-legacy",
    } as BookmarkCapture;

    expect(mergeBookmarkCapture(legacyCapture, incoming)).toEqual({
      url: "https://example.com/article",
      title: "Article",
      description: "Fresh capture",
    });
  });
});

describe("legacy bookmark HTML blob deletion", () => {
  it("deletes the artifact when the bookmark is recaptured", async () => {
    const response = await POST(
      new Request("https://texttext.example/api/sync/v1/captures/bookmark-1", {
        method: "POST",
      }),
      { params: Promise.resolve({ postId: "bookmark-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
  });

  it("ignores disposable legacy Blob storage during recapture", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = new Error("Blob unavailable");
    mocks.deleteBlob.mockRejectedValue(failure);

    const response = await POST(
      new Request("https://texttext.example/api/sync/v1/captures/bookmark-1", {
        method: "POST",
      }),
      { params: Promise.resolve({ postId: "bookmark-1" }) },
    );

    expect(response.status).toBe(200);
    expect(warning).not.toHaveBeenCalled();
  });
});
