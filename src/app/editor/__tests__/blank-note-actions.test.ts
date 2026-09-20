import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBlogEditAccess: vi.fn(), createDraft: vi.fn(), savePost: vi.fn(),
  revalidateBlogPaths: vi.fn(), setPostFolder: vi.fn(), recordAction: vi.fn(), countAllPosts: vi.fn(),
}));
vi.mock("@/auth", () => ({ isAuthConfigured: true }));
vi.mock("@/lib/blog-edit-auth", () => ({ getBlogEditAccess: mocks.getBlogEditAccess }));
vi.mock("@/lib/store", async (original) => ({
  ...(await original<typeof import("@/lib/store")>()),
  createDraft: mocks.createDraft, savePost: mocks.savePost, setPostFolder: mocks.setPostFolder,
  countAllPosts: mocks.countAllPosts, getOwnerPlan: vi.fn(async () => "free"), getBlog: vi.fn(async () => ({ handle: "writer" })),
}));
vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction, recordSlugChanged: vi.fn() }));
vi.mock("@/lib/revalidate-blog", () => ({ revalidateBlogPaths: mocks.revalidateBlogPaths }));

import { createFolderItemAction, createWorkspacePostAction } from "../actions";
const draft = { id: "note-id", type: "note", title: "Untitled", slug: "untitled", body: "", status: "draft" };

describe("blank note creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBlogEditAccess.mockResolvedValue({ canEdit: true, isOwner: true, ownerId: "owner", blogId: "workspace" });
    mocks.countAllPosts.mockResolvedValue(0);
    mocks.createDraft.mockResolvedValue(draft);
    mocks.setPostFolder.mockResolvedValue(draft);
  });
  it("creates an empty note from New Note, places it, and audits once", async () => {
    expect(await createFolderItemAction("writer", "notes", { folderPath: "notes" })).toEqual(draft);
    expect(mocks.createDraft).toHaveBeenCalledTimes(1);
    expect(mocks.savePost).not.toHaveBeenCalled();
    expect(mocks.setPostFolder).toHaveBeenCalledWith("writer", "note-id", "notes");
    expect(mocks.recordAction).toHaveBeenCalledWith(expect.objectContaining({ actionName: "create_note", targetId: "note-id" }));
  });
  it("supports a blank item through the workspace command too", async () => {
    await createWorkspacePostAction("writer", "note", "notes");
    expect(mocks.createDraft).toHaveBeenCalledTimes(1);
  });
  it.each([null, 7, {}])("rejects malformed body %j before creating a draft", async (body) => {
    await expect(createFolderItemAction("writer", "notes", { body: body as string })).rejects.toThrow("Body must be text");
    await expect(createWorkspacePostAction("writer", "note", "notes", undefined, undefined, body)).rejects.toThrow("Body must be text");
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });
  it("lets the live editor own navigation after its optimistic draft becomes durable", async () => {
    await createFolderItemAction("writer", "notes", {}, { revalidate: false });
    expect(mocks.createDraft).toHaveBeenCalledTimes(1);
    expect(mocks.recordAction).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateBlogPaths).not.toHaveBeenCalled();
  });
  it("still refuses creation at the workspace limit", async () => {
    mocks.countAllPosts.mockResolvedValue(100000);
    await expect(createFolderItemAction("writer", "notes")).rejects.toThrow("item limit");
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });
});
