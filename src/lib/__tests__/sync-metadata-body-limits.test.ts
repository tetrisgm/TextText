import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SYNC_METADATA_BODY_BYTES } from "@/app/api/sync/v1/sync";

const mocks = vi.hoisted(() => ({
  claimIdempotencyKey: vi.fn(),
  createSubfolder: vi.fn(),
  getAccessibleFolders: vi.fn(),
  getFolderById: vi.fn(),
  releaseIdempotencyKey: vi.fn(),
  renameFolder: vi.fn(),
  resolveIdempotencyKey: vi.fn(),
  updateBlogByHandle: vi.fn(),
  resolveWorkspaceAccess: vi.fn(),
  resolveSyncWorkspace: vi.fn(),
  recordAction: vi.fn(),
  revalidateBlogPaths: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  claimIdempotencyKey: mocks.claimIdempotencyKey,
  createSubfolder: mocks.createSubfolder,
  getAccessibleFolders: mocks.getAccessibleFolders,
  getFolderById: mocks.getFolderById,
  releaseIdempotencyKey: mocks.releaseIdempotencyKey,
  renameFolder: mocks.renameFolder,
  resolveIdempotencyKey: mocks.resolveIdempotencyKey,
  updateBlogByHandle: mocks.updateBlogByHandle,
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

import { POST as createFolder } from "@/app/api/sync/v1/folders/route";
import { PATCH as renameFolder } from "@/app/api/sync/v1/folders/[folderId]/route";
import { PATCH as renameWorkspace } from "@/app/api/sync/v1/workspace/route";

const blog = {
  handle: "sync-test",
  name: "Sync test",
  author: "Owner",
  homeLayout: "grid" as const,
};

function oversizedRequest(url: string, method: "POST" | "PATCH"): Request {
  return new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(MAX_SYNC_METADATA_BODY_BYTES + 1),
    },
    body: "{}",
  });
}

function streamedRequest(url: string, method: "POST" | "PATCH"): Request {
  let remaining = MAX_SYNC_METADATA_BODY_BYTES + 1;
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream({
      pull(controller) {
        if (remaining === 0) {
          controller.close();
          return;
        }
        const size = Math.min(remaining, 8 * 1024);
        remaining -= size;
        controller.enqueue(new Uint8Array(size).fill(32));
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveSyncWorkspace.mockResolvedValue({ blog, userId: "owner-id" });
  mocks.resolveWorkspaceAccess.mockResolvedValue({ isOwner: true });
});

describe.each([
  {
    name: "folder create",
    call: (request: Request) => createFolder(request),
    url: "https://texttext.example/api/sync/v1/folders",
    method: "POST" as const,
  },
  {
    name: "folder rename",
    call: (request: Request) =>
      renameFolder(request, {
        params: Promise.resolve({ folderId: "folder-id" }),
      }),
    url: "https://texttext.example/api/sync/v1/folders/folder-id",
    method: "PATCH" as const,
  },
  {
    name: "workspace rename",
    call: (request: Request) => renameWorkspace(request),
    url: "https://texttext.example/api/sync/v1/workspace",
    method: "PATCH" as const,
  },
])("sync metadata body limit: $name", ({ call, url, method }) => {
  it("rejects declared and streamed oversized JSON without mutating", async () => {
    const declared = await call(oversizedRequest(url, method));
    const streamed = await call(streamedRequest(url, method));

    expect(declared.status).toBe(413);
    expect(streamed.status).toBe(413);
    expect(declared.headers.get("Cache-Control")).toBe("private, no-store");
    expect(streamed.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.createSubfolder).not.toHaveBeenCalled();
    expect(mocks.renameFolder).not.toHaveBeenCalled();
    expect(mocks.updateBlogByHandle).not.toHaveBeenCalled();
  });
});
