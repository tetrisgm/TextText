"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Blog, GalleryItem, Post, PostType } from "@/lib/content";
import { isAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/lib/session";
import type { BlogPatch } from "@/lib/store";
import {
  claimBlogForUser,
  createAnonymousBlogRecord,
  createDraft,
  deletePost,
  ensureOwnerBlog,
  getPostById,
  savePost,
  setPostPinned,
  updateBlogByHandle,
} from "@/lib/store";
import {
  deleteAnonymousEditCookie,
  friendlyAnonymousSeed,
  generateEditToken,
  getBlogEditAccess,
  hashEditToken,
  setAnonymousEditCookie,
} from "@/lib/blog-edit-auth";
import { TENANT_HANDLE_RE } from "@/lib/tenants";

// The blog the editor writes to, resolved from the session on the SERVER so a
// client can never target another user's blog. Writing always requires auth;
// demo mode (auth off) is read only, so these actions refuse there.
async function editorUser() {
  if (!isAuthConfigured) throw new Error("Editing requires signing in");
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");
  return user;
}

async function editorHandle(): Promise<string> {
  const user = await editorUser();
  const blog = await ensureOwnerBlog(user);
  return blog.handle;
}

async function createAnonymousBlogHandle(): Promise<string> {
  const token = generateEditToken();
  const blog = await createAnonymousBlogRecord(
    hashEditToken(token),
    friendlyAnonymousSeed(),
  );
  await setAnonymousEditCookie(blog.id, token);
  return blog.handle;
}

const POST_TYPES: PostType[] = ["article", "project", "talk"];
const BLOG_FEED_PATHS = [
  "posts.json",
  "feed.json",
  "feed.xml",
  "atom.xml",
  "sitemap.xml",
  "llms.txt",
];

function cleanPostType(value: unknown): PostType {
  return POST_TYPES.includes(value as PostType) ? (value as PostType) : "article";
}

function cleanEditablePostType(value: unknown): PostType {
  if (POST_TYPES.includes(value as PostType)) return value as PostType;
  throw new Error("Type must be Article, Project, or Talk");
}

function cleanPostId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Post not found");
  }
  return value.trim();
}

function cleanHandle(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Blog not found");
  }
  const handle = value.trim().toLowerCase();
  if (!TENANT_HANDLE_RE.test(handle)) throw new Error("Blog not found");
  return handle;
}

function cleanStatus(value: unknown): Post["status"] {
  if (value === "published" || value === "draft") return value;
  throw new Error("Visibility must be Public or Unlisted");
}

function cleanLine(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function cleanOptionalLine(value: unknown, label: string): string | undefined {
  if (value == null) return undefined;
  return cleanLine(value, label) || undefined;
}

function cleanBody(value: unknown): string {
  if (typeof value !== "string") throw new Error("Body must be text");
  return value.replace(/\u0000/g, "");
}

function cleanAccent(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw new Error("Accent must be a hex color");
  const accent = value.trim();
  if (!accent) return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) {
    throw new Error("Accent must be a hex color like #065ec6");
  }
  return accent;
}

function cleanSlug(value: unknown, fallback: string): string {
  if (typeof value !== "string") throw new Error("Slug must be text");
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function hasInputKey(values: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(values, key);
}

function cleanGalleryItem(value: unknown, index: number): GalleryItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Gallery item ${index + 1} must be an object`);
  }

  const values = value as Record<string, unknown>;
  const src = cleanOptionalLine(values.src, `Gallery item ${index + 1} URL`);
  if (!src) return null;

  const caption = cleanOptionalLine(
    values.caption,
    `Gallery item ${index + 1} caption`,
  );
  const poster = cleanOptionalLine(
    values.poster,
    `Gallery item ${index + 1} poster`,
  );
  const item: GalleryItem = { src };
  if (caption) item.caption = caption;
  if (poster) item.poster = poster;
  return item;
}

function cleanGallery(value: unknown): GalleryItem[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("Gallery must be a list");
  return value
    .map((item, index) => cleanGalleryItem(item, index))
    .filter((item): item is GalleryItem => item !== null);
}

function editableInput(input: unknown, existing: Post, fallbackSlug: string) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid post");
  }
  const values = input as Record<string, unknown>;
  return {
    id: cleanPostId(values.id),
    type: hasInputKey(values, "type")
      ? cleanEditablePostType(values.type)
      : existing.type,
    title: cleanLine(values.title, "Title"),
    excerpt: cleanLine(values.excerpt ?? "", "Excerpt") || undefined,
    cover: hasInputKey(values, "cover")
      ? cleanOptionalLine(values.cover, "Cover")
      : existing.cover,
    coverCaption: hasInputKey(values, "coverCaption")
      ? cleanOptionalLine(values.coverCaption, "Cover caption")
      : existing.coverCaption,
    body: cleanBody(values.body),
    status: cleanStatus(values.status),
    slug: cleanSlug(values.slug, fallbackSlug),
    accent: cleanAccent(values.accent),
    gallery: hasInputKey(values, "gallery")
      ? cleanGallery(values.gallery)
      : (existing.gallery ?? []),
    videoUrl: hasInputKey(values, "videoUrl")
      ? cleanOptionalLine(values.videoUrl, "Video URL")
      : existing.videoUrl,
    venue: hasInputKey(values, "venue")
      ? cleanOptionalLine(values.venue, "Venue")
      : existing.venue,
    duration: hasInputKey(values, "duration")
      ? cleanOptionalLine(values.duration, "Duration")
      : existing.duration,
  };
}

function blogPath(handle: string, path = ""): string {
  return `/t/${encodeURIComponent(handle)}${path}`;
}

function revalidateBlog(handle: string, slugs: string[] = []) {
  revalidatePath(blogPath(handle));
  for (const feedPath of BLOG_FEED_PATHS) {
    revalidatePath(blogPath(handle, `/${feedPath}`));
  }
  for (const slug of new Set(slugs.filter(Boolean))) {
    revalidatePath(blogPath(handle, `/${encodeURIComponent(slug)}`));
    revalidatePath(blogPath(handle, `/${encodeURIComponent(slug)}/index.md`));
  }
}

async function editableHandleFor(handleInput?: unknown) {
  const handle =
    handleInput === undefined ? await editorHandle() : cleanHandle(handleInput);
  const access = await getBlogEditAccess(handle);
  if (!access.canEdit) throw new Error("You cannot edit this blog");
  return { handle, access };
}

function actionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function createAnonymousBlog(): Promise<string> {
  return createAnonymousBlogHandle();
}

export async function startBlogAction() {
  const user = await getCurrentUser();
  const handle = user
    ? (await ensureOwnerBlog(user)).handle
    : await createAnonymousBlogHandle();
  redirect(blogPath(handle));
}

export async function savePostAction(post: Post): Promise<Post> {
  const { handle } = await editableHandleFor();
  const saved = await savePost(handle, post);
  revalidateBlog(handle, [saved.slug]);
  return saved;
}

export async function createDraftAction(
  type: PostType = "article",
  handleInput?: unknown,
): Promise<Post> {
  const { handle } = await editableHandleFor(handleInput);
  const post = await createDraft(handle, type);
  revalidateBlog(handle, [post.slug]);
  return post;
}

export async function updateBlogAction(
  patch: BlogPatch,
  handleInput?: unknown,
): Promise<Blog> {
  const { handle, access } = await editableHandleFor(handleInput);
  const updated = await updateBlogByHandle(handle, patch, {
    allowHandleChange: access.isOwner,
  });
  revalidateBlog(handle);
  if (updated.handle !== handle) revalidateBlog(updated.handle);
  return updated;
}

export async function createPostAndRedirectAction(formData: FormData) {
  const handleValue = formData.get("handle");
  const { handle } = await editableHandleFor(
    typeof handleValue === "string" && handleValue.trim()
      ? handleValue
      : undefined,
  );
  const post = await createDraft(handle, cleanPostType(formData.get("type")));
  revalidateBlog(handle, [post.slug]);
  redirect(blogPath(handle, `/${encodeURIComponent(post.slug)}?edit=1`));
}

export async function createArticleDraftPathAction(
  handleInput?: unknown,
): Promise<string> {
  const { handle } = await editableHandleFor(handleInput);
  const post = await createDraft(handle, "article");
  revalidateBlog(handle, [post.slug]);
  return blogPath(handle, `/${encodeURIComponent(post.slug)}`);
}

export async function saveEditablePostAction(
  handleOrInput: unknown,
  maybeInput?: unknown,
): Promise<Post> {
  const { handle } = await editableHandleFor(
    maybeInput === undefined ? undefined : handleOrInput,
  );
  const input = maybeInput === undefined ? handleOrInput : maybeInput;
  const id = cleanPostId(
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>).id
      : undefined,
  );
  const existing = await getPostById(handle, id);
  if (!existing) throw new Error("Post not found");

  const patch = editableInput(input, existing, existing.slug);
  const saved = await savePost(handle, {
    ...existing,
    type: patch.type,
    title: patch.title,
    excerpt: patch.excerpt,
    cover: patch.cover,
    coverCaption: patch.coverCaption,
    body: patch.body,
    status: patch.status,
    slug: patch.slug,
    accent: patch.accent,
    pinned: existing.pinned,
    gallery: patch.gallery,
    videoUrl: patch.videoUrl,
    venue: patch.venue,
    duration: patch.duration,
  });
  revalidateBlog(handle, [saved.slug]);
  return saved;
}

export async function toggleEditablePostPinnedAction(
  handleOrId: unknown,
  maybeId?: unknown,
): Promise<Post> {
  const { handle } = await editableHandleFor(
    maybeId === undefined ? undefined : handleOrId,
  );
  const id = maybeId === undefined ? handleOrId : maybeId;
  const postId = cleanPostId(id);
  const existing = await getPostById(handle, postId);
  if (!existing) throw new Error("Post not found");
  const saved = await setPostPinned(handle, postId, !existing.pinned);
  revalidateBlog(handle, [existing.slug]);
  return saved;
}

export async function deleteEditablePostAction(
  handleOrId: unknown,
  maybeId?: unknown,
): Promise<{ handle: string }> {
  const { handle } = await editableHandleFor(
    maybeId === undefined ? undefined : handleOrId,
  );
  const id = maybeId === undefined ? handleOrId : maybeId;
  const postId = cleanPostId(id);
  const existing = await getPostById(handle, postId);
  if (!existing) throw new Error("Post not found");
  await deletePost(handle, postId);
  revalidateBlog(handle, [existing.slug]);
  return { handle };
}

export async function updateBlogNameAction(
  handleInput: unknown,
  nameInput: unknown,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  try {
    const { handle, access } = await editableHandleFor(handleInput);
    const updated = await updateBlogByHandle(
      handle,
      { name: typeof nameInput === "string" ? nameInput : "" },
      { allowHandleChange: access.isOwner },
    );
    revalidateBlog(handle);
    return { ok: true, name: updated.name };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Could not save") };
  }
}

export async function claimBlog(
  handleInput: unknown,
): Promise<
  | { ok: true; handle: string }
  | { ok: false; error: string; signInRequired?: boolean }
> {
  const handle = cleanHandle(handleInput);
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      error: "Sign in to claim this blog",
      signInRequired: true,
    };
  }

  const access = await getBlogEditAccess(handle);
  if (!access.isUnclaimed) {
    return { ok: false, error: "This blog is already claimed" };
  }
  if (!access.canEdit || !access.isTokenEditor) {
    return { ok: false, error: "You cannot claim this blog" };
  }

  try {
    const blog = await claimBlogForUser(handle, user);
    if (access.blogId) await deleteAnonymousEditCookie(access.blogId);
    revalidateBlog(handle);
    return { ok: true, handle: blog.handle };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Could not claim") };
  }
}
