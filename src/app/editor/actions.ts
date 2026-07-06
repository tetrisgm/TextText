"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type {
  Blog,
  BlogHomeLayout,
  GalleryItem,
  LinkRef,
  Post,
  PostType,
} from "@/lib/content";
import { isAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/lib/session";
import type { CurrentUser } from "@/lib/session";
import type { BlogPatch } from "@/lib/store";
import {
  claimBlogForUser,
  countAllPosts,
  createAnonymousBlogRecord,
  createDraft,
  deletePost,
  ensureOwnerBlog,
  getAllPosts,
  getBlog,
  getOwnedBlog,
  getPostById,
  savePost,
  setPostPinned,
  trashBlogPosts,
  updateBlogByHandle,
} from "@/lib/store";
import {
  deleteAnonymousEditCookie,
  friendlyAnonymousSeed,
  generateEditToken,
  getActiveGuestBlogFromCookie,
  getBlogEditAccess,
  hashEditToken,
  setAnonymousEditCookie,
} from "@/lib/blog-edit-auth";
import {
  ANONYMOUS_MAX_POSTS,
  ANONYMOUS_POST_LIMIT_COPY,
} from "@/lib/product-limits";
import { TENANT_HANDLE_RE } from "@/lib/tenants";
import {
  blogHomePath,
  blogPostEditPath,
  tenantPostPath,
} from "@/lib/public-paths";

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
  const blog = await resolveOwnedWorkspace(user);
  return blog.handle;
}

// The signed-in user's workspace. An owned blog wins; otherwise the browser's
// unclaimed guest workspace is CLAIMED (this is the save-your-work moment, so
// signing in must never strand the guest blog by provisioning a fresh one);
// only when neither exists is a starter blog provisioned.
async function resolveOwnedWorkspace(user: CurrentUser): Promise<Blog> {
  const owned = await getOwnedBlog(user.sub);
  if (owned) return ensureOwnerBlog(user);

  const guest = await getActiveGuestBlogFromCookie();
  if (guest) {
    try {
      const claimed = await claimBlogForUser(guest.handle, user);
      await deleteAnonymousEditCookie(guest.id);
      await revalidateBlog(claimed.handle);
      return claimed;
    } catch {
      // A concurrent claim or a race settles below; never block sign-in.
    }
  }

  return ensureOwnerBlog(user);
}

function cleanHomeLayout(value: unknown): BlogHomeLayout {
  if (
    value === "single" ||
    value === "timeline" ||
    value === "grid" ||
    value === "index"
  ) {
    return value;
  }
  if (value === "cards") return "grid";
  return "grid";
}

async function createAnonymousBlogHandle(
  layoutInput?: unknown,
): Promise<string> {
  const token = generateEditToken();
  const homeLayout = cleanHomeLayout(layoutInput);
  const blog = await createAnonymousBlogRecord(
    hashEditToken(token),
    friendlyAnonymousSeed(),
    homeLayout,
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
  "folder.json",
];

function cleanPostType(value: unknown): PostType {
  return POST_TYPES.includes(value as PostType) ? (value as PostType) : "article";
}

function cleanEditablePostType(value: unknown): PostType {
  if (POST_TYPES.includes(value as PostType)) return value as PostType;
  throw new Error("Type must be Article, Media post, or Video post");
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

function cleanCoverHeight(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Header height must be a number");
  }
  const rounded = Math.round(value);
  if (rounded < 180 || rounded > 860) {
    throw new Error("Header height is outside the supported range");
  }
  return rounded;
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

function cleanLinks(value: unknown): LinkRef[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("Links must be a list");
  const links: LinkRef[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Link ${index + 1} must be an object`);
    }
    const values = item as Record<string, unknown>;
    const label = cleanOptionalLine(values.label, `Link ${index + 1} label`);
    const href = cleanOptionalLine(values.href, `Link ${index + 1} URL`);
    if (!href) continue;
    links.push({ label: label || href, href });
  }
  return links;
}

function cleanDate(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("Date must be text");
  const date = value.trim();
  if (!date) return undefined;
  if (Number.isNaN(new Date(date).getTime())) throw new Error("Date is invalid");
  return date;
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
    coverHeight: hasInputKey(values, "coverHeight")
      ? cleanCoverHeight(values.coverHeight)
      : existing.coverHeight,
    body: cleanBody(values.body),
    status: cleanStatus(values.status),
    slug: cleanSlug(values.slug, fallbackSlug),
    accent: cleanAccent(values.accent),
    gallery: hasInputKey(values, "gallery")
      ? cleanGallery(values.gallery)
      : (existing.gallery ?? []),
    links: hasInputKey(values, "links")
      ? cleanLinks(values.links)
      : (existing.links ?? []),
    date: hasInputKey(values, "date")
      ? cleanDate(values.date)
      : existing.date,
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

function tenantPostEditPath(handle: string, post: Pick<Post, "id" | "slug">): string {
  const params = new URLSearchParams({ edit: "1" });
  if (post.id) params.set("id", post.id);
  return `${tenantPostPath(handle, post.slug)}?${params.toString()}`;
}

async function revalidateBlog(handle: string, slugs: string[] = []) {
  const uniqueSlugs = [...new Set(slugs.filter(Boolean))];
  const roots = [blogPath(handle)];

  // A claimed blog is served from /u/{username} (the /@ alias rewrites there),
  // so its cache entries must be invalidated alongside the /t mirror.
  const blog = await getBlog(handle).catch(() => null);
  if (blog?.username) roots.push(`/u/${encodeURIComponent(blog.username)}`);

  for (const root of roots) {
    revalidatePath(root);
    for (const feedPath of BLOG_FEED_PATHS) {
      revalidatePath(`${root}/${feedPath}`);
    }
    for (const slug of uniqueSlugs) {
      revalidatePath(`${root}/${encodeURIComponent(slug)}`);
      revalidatePath(`${root}/${encodeURIComponent(slug)}/index.md`);
    }
  }
}

async function editableHandleFor(handleInput?: unknown) {
  const handle =
    handleInput === undefined ? await editorHandle() : cleanHandle(handleInput);
  const access = await getBlogEditAccess(handle);
  if (!access.canEdit) throw new Error("You cannot edit this blog");
  return { handle, access };
}

async function enforceAnonymousPostLimit(
  handle: string,
  access: Awaited<ReturnType<typeof getBlogEditAccess>>,
) {
  if (!access.isUnclaimed) return;
  const count = await countAllPosts(handle);
  if (count >= ANONYMOUS_MAX_POSTS) {
    throw new Error(ANONYMOUS_POST_LIMIT_COPY);
  }
}

function actionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function firstWritableArticle(posts: Post[]): Post | undefined {
  return (
    posts.find((post) => post.type === "article" && post.status === "draft") ??
    posts.find((post) => post.status === "draft") ??
    posts.find((post) => post.type === "article") ??
    posts[0]
  );
}

async function ensureFirstArticleDraftPath(
  handle: string,
  access?: Awaited<ReturnType<typeof getBlogEditAccess>>,
): Promise<string> {
  const posts = await getAllPosts(handle);
  let post = firstWritableArticle(posts);

  if (!post) {
    if (access) await enforceAnonymousPostLimit(handle, access);
    post = await createDraft(handle, "article");
  }

  await revalidateBlog(handle, [post.slug]);
  const blog = await getBlog(handle);
  if (blog) return blogPostEditPath(blog, post);
  return tenantPostEditPath(handle, post);
}

export async function createStarterDraftPath(layoutInput?: unknown): Promise<string> {
  const user = await getCurrentUser();
  const hasLayoutInput = layoutInput !== undefined && layoutInput !== null;
  const layout = cleanHomeLayout(layoutInput);
  if (user) {
    const handle = (await resolveOwnedWorkspace(user)).handle;
    if (hasLayoutInput) {
      await updateBlogByHandle(handle, { homeLayout: layout }, { allowHandleChange: true });
    }
    return ensureFirstArticleDraftPath(handle);
  }

  const activeGuest = await getActiveGuestBlogFromCookie();
  const handle = activeGuest?.handle ?? await createAnonymousBlogHandle(layout);
  const access = await getBlogEditAccess(handle);

  if (activeGuest && hasLayoutInput) {
    await updateBlogByHandle(handle, { homeLayout: layout }, { allowHandleChange: false });
  }

  return ensureFirstArticleDraftPath(handle, access);
}

// Where "keep this workspace" lands: the signed-in user's workspace home,
// claiming the browser's guest blog on the way when there is one.
export async function resolveWorkspaceHomePath(): Promise<string> {
  const user = await getCurrentUser();
  if (user) {
    const blog = await resolveOwnedWorkspace(user);
    return blogHomePath(blog);
  }

  const activeGuest = await getActiveGuestBlogFromCookie();
  if (activeGuest) return blogPath(activeGuest.handle);
  return blogPath(await createAnonymousBlogHandle());
}

export async function savePostAction(post: Post): Promise<Post> {
  const { handle, access } = await editableHandleFor();

  // The legacy editor sends a whole Post object; run it through the same
  // sanitization as the inline editor instead of trusting the client shape.
  if (post.id) {
    const existing = await getPostById(handle, post.id);
    if (!existing) throw new Error("Post not found");
    const patch = editableInput(post, existing, existing.slug);
    const saved = await savePost(handle, {
      ...existing,
      ...patch,
      pinned: existing.pinned,
    });
    await revalidateBlog(handle, [existing.slug, saved.slug]);
    return saved;
  }

  await enforceAnonymousPostLimit(handle, access);
  const created = await createDraft(handle, cleanPostType(post.type));
  const patch = editableInput(
    { ...post, id: created.id },
    created,
    created.slug,
  );
  const saved = await savePost(handle, {
    ...created,
    ...patch,
  });
  await revalidateBlog(handle, [saved.slug]);
  return saved;
}

export async function createDraftAction(
  type: PostType = "article",
  handleInput?: unknown,
): Promise<Post> {
  const { handle, access } = await editableHandleFor(handleInput);
  await enforceAnonymousPostLimit(handle, access);
  const post = await createDraft(handle, type);
  await revalidateBlog(handle, [post.slug]);
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
  await revalidateBlog(handle);
  if (updated.handle !== handle) await revalidateBlog(updated.handle);
  return updated;
}

export async function createPostAndRedirectAction(formData: FormData) {
  const handleValue = formData.get("handle");
  const { handle, access } = await editableHandleFor(
    typeof handleValue === "string" && handleValue.trim()
      ? handleValue
      : undefined,
  );
  await enforceAnonymousPostLimit(handle, access);
  const post = await createDraft(handle, cleanPostType(formData.get("type")));
  await revalidateBlog(handle, [post.slug]);
  const blog = await getBlog(handle);
  const path = blog
    ? blogPostEditPath(blog, post)
    : tenantPostEditPath(handle, post);
  redirect(path);
}

export async function createArticleDraftPathAction(
  handleInput?: unknown,
): Promise<string> {
  const { handle, access } = await editableHandleFor(handleInput);
  await enforceAnonymousPostLimit(handle, access);
  const post = await createDraft(handle, "article");
  await revalidateBlog(handle, [post.slug]);
  const blog = await getBlog(handle);
  return blog
    ? blogPostEditPath(blog, post)
    : tenantPostEditPath(handle, post);
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
    ...patch,
    pinned: existing.pinned,
  });
  await revalidateBlog(handle, [existing.slug, saved.slug]);
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
  await revalidateBlog(handle, [existing.slug]);
  return saved;
}

export async function deleteEditablePostAction(
  handleOrId: unknown,
  maybeId?: unknown,
): Promise<{ handle: string }> {
  const handle =
    maybeId === undefined ? await editorHandle() : cleanHandle(handleOrId);
  const id = maybeId === undefined ? handleOrId : maybeId;
  const postId = cleanPostId(id);
  const access = await getBlogEditAccess(handle);
  const existing = await getPostById(handle, postId);
  if (!existing) throw new Error("Post not found");
  // Deleting always requires the edit credential (owner or the guest cookie);
  // an unclaimed blog's starter draft is NOT deletable by arbitrary visitors.
  if (!access.canEdit) throw new Error("You cannot edit this blog");
  await deletePost(handle, postId);
  await revalidateBlog(handle, [existing.slug]);
  return { handle };
}

export async function trashEditableBlogAction(
  handleInput: unknown,
): Promise<
  | { ok: true; path: string; openSidebar: boolean }
  | { ok: false; error: string }
> {
  try {
    const { handle, access } = await editableHandleFor(handleInput);
    if (!access.isUnclaimed) {
      return {
        ok: false,
        error: "Trash is available for guest workspaces first.",
      };
    }
    const existingPosts = await getAllPosts(handle);
    await trashBlogPosts(handle);
    await revalidateBlog(handle, existingPosts.map((post) => post.slug));
    return { ok: true, path: blogPath(handle), openSidebar: true };
  } catch (error) {
    return {
      ok: false,
      error: actionErrorMessage(error, "Could not move folder to Trash"),
    };
  }
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
    await revalidateBlog(handle);
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
    await revalidateBlog(handle);
    return { ok: true, handle: blog.handle };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Could not claim") };
  }
}
