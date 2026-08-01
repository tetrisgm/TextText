import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPostById: vi.fn(),
  put: vi.fn(),
  recordAction: vi.fn(),
  resolveItemAccess: vi.fn(),
  resolveSyncWorkspace: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ put: mocks.put }));
vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction }));
vi.mock("@/lib/permissions", () => ({
  resolveItemAccess: mocks.resolveItemAccess,
}));
vi.mock("@/lib/store", () => ({ getPostById: mocks.getPostById }));
vi.mock("@/app/api/sync/v1/auth", () => ({
  resolveSyncWorkspace: mocks.resolveSyncWorkspace,
}));

import { GET } from "@/app/api/sync/v1/files/[postId]/artifacts/route";
import { POST } from "@/app/api/sync/v1/files/[postId]/assets/route";
import {
  renderSyncDocumentFile,
  renderSyncFile,
} from "@/app/api/sync/v1/sync";
import type { Blog, Post } from "@/lib/content";
import { documentFromLegacyPost } from "@/lib/documents/legacy";

const postId = "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60";
const blobHost = "store.public.blob.vercel-storage.com";
const blog: Blog = {
  handle: "demo",
  name: "Demo",
  author: "Demo Author",
  cardStyle: "cover",
  homeLayout: "timeline",
};
const legacyBasePost: Post = {
  id: postId,
  type: "article",
  slug: "generic-assets",
  title: "Generic assets",
  body: "Body",
  status: "draft",
  revision: 17,
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-14T10:00:00.000Z",
};
const basePost: Post = {
  ...legacyBasePost,
  document: documentFromLegacyPost(legacyBasePost),
};

const savedBlobToken = process.env.BLOB_READ_WRITE_TOKEN;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
  mocks.resolveSyncWorkspace.mockResolvedValue({ blog, userId: "user-1" });
  mocks.resolveItemAccess.mockResolvedValue({
    canView: true,
    canEditContent: true,
  });
  mocks.getPostById.mockResolvedValue(basePost);
  mocks.recordAction.mockResolvedValue(undefined);
});

afterAll(() => {
  if (savedBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = savedBlobToken;
});

describe("sync file artifact GET", () => {
  it.each(["article", "project", "talk", "note", "bookmark"] as const)(
    "serves inline assets for %s items",
    async (type) => {
      const assetURL =
        `https://${blobHost}/documents/demo/${postId}/assets/${type}.png`;
      mocks.getPostById.mockResolvedValue({
        ...basePost,
        type,
        body: `![asset](${assetURL})`,
      });

      const response = await GET(
        new Request(`https://texttext.example/api/sync/v1/files/${postId}/artifacts`),
        { params: Promise.resolve({ postId }) },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.artifacts).toEqual([
        expect.objectContaining({
          filename: `${type}.png`,
          role: "asset",
          url: assetURL,
        }),
      ]);
    },
  );

  it("lists safe inline assets for every item type and omits screenshots", async () => {
    const capturedInline =
      `https://${blobHost}/captures/demo/${postId}/generations/g1/assets/Photo.PNG`;
    const documentInline =
      `https://${blobHost}/documents/demo/${postId}/assets/photo.png`;
    const legacyInline =
      `https://${blobHost}/editor/media/demo/2026-07-14/photo.png`;
    const captureOnly =
      `https://${blobHost}/captures/demo/${postId}/generations/g1/assets/capture.webp`;
    const screenshot =
      `https://${blobHost}/captures/demo/${postId}/generations/g1/screenshot.png`;
    const screenshotTile =
      `https://${blobHost}/captures/demo/${postId}/generations/g1/screenshot-001.png`;
    const post: Post = {
      ...basePost,
      body: [
        `![capture](${capturedInline})`,
        `![document](${documentInline})`,
        `![legacy](${legacyInline})`,
        `![screenshot](${screenshot})`,
        `![foreign post](https://${blobHost}/documents/demo/11111111-1111-1111-1111-111111111111/assets/no.png)`,
        `![foreign handle](https://${blobHost}/editor/media/other/no.png)`,
        `![unowned](https://${blobHost}/misc/demo/${postId}/no.png)`,
        "![remote](https://images.example/not-write-hosted.png)",
      ].join("\n\n"),
      capture: {
        url: "https://example.com/article",
        screenshotUrl: screenshot,
        screenshotTiles: [{ index: 0, url: screenshotTile }],
        assets: [
          {
            url: capturedInline,
            originalUrl: "https://images.example/photo.png",
            filename: "Photo.PNG",
            contentType: "image/png",
          },
          {
            url: captureOnly,
            originalUrl: "https://images.example/hero.jpg",
            filename: "../../H\u00e9ro Shot.JPG",
            contentType: "image/webp",
          },
          {
            url: screenshotTile,
            originalUrl: "https://images.example/not-inline.png",
            filename: "not-inline.png",
            contentType: "image/png",
          },
        ],
      },
    };
    mocks.getPostById.mockResolvedValue(post);

    const response = await GET(
      new Request(`https://texttext.example/api/sync/v1/files/${postId}/artifacts`),
      { params: Promise.resolve({ postId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      postId,
      slug: post.slug,
      fileHash: renderSyncFile(blog, post).hash,
      documentHash: renderSyncDocumentFile(blog, post).hash,
      artifacts: [
        {
          filename: "photo.png",
          role: "asset",
          url: capturedInline,
          originalURL: "https://images.example/photo.png",
          contentType: "image/png",
        },
        {
          filename: "photo-2.png",
          role: "asset",
          url: documentInline,
          contentType: "image/png",
        },
        {
          filename: "photo-3.png",
          role: "asset",
          url: legacyInline,
          contentType: "image/png",
        },
        {
          filename: "hero-shot.webp",
          role: "asset",
          url: captureOnly,
          originalURL: "https://images.example/hero.jpg",
          contentType: "image/webp",
        },
      ],
    });
  });

  it("hides an item from callers without view access", async () => {
    mocks.resolveItemAccess.mockResolvedValue({ canView: false });
    const response = await GET(
      new Request(`https://texttext.example/api/sync/v1/files/${postId}/artifacts`),
      { params: Promise.resolve({ postId }) },
    );

    expect(response.status).toBe(404);
  });
});

describe("sync file asset POST", () => {
  it("uploads an immutable sanitized asset before auditing without editing the post", async () => {
    const post = { ...basePost, body: "Unchanged body", revision: 23 };
    const snapshot = structuredClone(post);
    mocks.getPostById.mockResolvedValue(post);
    const blobURL =
      `https://${blobHost}/documents/demo/${postId}/assets/resume-final-a1B2.png`;
    mocks.put.mockResolvedValue({
      url: blobURL,
      downloadUrl: `${blobURL}?download=1`,
      pathname:
        `documents/demo/${postId}/assets/resume-final-a1B2.png`,
      contentType: "image/png",
      contentDisposition: "inline",
      etag: "blob-etag",
    });
    const form = new FormData();
    form.append(
      "file",
      new File([new Uint8Array([1, 2, 3, 4])], "../../R\u00e9sum\u00e9 FINAL.JPEG", {
        type: "image/png",
      }),
    );

    const response = await POST(
      new Request(`https://texttext.example/api/sync/v1/files/${postId}/assets`, {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ postId }) },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      artifact: {
        filename: "resume-final-a1b2.png",
        role: "asset",
        url: blobURL,
        contentType: "image/png",
      },
    });
    expect(mocks.put).toHaveBeenCalledWith(
      `documents/demo/${postId}/assets/resume-final.png`,
      expect.objectContaining({ name: "../../R\u00e9sum\u00e9 FINAL.JPEG", size: 4 }),
      {
        access: "public",
        addRandomSuffix: true,
        allowOverwrite: false,
        contentType: "image/png",
        token: "blob-token",
      },
    );
    expect(mocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-1",
        actorType: "external_agent",
        actionName: "sync.upload_asset",
        targetType: "item",
        targetId: postId,
      }),
    );
    expect(mocks.put.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordAction.mock.invocationCallOrder[0],
    );
    expect(post).toEqual(snapshot);
  });

  it("requires edit access before reading or uploading the multipart body", async () => {
    mocks.resolveItemAccess.mockResolvedValue({
      canView: true,
      canEditContent: false,
    });
    const form = new FormData();
    form.append("file", new File(["image"], "photo.png", { type: "image/png" }));

    const response = await POST(
      new Request(`https://texttext.example/api/sync/v1/files/${postId}/assets`, {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ postId }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });

  it("accepts video assets and normalizes their extension", async () => {
    const blobURL =
      `https://${blobHost}/documents/demo/${postId}/assets/demo-video-r4nd0m.mp4`;
    mocks.put.mockResolvedValue({
      url: blobURL,
      downloadUrl: `${blobURL}?download=1`,
      pathname: `documents/demo/${postId}/assets/demo-video-r4nd0m.mp4`,
      contentType: "video/mp4",
      contentDisposition: "inline",
      etag: "video-etag",
    });
    const form = new FormData();
    form.append(
      "file",
      new File(["video"], "Demo Video.MOV", { type: "video/mp4" }),
    );

    const response = await POST(
      new Request(`https://texttext.example/api/sync/v1/files/${postId}/assets`, {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ postId }) },
    );

    expect(response.status).toBe(201);
    expect(mocks.put).toHaveBeenCalledWith(
      `documents/demo/${postId}/assets/demo-video.mp4`,
      expect.objectContaining({ type: "video/mp4" }),
      expect.objectContaining({ contentType: "video/mp4" }),
    );
    expect(await response.json()).toEqual({
      artifact: {
        filename: "demo-video-r4nd0m.mp4",
        role: "asset",
        url: blobURL,
        contentType: "video/mp4",
      },
    });
  });

  it("rejects non-media and multiple-file uploads", async () => {
    const textForm = new FormData();
    textForm.append("file", new File(["plain"], "note.txt", { type: "text/plain" }));
    const textResponse = await POST(
      new Request(`https://texttext.example/api/sync/v1/files/${postId}/assets`, {
        method: "POST",
        body: textForm,
      }),
      { params: Promise.resolve({ postId }) },
    );
    expect(textResponse.status).toBe(415);

    const multipleForm = new FormData();
    multipleForm.append("file", new File(["one"], "one.png", { type: "image/png" }));
    multipleForm.append("extra", new File(["two"], "two.mp4", { type: "video/mp4" }));
    const multipleResponse = await POST(
      new Request(`https://texttext.example/api/sync/v1/files/${postId}/assets`, {
        method: "POST",
        body: multipleForm,
      }),
      { params: Promise.resolve({ postId }) },
    );
    expect(multipleResponse.status).toBe(400);
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("rejects a declared request larger than the 50 MB upload allowance", async () => {
    const form = new FormData();
    form.append("file", new File(["small"], "photo.png", { type: "image/png" }));
    const response = await POST(
      new Request(`https://texttext.example/api/sync/v1/files/${postId}/assets`, {
        method: "POST",
        body: form,
        headers: { "Content-Length": String(52 * 1024 * 1024) },
      }),
      { params: Promise.resolve({ postId }) },
    );

    expect(response.status).toBe(413);
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
