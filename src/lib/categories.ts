import type { Blog, Folder, Post } from "@/lib/content";
import {
  getFolderPosts,
  getFolders,
  getPublicPostLocations,
} from "@/lib/store";
import {
  blogHomePath,
  tenantHomePath,
  usernameHomePath,
} from "@/lib/public-paths";

export type CategoryChip = {
  href: string;
  label: string;
};

export type CategoryBreadcrumb = {
  href: string | null;
  label: string;
};

export type ResolvedCategory = {
  folder: Folder;
  folders: Folder[];
  posts: Post[];
};

const BLOG_ROOT_PATH = "blog";
const BLOG_CATEGORY_PREFIX = `${BLOG_ROOT_PATH}/`;

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function categoryPathInput(
  path: Folder | string | readonly string[],
): string | null {
  if (typeof path === "string") {
    return path.startsWith(BLOG_CATEGORY_PREFIX)
      ? categoryPathFromFolderPath(path)
      : path;
  }
  if ("path" in path) return categoryPathFromFolderPath(path.path);
  return path.length > 0 ? path.join("/") : null;
}

// A category path segment must look exactly like a stored folder slug
// (lowercase alphanumeric words joined by single hyphens, as produced by the
// store's folderPathSegment). Anything else, "..", empty, encoded junk,
// uppercase, dots, slashes, yields null so the route calls notFound() rather
// than constructing a traversal-shaped path or a bad redirect target.
const CATEGORY_SEGMENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function categorySegmentsToFolderPath(
  path: readonly string[],
): string | null {
  if (path.length === 0) return null;
  const clean = path.map((segment) => segment.trim());
  if (clean.some((segment) => !CATEGORY_SEGMENT_RE.test(segment))) return null;
  return `${BLOG_ROOT_PATH}/${clean.join("/")}`;
}

export function categoryPathFromFolderPath(folderPath: string): string | null {
  if (!folderPath.startsWith(BLOG_CATEGORY_PREFIX)) return null;
  const categoryPath = folderPath.slice(BLOG_CATEGORY_PREFIX.length);
  if (!categoryPath || categoryPath.split("/").some((segment) => !segment)) {
    return null;
  }
  return categoryPath;
}

export function usernameCategoryPath(
  username: string,
  path: Folder | string | readonly string[],
): string {
  const categoryPath = categoryPathInput(path);
  if (!categoryPath) return usernameHomePath(username);
  return `${usernameHomePath(username)}/c/${encodePath(categoryPath)}`;
}

export function blogCategoryPath(
  blog: Pick<Blog, "handle" | "username">,
  path: Folder | string | readonly string[],
): string {
  const categoryPath = categoryPathInput(path);
  if (!categoryPath) return blogHomePath(blog);
  return `${blogHomePath(blog)}/c/${encodePath(categoryPath)}`;
}

export function workspaceCategoryPath(
  path: Folder | string | readonly string[],
): string {
  const categoryPath = categoryPathInput(path);
  return categoryPath ? `/c/${encodePath(categoryPath)}` : "/";
}

export async function resolveCategory(
  handle: string,
  path: readonly string[],
  options: { publicOnly?: boolean } = {},
): Promise<ResolvedCategory | null> {
  const folderPath = categorySegmentsToFolderPath(path);
  if (!folderPath) return null;

  const folders = await getFolders(handle);
  const folder = folders.find((entry) => entry.path === folderPath) ?? null;
  if (!folder || folder.mode !== "blog") return null;
  if (!categoryPathFromFolderPath(folder.path)) return null;

  const posts = options.publicOnly
    ? (await getPublicPostLocations(handle))
        .filter((location) => location.folderPath === folder.path)
        .map((location) => location.post)
    : await getFolderPosts(handle, folder.path, { publishedOnly: true });
  if (options.publicOnly && posts.length === 0) return null;
  return { folder, folders, posts };
}

export function categoryBreadcrumbs(
  blog: Pick<Blog, "handle" | "name" | "username">,
  folder: Folder,
  folders: Folder[],
  options: { publicOrigin?: boolean } = {},
): CategoryBreadcrumb[] {
  const byPath = new Map(folders.map((entry) => [entry.path, entry]));
  const crumbs: CategoryBreadcrumb[] = [
    {
      href: options.publicOrigin ? "/" : blogHomePath(blog),
      label: blog.name.trim() || "Blog",
    },
  ];

  const parts = folder.path.split("/");
  let path = BLOG_ROOT_PATH;
  for (const part of parts.slice(1)) {
    path = `${path}/${part}`;
    const crumbFolder = byPath.get(path);
    if (!crumbFolder) continue;
    crumbs.push({
      href:
        crumbFolder.path === folder.path
          ? null
          : options.publicOrigin
            ? workspaceCategoryPath(crumbFolder)
            : blogCategoryPath(blog, crumbFolder),
      label: crumbFolder.name,
    });
  }

  return crumbs;
}

export function categoryChipForPost(
  blog: Pick<Blog, "handle" | "username">,
  post: Post,
  folders: Folder[],
  options: { publicOrigin?: boolean } = {},
): CategoryChip | null {
  if (post.status !== "published" || !post.folderId) return null;
  const folder = folders.find((entry) => entry.id === post.folderId) ?? null;
  if (!folder || folder.mode !== "blog") return null;
  if (!categoryPathFromFolderPath(folder.path)) return null;
  return {
    href: options.publicOrigin
      ? workspaceCategoryPath(folder)
      : blogCategoryPath(blog, folder),
    label: folder.name,
  };
}
