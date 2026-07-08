// The signed-in user's workspace, resolved the same way everywhere a session
// first touches content: an owned blog wins; otherwise the browser's
// unclaimed guest workspace is CLAIMED (signing in must never strand it);
// only when neither exists is a starter blog provisioned.

import {
  deleteAnonymousEditCookie,
  getActiveGuestBlogFromCookie,
} from "./blog-edit-auth";
import { recordAction } from "./audit";
import type { Blog, Folder, Post } from "./content";
import { revalidateBlogPaths } from "./revalidate-blog";
import type { CurrentUser } from "./session";
import {
  claimBlogForUser,
  createSubfolder,
  ensureOwnerBlog,
  folderPathForPostType,
  getAllPostFiles,
  getFolders,
  getOwnedBlog,
  savePost,
  setPostFolder,
} from "./store";

const SYSTEM_FOLDER_PATHS = new Set(["blog", "notes", "bookmarks"]);

type GuestWorkspaceCookie = {
  id: string;
  handle: string;
};

function parentFolderPath(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join("/");
}

function folderDepth(folder: Folder): number {
  return folder.path.split("/").filter(Boolean).length;
}

function uniqueImportedSlug(slug: string, usedSlugs: Set<string>): string {
  const clean = slug.trim() || "imported-draft";
  if (!usedSlugs.has(clean)) return clean;
  const base = clean.replace(/-from-demo(?:-\d+)?$/, "") || "imported-draft";
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const candidate =
      attempt === 1 ? `${base}-from-demo` : `${base}-from-demo-${attempt}`;
    if (!usedSlugs.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function clonePostForImport(post: Post, slug: string): Post {
  const {
    id: _id,
    folderId: _folderId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...rest
  } = post;
  return { ...rest, slug };
}

function errorSummary(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

async function recordClaimFailure(
  user: CurrentUser,
  guest: GuestWorkspaceCookie,
  error: unknown,
): Promise<void> {
  await recordAction({
    actorUserId: user.userId ?? null,
    actorType: "human",
    actionName: "claim_workspace_failed",
    targetType: "workspace",
    targetId: guest.id,
    inputSummary: guest.handle,
    outputSummary: errorSummary(error),
  });
}

async function importGuestWorkspaceIntoOwned(
  guest: GuestWorkspaceCookie,
  destination: Blog,
): Promise<{ folders: number; posts: number }> {
  const [sourceFolders, destinationFolders, sourcePosts, destinationPosts] =
    await Promise.all([
      getFolders(guest.handle),
      getFolders(destination.handle),
      getAllPostFiles(guest.handle),
      getAllPostFiles(destination.handle),
    ]);

  const destinationPaths = new Set(destinationFolders.map((folder) => folder.path));
  const destinationPathBySourcePath = new Map<string, string>();
  const destinationPathBySourceFolderId = new Map<string, string>();
  for (const folder of sourceFolders) {
    if (SYSTEM_FOLDER_PATHS.has(folder.path)) {
      destinationPathBySourcePath.set(folder.path, folder.path);
      destinationPathBySourceFolderId.set(folder.id, folder.path);
    }
  }

  let foldersImported = 0;
  const importableFolders = sourceFolders
    .filter((folder) => !SYSTEM_FOLDER_PATHS.has(folder.path))
    .sort((a, b) => folderDepth(a) - folderDepth(b));

  for (const folder of importableFolders) {
    if (destinationPaths.has(folder.path)) {
      destinationPathBySourcePath.set(folder.path, folder.path);
      destinationPathBySourceFolderId.set(folder.id, folder.path);
      continue;
    }

    const sourceParentPath = parentFolderPath(folder.path);
    if (!sourceParentPath) continue;
    const destinationParentPath =
      destinationPathBySourcePath.get(sourceParentPath) ?? sourceParentPath;
    const created = await createSubfolder(
      destination.handle,
      destinationParentPath,
      folder.name,
    );
    foldersImported += 1;
    destinationPaths.add(created.path);
    destinationPathBySourcePath.set(folder.path, created.path);
    destinationPathBySourceFolderId.set(folder.id, created.path);
  }

  let postsImported = 0;
  const usedSlugs = new Set(destinationPosts.map((post) => post.slug));
  for (const post of sourcePosts) {
    const slug = uniqueImportedSlug(post.slug, usedSlugs);
    usedSlugs.add(slug);
    const imported = clonePostForImport(post, slug);
    const saved = await savePost(destination.handle, imported);
    postsImported += 1;

    const sourceFolderPath = post.folderId
      ? destinationPathBySourceFolderId.get(post.folderId)
      : undefined;
    const defaultFolderPath = folderPathForPostType(saved.type);
    if (saved.id && sourceFolderPath && sourceFolderPath !== defaultFolderPath) {
      await setPostFolder(destination.handle, saved.id, sourceFolderPath);
    }
  }

  return { folders: foldersImported, posts: postsImported };
}

async function importGuestForExistingOwner(
  user: CurrentUser,
  guest: GuestWorkspaceCookie,
): Promise<Blog> {
  const destination = await ensureOwnerBlog(user);
  try {
    const result = await importGuestWorkspaceIntoOwned(guest, destination);
    await deleteAnonymousEditCookie(guest.id);
    await recordAction({
      actorUserId: user.userId ?? null,
      actorType: "human",
      actionName: "import_guest_workspace",
      targetType: "workspace",
      targetId: guest.id,
      inputSummary: `${guest.handle} -> ${destination.handle}`,
      outputSummary: `${result.posts} posts, ${result.folders} folders`,
    });
    revalidateBlogPaths(destination);
  } catch (error) {
    await recordAction({
      actorUserId: user.userId ?? null,
      actorType: "human",
      actionName: "import_guest_workspace_failed",
      targetType: "workspace",
      targetId: guest.id,
      inputSummary: `${guest.handle} -> ${destination.handle}`,
      outputSummary: errorSummary(error),
    });
  }
  return destination;
}

export async function resolveOwnedWorkspace(user: CurrentUser): Promise<Blog> {
  const guest = await getActiveGuestBlogFromCookie();
  if (guest) {
    const owned = await getOwnedBlog(user.sub);
    if (owned) return importGuestForExistingOwner(user, guest);

    try {
      const claimed = await claimBlogForUser(guest.handle, user);
      await deleteAnonymousEditCookie(guest.id);
      await recordAction({
        actorUserId: user.userId ?? null,
        actorType: "human",
        actionName: "claim_workspace",
        targetType: "workspace",
        targetId: guest.id,
        inputSummary: claimed.handle,
      });
      revalidateBlogPaths(claimed);
      return claimed;
    } catch (error) {
      await recordClaimFailure(user, guest, error);
      const settledOwned = await getOwnedBlog(user.sub);
      if (settledOwned) return importGuestForExistingOwner(user, guest);
      // A concurrent claim or a race settles below; never block sign-in.
    }
  }

  return ensureOwnerBlog(user);
}
