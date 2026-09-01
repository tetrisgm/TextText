import type { Blog, Post } from "@/lib/content";
import { RESERVED_USERNAMES } from "@/lib/reserved-names";
import { rootDomainUrl } from "@/lib/site-url";

export { RESERVED_USERNAMES };

/** 3 to 30 chars: letters, numbers, hyphens; no leading or trailing hyphen. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

/** The seeded demo blog: reserved from claiming, but it must still resolve. */
const DEMO_USERNAME = "demo";

export function slugifyUsername(value: string, fallback = "writer"): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function cleanUsername(value: unknown): string {
  if (typeof value !== "string") throw new Error("Username must be text");
  const username = slugifyUsername(value, "");
  if (!username) throw new Error("Enter a username");
  if (!USERNAME_RE.test(username)) {
    throw new Error("Use 3 to 30 letters, numbers, or hyphens");
  }
  if (RESERVED_USERNAMES.has(username)) throw new Error("That username is reserved");
  return username;
}

export function usernameHomePath(username: string): string {
  return `/@${encodeURIComponent(username)}`;
}

export function usernamePostPath(username: string, slug: string): string {
  return `${usernameHomePath(username)}/${encodeURIComponent(slug)}`;
}

export function usernameTagPath(username: string, tag: string): string {
  return `${usernameHomePath(username)}/tags/${encodeURIComponent(tag)}`;
}

export function tenantHomePath(handle: string): string {
  return `/t/${encodeURIComponent(handle)}`;
}

export function tenantPostPath(handle: string, slug: string): string {
  return `${tenantHomePath(handle)}/${encodeURIComponent(slug)}`;
}

export function tenantPostEditPath(
  handle: string,
  post: Pick<Post, "id" | "slug">,
): string {
  const params = new URLSearchParams({ edit: "1" });
  if (post.id) params.set("id", post.id);
  return `${tenantPostPath(handle, post.slug)}?${params.toString()}`;
}

export function tenantWorkspacePostEditPath(
  handle: string,
  folderPath: string,
  post: Pick<Post, "id" | "slug">,
): string {
  const folder = publicFolderPath(folderPath);
  if (!folder) return tenantPostEditPath(handle, post);
  const params = new URLSearchParams({ edit: "1" });
  if (post.id) params.set("id", post.id);
  return `${tenantHomePath(handle)}/${folder}/${encodeURIComponent(post.slug)}?${params.toString()}`;
}

export function tenantTagPath(handle: string, tag: string): string {
  return `${tenantHomePath(handle)}/tags/${encodeURIComponent(tag)}`;
}

const PUBLIC_FOLDER_SEGMENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Stored folder paths are already URL-safe; reject drift instead of encoding it. */
export function publicFolderPath(folderPath: string): string | null {
  const segments = folderPath.split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => !PUBLIC_FOLDER_SEGMENT_RE.test(segment))
  ) {
    return null;
  }
  return segments.map(encodeURIComponent).join("/");
}

/** Folder-in-path location on a workspace's sessionless public origin. */
export function workspacePublicPostPath(
  folderPath: string,
  slug: string,
): string | null {
  const folder = publicFolderPath(folderPath);
  if (!folder || !slug) return null;
  return `/${folder}/${encodeURIComponent(slug)}`;
}

/** Absolute origin owned by the workspace namespace, never by a person. */
export function workspacePublicBaseUrl(handle: string): string {
  const url = rootDomainUrl();
  url.hostname = `${handle.toLowerCase()}.${url.hostname}`;
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

/** Reports always live on the private platform origin, not a tenant origin. */
export function platformReportUrl(path: string, postId?: string): string {
  const url = new URL("/report", rootDomainUrl());
  url.searchParams.set("path", path);
  if (postId) url.searchParams.set("doc", postId);
  return url.toString();
}

export function workspacePublicPostUrl(
  handle: string,
  folderPath: string,
  slug: string,
): string | null {
  const path = workspacePublicPostPath(folderPath, slug);
  return path ? `${workspacePublicBaseUrl(handle)}${path}` : null;
}

export function blogHomePath(blog: Pick<Blog, "handle" | "username">): string {
  return blog.username ? usernameHomePath(blog.username) : tenantHomePath(blog.handle);
}

export function blogPostPath(
  blog: Pick<Blog, "handle" | "username">,
  post: Pick<Post, "slug">,
): string {
  return blog.username
    ? usernamePostPath(blog.username, post.slug)
    : tenantPostPath(blog.handle, post.slug);
}

export function blogWorkspacePostPath(
  blog: Pick<Blog, "handle" | "username">,
  folderPath: string,
  post: Pick<Post, "slug">,
): string {
  const folder = publicFolderPath(folderPath);
  if (!folder) return blogPostPath(blog, post);
  return `${blogHomePath(blog)}/${folder}/${encodeURIComponent(post.slug)}`;
}

export function blogWorkspacePostEditPath(
  blog: Pick<Blog, "handle" | "username">,
  folderPath: string,
  post: Pick<Post, "id" | "slug">,
): string {
  return tenantWorkspacePostEditPath(blog.handle, folderPath, post);
}

export function blogTagPath(
  blog: Pick<Blog, "handle" | "username">,
  tag: string,
): string {
  return blog.username
    ? usernameTagPath(blog.username, tag)
    : tenantTagPath(blog.handle, tag);
}

export function blogPostEditPath(
  blog: Pick<Blog, "handle" | "username">,
  post: Pick<Post, "id" | "slug">,
): string {
  // Editing is an authenticated workspace operation. A person's /@username
  // route is a sessionless publication surface, so sending a draft there can
  // only produce a 404. Keep public reading on the username URL and always
  // enter the editor through the canonical tenant workspace route.
  return tenantPostEditPath(blog.handle, post);
}

export function usernameFromAtPath(pathname: string): {
  username: string;
  rest: string;
} | null {
  // Browsers and proxies may percent-encode the "@"; decode just that prefix
  // so the rest of the path (which may carry its own encoding) is untouched.
  const normalized = pathname.startsWith("/%40")
    ? `/@${pathname.slice("/%40".length)}`
    : pathname;
  if (!normalized.startsWith("/@")) return null;
  const withoutPrefix = normalized.slice(2);
  const [rawUsername = "", ...restParts] = withoutPrefix.split("/");
  const username = rawUsername.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) return null;
  if (username !== DEMO_USERNAME && RESERVED_USERNAMES.has(username)) return null;
  return {
    username,
    rest: restParts.length > 0 ? `/${restParts.join("/")}` : "",
  };
}
