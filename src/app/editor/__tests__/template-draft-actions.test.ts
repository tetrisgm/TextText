import { beforeEach, describe, expect, it, vi } from "vitest";
import { templateExample } from "@/app/templates/shared";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { GENERATED_BUILTIN_PRESETS } from "@/lib/presentation/generated-builtin-presets";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  resolveOwnedWorkspace: vi.fn(),
  getFolderByPath: vi.fn(),
  getFolders: vi.fn(),
  getBlogEditAccess: vi.fn(),
  getOwnerPlan: vi.fn(),
  countPersonalPosts: vi.fn(),
  createDraftInFolder: vi.fn(),
  savePost: vi.fn(),
  getBlog: vi.fn(),
  recordAction: vi.fn(),
  revalidateBlogPaths: vi.fn(),
}));

vi.mock("@/auth", () => ({ isAuthConfigured: true }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/workspace", async (original) => ({
  ...(await original<typeof import("@/lib/workspace")>()),
  resolveOwnedWorkspace: mocks.resolveOwnedWorkspace,
}));
vi.mock("@/lib/store", async (original) => ({
  ...(await original<typeof import("@/lib/store")>()),
  getFolderByPath: mocks.getFolderByPath,
  getFolders: mocks.getFolders,
  getOwnerPlan: mocks.getOwnerPlan,
  countPersonalPosts: mocks.countPersonalPosts,
  createDraftInFolder: mocks.createDraftInFolder,
  savePost: mocks.savePost,
  getBlog: mocks.getBlog,
}));
vi.mock("@/lib/blog-edit-auth", () => ({ getBlogEditAccess: mocks.getBlogEditAccess }));
vi.mock("@/lib/audit", () => ({ recordAction: mocks.recordAction, recordSlugChanged: vi.fn() }));
vi.mock("@/lib/revalidate-blog", () => ({ revalidateBlogPaths: mocks.revalidateBlogPaths }));

import { createTemplateDraftPath } from "../actions";

const folders = [
  { id: "blog-id", path: "blog", mode: "blog" },
  { id: "notes-id", path: "notes", mode: "notes" },
  { id: "bookmarks-id", path: "bookmarks", mode: "bookmarks" },
];

describe("built-in example draft creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ sub: "owner" });
    mocks.resolveOwnedWorkspace.mockResolvedValue({ handle: "writer" });
    mocks.getFolderByPath.mockImplementation(async (_handle: string, path: string) =>
      folders.find((folder) => folder.path === path) ?? null);
    mocks.getFolders.mockResolvedValue(folders);
    mocks.getBlogEditAccess.mockResolvedValue({
      canEdit: true, isOwner: true, ownerId: "owner-id", blogId: "workspace-id",
    });
    mocks.getOwnerPlan.mockResolvedValue("free");
    mocks.countPersonalPosts.mockResolvedValue(0);
    mocks.getBlog.mockResolvedValue({ handle: "writer" });
    mocks.createDraftInFolder.mockImplementation(async (
      _handle: string,
      folderId: string,
      options: { initial: { type: string; slug?: string }; document: { content: { title: string } } },
    ) => ({
      id: "draft-id", folderId, type: options.initial.type,
      slug: "example-draft", title: options.document.content.title,
    }));
  });

  it.each([
    ["article", "article", "blog"],
    ["note", "note", "notes"],
    ["bookmark", "bookmark", "bookmarks"],
    ["gallery", "media_post", "blog"],
    ["talk", "video_post", "blog"],
    ["todo", "article", "blog"],
  ])("creates the %s preview once as a %s in %s", async (slug, type, folderPath) => {
    const example = templateExample(slug)!;
    const generated = GENERATED_BUILTIN_PRESETS.find((preset) => preset.template.id === example.template.id)!;
    expect(example.document).toEqual(generated.document);

    const path = await createTemplateDraftPath(slug, true);

    expect(path).toBe(`/t/writer/${folderPath}/example-draft?edit=1&id=draft-id`);
    expect(mocks.createDraftInFolder).toHaveBeenCalledTimes(1);
    expect(mocks.createDraftInFolder).toHaveBeenCalledWith(
      "writer",
      folders.find((folder) => folder.path === folderPath)!.id,
      expect.objectContaining({
        template: example.document.presentation.template,
        document: example.document,
        initial: { type, slug: example.document.content.title },
        audit: expect.objectContaining({
          actorUserId: "owner-id", actorType: "human", actionName: "create_post",
          targetType: "item",
        }),
      }),
    );
    expect(mocks.savePost).not.toHaveBeenCalled();
    expect(mocks.recordAction).not.toHaveBeenCalled();
  });

  it.each(["timeline", "casestudy", "page", "project", "brief"])(
    "does not create a draft from the retired %s example",
    async (slug) => {
      expect(templateExample(slug)).toBeNull();
      await expect(createTemplateDraftPath(slug, true)).resolves.toBe("/templates");
      expect(mocks.createDraftInFolder).not.toHaveBeenCalled();
    },
  );

  it("keeps an unseeded draft blank while retaining its exact look and kind", async () => {
    const example = templateExample("gallery")!;

    await createTemplateDraftPath("gallery", false);

    expect(mocks.createDraftInFolder).toHaveBeenCalledWith(
      "writer", "blog-id", expect.objectContaining({
        template: example.document.presentation.template,
        document: emptyDocumentSnapshot(example.document.presentation.template),
        initial: { type: "media_post" },
      }),
    );
    expect(mocks.savePost).not.toHaveBeenCalled();
  });

  it("does not create a different item when the look or its folder is unavailable", async () => {
    expect(await createTemplateDraftPath("missing", true)).toBe("/templates");
    expect(mocks.createDraftInFolder).not.toHaveBeenCalled();

    mocks.getFolderByPath.mockResolvedValue(null);
    await expect(createTemplateDraftPath("note", true)).rejects.toThrow("notes folder is unavailable");
    expect(mocks.createDraftInFolder).not.toHaveBeenCalled();
  });
});
