import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Blog, FileRepresentation, Post } from "@/lib/content";
import {
  serializeSyncDocumentEnvelope,
  SYNC_DOCUMENT_CONTENT_TYPE,
  SYNC_DOCUMENT_SCHEMA,
} from "@/lib/documents/sync";
import { authoringSourceFor } from "@/lib/presentation/authoring-source";
import { compileItemTypeBlueprint, itemTypeBlueprintSchema } from "@/lib/presentation/item-type-blueprint";
import { renderSyncDocumentFile } from "@/app/api/sync/v1/sync";

const mocks = vi.hoisted(() => ({
  claimIdempotencyKey: vi.fn(),
  createDraft: vi.fn(),
  createDraftInFolder: vi.fn(),
  deletePost: vi.fn(),
  getPostById: vi.fn(),
  getFolderById: vi.fn(),
  getDocumentTemplateForHandle: vi.fn(),
  getDocumentTemplateAuthoringSourcesForHandle: vi.fn(),
  installDocumentTemplate: vi.fn(async () => "installed"),
  markCapturePending: vi.fn(),
  releaseIdempotencyKey: vi.fn(),
  resolveIdempotencyKey: vi.fn(),
  savePost: vi.fn(),
  resolveWorkspaceAccess: vi.fn(),
  resolveSyncWorkspace: vi.fn(),
  recordAction: vi.fn(),
  revalidateBlogPaths: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  claimIdempotencyKey: mocks.claimIdempotencyKey,
  createDraft: mocks.createDraft,
  createDraftInFolder: mocks.createDraftInFolder,
  deletePost: mocks.deletePost,
  getPostById: mocks.getPostById,
  getFolderById: mocks.getFolderById,
  getDocumentTemplateForHandle: mocks.getDocumentTemplateForHandle,
  getDocumentTemplateAuthoringSourcesForHandle: mocks.getDocumentTemplateAuthoringSourcesForHandle,
  installDocumentTemplate: mocks.installDocumentTemplate,
  markCapturePending: mocks.markCapturePending,
  releaseIdempotencyKey: mocks.releaseIdempotencyKey,
  resolveIdempotencyKey: mocks.resolveIdempotencyKey,
  savePost: mocks.savePost,
}));

vi.mock("@/lib/permissions", () => ({
  resolveWorkspaceAccess: mocks.resolveWorkspaceAccess,
}));

vi.mock("@/app/api/sync/v1/auth", () => ({
  resolveSyncWorkspace: mocks.resolveSyncWorkspace,
}));

vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction }));
vi.mock("@/lib/revalidate-blog", () => ({
  revalidateBlogPaths: mocks.revalidateBlogPaths,
}));

import { MAX_SYNC_FILE_BODY_BYTES, POST } from "@/app/api/sync/v1/files/route";

const blog: Blog = {
  handle: "sync-test",
  name: "Sync test",
  author: "Owner",
  homeLayout: "grid",
};

function draft(
  representation: FileRepresentation,
  type: Post["type"] = "article",
): Post {
  return {
    id: "0b4f6a52-8c1d-4e3a-9b7f-2d5e8a1c3f60",
    representation,
    type,
    slug: "untitled-sync",
    title: "",
    body: "",
    status: "draft",
    revision: 1,
  };
}

function createRequest(representation?: string, folderId?: string): Request {
  const headers = new Headers({ "Content-Type": "text/markdown" });
  if (representation !== undefined) {
    headers.set("TextText-File-Representation", representation);
  }
  const suffix = folderId ? `?folder=${folderId}` : "";
  return new Request(`https://texttext.example/api/sync/v1/files${suffix}`, {
    method: "POST",
    headers,
    body: "---\ntitle: Imported\n---\n\nBody\n",
  });
}

function createStructuredRequest(folderId = "notes-folder"): Request {
  const document = {
    schemaVersion: 1 as const,
    content: {
      title: "Structured title",
      body: "Structured body",
      fields: {},
      tags: [],
      assets: [],
    },
    presentation: {
      template: { id: "texttext.gallery", version: 1 },
      theme: { accent: "#0066cc" as const },
    },
  };
  return new Request(
    `https://texttext.example/api/sync/v1/files?folder=${folderId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": SYNC_DOCUMENT_CONTENT_TYPE,
        "TextText-File-Representation": "textpack",
      },
      body: serializeSyncDocumentEnvelope({
        schema: SYNC_DOCUMENT_SCHEMA,
        markdown: "---\ntitle: Markdown title\n---\n\nMarkdown body\n",
        document,
      }),
    },
  );
}

function streamedCreateRequest(byteCount: number): Request {
  let remaining = byteCount;
  return new Request("https://texttext.example/api/sync/v1/files", {
    method: "POST",
    headers: { "Content-Type": "text/markdown" },
    body: new ReadableStream({
      pull(controller) {
        if (remaining === 0) {
          controller.close();
          return;
        }
        const size = Math.min(remaining, 64 * 1024);
        remaining -= size;
        controller.enqueue(new Uint8Array(size).fill(32));
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("sync file POST representation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.releaseIdempotencyKey.mockResolvedValue(undefined);
    mocks.resolveSyncWorkspace.mockResolvedValue({
      blog,
      userId: "owner-id",
    });
    mocks.resolveWorkspaceAccess.mockResolvedValue({ isOwner: true, blogId: "blog-1" });
    mocks.getFolderById.mockResolvedValue({ id: "notes-folder", name: "Notes", path: "notes", mode: "notes", position: 0 });
    mocks.getDocumentTemplateForHandle.mockResolvedValue(null);
    mocks.getDocumentTemplateAuthoringSourcesForHandle.mockResolvedValue(new Map());
    mocks.createDraft.mockImplementation(
      (
        _handle: string,
        type: Post["type"],
        options: { representation: FileRepresentation },
      ) => Promise.resolve(draft(options.representation, type)),
    );
    mocks.createDraftInFolder.mockImplementation(
      (
        _handle: string,
        _folderId: string,
        options: { representation: FileRepresentation },
      ) => Promise.resolve({ ...draft(options.representation, "note"), folderId: _folderId }),
    );
    mocks.savePost.mockImplementation((_handle: string, post: Post) =>
      Promise.resolve({ ...post, revision: 2 }),
    );
  });

  it("keeps a headerless legacy create as markdown", async () => {
    const response = await POST(createRequest());

    expect(response.status).toBe(201);
    expect(mocks.createDraft).toHaveBeenCalledWith("sync-test", "article", {
      representation: "markdown",
    });
    await expect(response.json()).resolves.toMatchObject({
      item: {
        file: "posts/imported.md",
        representation: "markdown",
      },
    });
  });

  it("persists an explicit representation for folder-scoped creates", async () => {
    const response = await POST(createRequest("text", "notes-folder"));

    expect(response.status).toBe(201);
    expect(mocks.createDraftInFolder).toHaveBeenCalledWith(
      "sync-test",
      "notes-folder",
      { representation: "text" },
    );
    await expect(response.json()).resolves.toMatchObject({
      item: {
        file: "posts/imported.txt",
        kind: "note",
        representation: "text",
      },
    });
  });

  it("creates a canonical document from a structured textpack", async () => {
    const response = await POST(createStructuredRequest());

    expect(response.status).toBe(201);
    expect(mocks.createDraftInFolder).toHaveBeenCalledWith(
      "sync-test",
      "notes-folder",
      { representation: "textpack" },
    );
    expect(mocks.savePost).toHaveBeenCalledWith(
      "sync-test",
      expect.objectContaining({
        title: "Markdown title",
        body: "Markdown body\n",
        document: expect.objectContaining({
          content: expect.objectContaining({
            title: "Markdown title",
            body: "Markdown body\n",
          }),
          presentation: {
            template: { id: "texttext.gallery", version: 1 },
            theme: { accent: "#0066cc" },
          },
        }),
      }),
    );
  });

  it("installs the editable look carried by a new TextPack item", async () => {
    const blueprint = itemTypeBlueprintSchema.parse({ name: "Research note", fields: [{ id: "source", label: "Source", type: "url" }], collection: { layout: "list" } });
    const template = compileItemTypeBlueprint(blueprint, { id: "custom.research-note" });
    const source = authoringSourceFor(blueprint);
    mocks.getDocumentTemplateForHandle.mockResolvedValue(template);
    mocks.getDocumentTemplateAuthoringSourcesForHandle.mockResolvedValue(new Map([[`${template.id}@${template.version}`, source]]));
    const request = new Request("https://texttext.example/api/sync/v1/files?folder=notes-folder", {
      method: "POST",
      headers: { "Content-Type": SYNC_DOCUMENT_CONTENT_TYPE, "TextText-File-Representation": "textpack" },
      body: serializeSyncDocumentEnvelope({
        schema: SYNC_DOCUMENT_SCHEMA,
        markdown: "# New research note\n",
        document: {
          schemaVersion: 1,
          content: { title: "New research note", body: "", fields: {}, tags: [], assets: [] },
          presentation: { template: { id: template.id, version: template.version }, theme: {} },
        },
        template,
        templateAuthoringSource: source,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    expect(mocks.installDocumentTemplate).toHaveBeenCalledWith({
      blogId: "blog-1", definition: template, authoringSource: source,
    });
    const saved = await mocks.savePost.mock.results[0].value as Post;
    const result = await response.json();
    expect(result.item.documentHash).toBe(renderSyncDocumentFile(blog, saved, "notes", template, source).hash);
  });

  it("keeps the item but does not install an unrelated carried look", async () => {
    const blueprint = itemTypeBlueprintSchema.parse({ name: "Unrelated", fields: [], collection: { layout: "list" } });
    const template = compileItemTypeBlueprint(blueprint, { id: "custom.unrelated" });
    const response = await POST(new Request("https://texttext.example/api/sync/v1/files?folder=notes-folder", {
      method: "POST",
      headers: { "Content-Type": SYNC_DOCUMENT_CONTENT_TYPE, "TextText-File-Representation": "textpack" },
      body: serializeSyncDocumentEnvelope({
        schema: SYNC_DOCUMENT_SCHEMA,
        markdown: "# Kept\n",
        document: {
          schemaVersion: 1,
          content: { title: "Kept", body: "", fields: {}, tags: [], assets: [] },
          presentation: { template: { id: "texttext.note", version: 1 }, theme: {} },
        },
        template,
        templateAuthoringSource: authoringSourceFor(blueprint),
      }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.installDocumentTemplate).not.toHaveBeenCalled();
    expect(mocks.savePost).toHaveBeenCalled();
  });

  it("rejects an invalid representation before creating a placeholder", async () => {
    const response = await POST(createRequest("pdf"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "TextText-File-Representation must be textbundle, textpack, markdown, or text",
    });
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.createDraftInFolder).not.toHaveBeenCalled();
    expect(mocks.savePost).not.toHaveBeenCalled();
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });

  it("releases a claimed idempotency key when placeholder creation fails", async () => {
    mocks.claimIdempotencyKey.mockResolvedValue({ status: "claimed" });
    mocks.createDraftInFolder.mockRejectedValue(new Error("Folder not found"));
    const request = createRequest("textpack", "missing-folder");
    request.headers.set("Idempotency-Key", "create-123");

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mocks.releaseIdempotencyKey).toHaveBeenCalledWith(
      blog.handle,
      "create-123",
    );
    expect(mocks.savePost).not.toHaveBeenCalled();
  });

  it("rejects a declared oversized file before creating a placeholder", async () => {
    const request = createRequest();
    request.headers.set("Content-Length", String(MAX_SYNC_FILE_BODY_BYTES + 1));

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });

  it("rejects a chunked oversized file without Content-Length", async () => {
    const response = await POST(
      streamedCreateRequest(MAX_SYNC_FILE_BODY_BYTES + 1),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });
});
