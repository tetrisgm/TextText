"use server";

import { redirect } from "next/navigation";
import type {
  Blog,
  BlogHomeLayout,
  Folder,
  GalleryItem,
  LinkRef,
  Post,
  PostType,
} from "@/lib/content";
import { isSafeLinkHref } from "@/lib/content";
import { isAuthConfigured } from "@/auth";
import { getCurrentUser } from "@/lib/session";
import type { BlogPatch, ItemComment, PostContentPatch } from "@/lib/store";
import {
  claimBlogForUser,
  countAllPosts,
  createItemComment,
  createAnonymousBlogRecord,
  createDraft,
  createSubfolder,
  deletePost,
  emptyTrash,
  permanentlyDeleteFolder,
  permanentlyDeletePost,
  getAllPosts,
  getFolders,
  getBlog,
  getOwnerPlan,
  getPostById,
  getUserIdBySub,
  isWorkspaceStarterPost,
  listItemComments,
  markCapturePending,
  renameFolder,
  restoreFolder,
  restorePost,
  savePost,
  savePostContentPatch,
  setPostFolder,
  setPostCreatedAt,
  setPostPinned,
  setItemCommentResolved,
  trashBlogPosts,
  trashFolder,
  updateBlogByHandle,
} from "@/lib/store";
import {
  inviteScopeShare,
  listPostShares,
  listScopeShares,
  revokePostShare,
  revokeScopeShare,
  updateScopeShareRole,
} from "@/lib/shares";
import type { PostShare, ScopeShare, ScopeShareRole, ShareRole } from "@/lib/shares";
import { sendShareInviteEmail } from "@/lib/share-email";
import {
  type CollaboratorScopeType,
  isItemShareRole,
  isWorkspaceMemberRole,
  resolveItemAccess,
  resolveWorkspaceAccess,
} from "@/lib/permissions";
import { lightCaptureBookmark } from "@/lib/bookmark-fetch";
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
  ANONYMOUS_POST_LIMIT_COPY,
  cleanPlanTier,
  planLimits,
} from "@/lib/product-limits";
import type { PlanTier } from "@/lib/product-limits";
import { TENANT_HANDLE_RE } from "@/lib/tenants";
import {
  blogHomePath,
  blogPostEditPath,
  tenantPostPath,
} from "@/lib/public-paths";
import { recordAction, recordSlugChanged } from "@/lib/audit";
import {
  hasActiveCoEditors,
  reconcileCollabLogAfterExternalWrite,
} from "@/lib/collab";
import { NO_COVER_VALUE } from "@/lib/cover";
import {
  attachItemAsset,
  importItemAssetFromUrl,
  listItemAssetReferences,
  removeItemAssetReferences,
  type ItemAssetPlacement,
  type ItemAssetReference,
} from "@/lib/item-assets";
import { sanitizePostSlug } from "@/lib/post-slug";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import { resolveOwnedWorkspace } from "@/lib/workspace";

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

// The Blog folder's public vocabulary; the blog-home Create picker offers
// exactly these. Notes and bookmarks are created through
// createFolderItemAction and never through the blog picker.
const POST_TYPES: PostType[] = ["article", "project", "talk"];
const ALL_POST_TYPES: PostType[] = [...POST_TYPES, "note", "bookmark"];
const WORKSPACE_CREATE_TYPES: PostType[] = ["article", "note", "bookmark"];

function cleanPostType(value: unknown): PostType {
  return POST_TYPES.includes(value as PostType) ? (value as PostType) : "article";
}

function cleanWorkspaceCreateType(value: unknown): Extract<
  PostType,
  "article" | "note" | "bookmark"
> {
  return WORKSPACE_CREATE_TYPES.includes(value as PostType)
    ? (value as Extract<PostType, "article" | "note" | "bookmark">)
    : "article";
}

// Notes and bookmarks live in their own folders and are always unlisted.
function isUnlistedPostType(type: PostType): boolean {
  return type === "note" || type === "bookmark";
}

function cleanEditablePostType(value: unknown, existing: PostType): PostType {
  if (!ALL_POST_TYPES.includes(value as PostType)) {
    throw new Error("Type must be Article, Media post, or Video post");
  }
  const next = value as PostType;
  // An item never crosses between the blog vocabulary and the unlisted kinds
  // (note <-> bookmark moves are folder moves, not type edits, so they are
  // refused here too). Blog kinds keep their switcher freedom.
  if (
    next !== existing &&
    (isUnlistedPostType(next) || isUnlistedPostType(existing))
  ) {
    throw new Error("This item cannot change type");
  }
  return next;
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

function assertCurrentEditBase(input: unknown, existing: Post) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const value = (input as Record<string, unknown>).baseUpdatedAt;
  if (value == null || value === "") return;
  if (typeof value !== "string") throw new Error("Invalid edit version");
  const baseTime = Date.parse(value);
  const existingTime = Date.parse(existing.updatedAt ?? "");
  if (!Number.isFinite(baseTime) || !Number.isFinite(existingTime)) return;
  if (existingTime > baseTime) {
    throw new Error(
      "This item changed elsewhere. Your local draft is still available.",
    );
  }
}

// A pool-shell save (the blog owner or a workspace full member) writes
// `posts.body` directly and never enters the shared Yjs document. Letting it
// land while editors are live co-editing would be silently clobbered by their
// next autosave (there is no store -> Yjs bridge), so refuse it with a conflict
// exactly as the sync and MCP write paths do. Item-share collaborators editing
// through the Yjs shell go down a different branch and are never guarded here.
async function refuseWhileCoEdited(postId: string | undefined | null) {
  if (postId && (await hasActiveCoEditors(postId))) {
    throw new Error(
      "This item is being co-edited right now. Open it in the shared editor to join, or try again once the live session ends.",
    );
  }
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
  return sanitizePostSlug(value, fallback);
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
    if (!isSafeLinkHref(href)) {
      throw new Error(`Link ${index + 1} must be a web, mail, or in-site URL`);
    }
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
  const type = hasInputKey(values, "type")
    ? cleanEditablePostType(values.type, existing.type)
    : existing.type;
  return {
    id: cleanPostId(values.id),
    type,
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
    // A note or bookmark is unlisted forever: whatever the client sends, its
    // status stays draft (cross-group type changes are refused above, so the
    // resolved type covers the existing type too).
    status: isUnlistedPostType(type)
      ? ("draft" as const)
      : cleanStatus(values.status),
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

function collaboratorContentPatch(input: unknown, existing: Post): PostContentPatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid post");
  }
  const values = input as Record<string, unknown>;
  return {
    title: hasInputKey(values, "title")
      ? cleanLine(values.title, "Title")
      : existing.title,
    body: hasInputKey(values, "body") ? cleanBody(values.body) : existing.body,
    cover: hasInputKey(values, "cover")
      ? cleanOptionalLine(values.cover, "Cover")
      : existing.cover,
    coverCaption: hasInputKey(values, "coverCaption")
      ? cleanOptionalLine(values.coverCaption, "Cover caption")
      : existing.coverCaption,
    coverHeight: hasInputKey(values, "coverHeight")
      ? cleanCoverHeight(values.coverHeight)
      : existing.coverHeight,
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

async function revalidateBlog(
  handle: string,
  slugs: string[] = [],
  blogOverride?: Pick<Blog, "handle" | "username">,
) {
  // A claimed blog is served from /u/{username} (the /@ alias rewrites there),
  // so its cache entries must be invalidated alongside the /t mirror.
  const blog = blogOverride ?? (await getBlog(handle).catch(() => null));
  revalidateBlogPaths(blog ?? { handle }, slugs);
}

async function editableHandleFor(handleInput?: unknown) {
  const handle =
    handleInput === undefined ? await editorHandle() : cleanHandle(handleInput);
  const access = await getBlogEditAccess(handle);
  if (!access.canEdit) throw new Error("You cannot edit this blog");
  return { handle, access };
}

// One audit row per mutation. The editor UI is a human actor; the blog owner
// is the actor id when the session holds one, and guests audit as null.
async function auditEdit(
  access: Awaited<ReturnType<typeof getBlogEditAccess>>,
  actionName: string,
  targetType: "workspace" | "item",
  targetId: string | null | undefined,
  summary?: string,
) {
  await recordAction({
    actorUserId: access.isOwner ? access.ownerId : null,
    actorType: "human",
    actionName,
    targetType,
    targetId,
    inputSummary: summary,
  });
}

async function enforceAnonymousPostLimit(
  handle: string,
  access: Awaited<ReturnType<typeof getBlogEditAccess>>,
) {
  // Every tier has a server-enforced item cap: guests are held to the
  // try-before-signup limit, owners to their plan's.
  const tier: PlanTier = access.isUnclaimed
    ? "anonymous"
    : cleanPlanTier(await getOwnerPlan(handle));
  const count = access.isUnclaimed
    ? (await getAllPosts(handle)).filter((post) => !isWorkspaceStarterPost(post))
        .length
    : await countAllPosts(handle);
  if (count >= planLimits(tier).maxPosts) {
    throw new Error(
      tier === "anonymous"
        ? ANONYMOUS_POST_LIMIT_COPY
        : "This workspace reached its item limit.",
    );
  }
}

function actionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function firstWritableArticle(posts: Post[]): Post | undefined {
  // Notes and bookmarks never volunteer as the starter draft: they belong to
  // their own folders and would open in the wrong editor.
  const blogPosts = posts.filter((post) => !isUnlistedPostType(post.type));
  return (
    blogPosts.find(
      (post) => post.type === "article" && post.status === "draft",
    ) ??
    blogPosts.find((post) => post.status === "draft") ??
    blogPosts.find((post) => post.type === "article") ??
    blogPosts[0]
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
    await auditEdit(
      access ?? (await getBlogEditAccess(handle)),
      "create_post",
      "item",
      post.id,
      "starter draft",
    );
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
    await refuseWhileCoEdited(existing.id);
    const patch = editableInput(post, existing, existing.slug);
    const saved = await savePost(
      handle,
      {
        ...existing,
        ...patch,
        pinned: existing.pinned,
      },
      { expectedRevision: existing.revision },
    );
    await recordSlugChanged({
      actorUserId: access.isOwner ? access.ownerId : null,
      actorType: "human",
      targetId: saved.id,
      oldSlug: existing.slug,
      newSlug: saved.slug,
    });
    await auditEdit(access, "save_post", "item", saved.id, saved.title);
    if (saved.id) await reconcileCollabLogAfterExternalWrite(saved.id);
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
  await auditEdit(access, "create_post", "item", saved.id, saved.title);
  await revalidateBlog(handle, [saved.slug]);
  return saved;
}

export async function createDraftAction(
  type: PostType = "article",
  handleInput?: unknown,
): Promise<Post> {
  const { handle, access } = await editableHandleFor(handleInput);
  await enforceAnonymousPostLimit(handle, access);
  // Blog kinds only: notes and bookmarks go through createFolderItemAction.
  const post = await createDraft(handle, cleanPostType(type));
  await auditEdit(access, "create_post", "item", post.id, post.type);
  await revalidateBlog(handle, [post.slug]);
  return post;
}

export async function createWorkspacePostAction(
  handleInput: unknown,
  typeInput: PostType = "article",
  folderPathInput?: unknown,
): Promise<Post> {
  const { handle, access } = await editableHandleFor(handleInput);
  await enforceAnonymousPostLimit(handle, access);
  const type = cleanWorkspaceCreateType(typeInput);
  const created = await createDraft(handle, type);
  const folderPath =
    typeof folderPathInput === "string" ? folderPathInput.trim() : "";
  const saved =
    type === "article" && folderPath && folderPath !== "blog" && created.id
      ? await setPostFolder(handle, created.id, folderPath)
      : created;
  if (!saved) throw new Error("Post not found");
  await auditEdit(
    access,
    type === "note"
      ? "create_note"
      : type === "bookmark"
        ? "create_bookmark"
        : "create_post",
    "item",
    saved.id,
    type,
  );
  await revalidateBlog(handle, [saved.slug]);
  return saved;
}

function cleanItemFolder(value: unknown): "notes" | "bookmarks" {
  if (value === "notes" || value === "bookmarks") return value;
  throw new Error("Folder not found");
}

// A bookmark's link: http(s) only, at most 2048 characters, absolute. Bare
// host input ("example.com") gets https:// prepended, same forgiveness as the
// reader's normalizedUrl.
function cleanBookmarkUrl(value: unknown): URL {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("A bookmark needs a link");
  }
  const raw = value.trim();
  if (raw.length > 2048) throw new Error("That link is too long");
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    try {
      url = new URL(`https://${raw}`);
    } catch {
      url = null;
    }
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new Error("A bookmark link must start with http or https");
  }
  if (url.toString().length > 2048) throw new Error("That link is too long");
  return url;
}

// Create an item in the Notes or Bookmarks folder. Both are born (and stay)
// unlisted drafts: a note is an empty article-shaped draft, a bookmark keeps
// its URL in links[0] and uses the body for commentary.
export async function createFolderItemAction(
  handleInput: unknown,
  folderInput: "notes" | "bookmarks",
  input?: { description?: string; title?: string; url?: string },
): Promise<Post> {
  const folder = cleanItemFolder(folderInput);
  const { handle, access } = await editableHandleFor(handleInput);
  await enforceAnonymousPostLimit(handle, access);

  if (folder === "notes") {
    const created = await createDraft(handle, "note");
    const title = cleanOptionalLine(input?.title, "Title");
    const post = title ? await savePost(handle, { ...created, title }) : created;
    await auditEdit(access, "create_note", "item", post.id, post.title);
    await revalidateBlog(handle, [post.slug]);
    return post;
  }

  const url = cleanBookmarkUrl(input?.url);
  const host = url.hostname.replace(/^www\./, "");
  const title = cleanOptionalLine(input?.title, "Title") || host;
  const description = cleanOptionalLine(input?.description, "Description");
  const created = await createDraft(handle, "bookmark");
  const saved = await savePost(handle, {
    ...created,
    title,
    excerpt: description || undefined,
    links: [{ label: host || title, href: url.toString() }],
    body: "",
  });
  // Enter the capture pipeline: pending until a capture agent (the Mac app)
  // grabs the readable text, original HTML, and screenshot. The server's own
  // light fetch fills title/description meanwhile without settling the state.
  if (saved.id) {
    await markCapturePending(handle, saved.id, url.toString());
    void lightCaptureBookmark(handle, saved.id, url.toString()).catch(
      (error) => console.warn("bookmark light capture failed", error),
    );
  }
  await auditEdit(access, "create_bookmark", "item", saved.id, url.toString());
  await revalidateBlog(handle, [saved.slug]);
  return {
    ...saved,
    captureStatus: "pending",
    capture: { ...(saved.capture ?? {}), url: url.toString() },
  };
}

export async function updateBlogAction(
  patch: BlogPatch,
  handleInput?: unknown,
): Promise<Blog> {
  const { handle, access } = await editableHandleFor(handleInput);
  const updated = await updateBlogByHandle(handle, patch, {
    allowHandleChange: access.isOwner,
  });
  await auditEdit(
    access,
    "update_blog",
    "workspace",
    access.blogId,
    Object.keys(patch as Record<string, unknown>).join(", "),
  );
  await revalidateBlog(
    handle,
    [],
    updated.handle === handle ? updated : undefined,
  );
  if (updated.handle !== handle) {
    await revalidateBlog(updated.handle, [], updated);
  }
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
  await auditEdit(access, "create_post", "item", post.id, post.type);
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
  await auditEdit(access, "create_post", "item", post.id, post.type);
  await revalidateBlog(handle, [post.slug]);
  const blog = await getBlog(handle);
  return blog
    ? blogPostEditPath(blog, post)
    : tenantPostEditPath(handle, post);
}

export async function saveEditablePostAction(
  handleOrInput: unknown,
  maybeInput?: unknown,
  options: { revalidate?: boolean } = {},
): Promise<Post> {
  const handle =
    maybeInput === undefined
      ? await editorHandle().catch(() => null)
      : cleanHandle(handleOrInput);
  const input = maybeInput === undefined ? handleOrInput : maybeInput;
  const id = cleanPostId(
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>).id
      : undefined,
  );
  if (!handle) throw new Error("You cannot edit this blog");
  const access = await getBlogEditAccess(handle);
  const existing = await getPostById(handle, id);
  if (!existing) throw new Error("Post not found");
  assertCurrentEditBase(input, existing);

  if (!access.canEdit) {
    const user = await getCurrentUser();
    const itemAccess = await resolveItemAccess({
      handle,
      postId: existing.id ?? id,
      user,
    });
    if (!itemAccess.canEditContent) throw new Error("You cannot edit this post");
    const patch = collaboratorContentPatch(input, existing);
    const saved = await savePostContentPatch(handle, existing, patch, {
      expectedRevision: existing.revision,
    });
    await recordAction({
      actorUserId: itemAccess.userId ?? (user ? await getUserIdBySub(user.sub) : null),
      actorType: "human",
      actionName: "share.save_post",
      targetType: "item",
      targetId: saved.id,
      inputSummary: saved.title,
    });
    if (options.revalidate !== false) {
      await revalidateBlog(handle, [existing.slug]);
    }
    return saved;
  }

  await refuseWhileCoEdited(existing.id ?? id);
  const patch = editableInput(input, existing, existing.slug);
  const saved = await savePost(
    handle,
    {
      ...existing,
      ...patch,
      pinned: existing.pinned,
    },
    // The editor's assertCurrentEditBase above is a check-then-write; the
    // revision compare-and-swap makes the save atomic so a concurrent write
    // (another tab, the Mac app, an agent) conflicts instead of being clobbered.
    { expectedRevision: existing.revision },
  );
  await recordSlugChanged({
    actorUserId: access.isOwner ? access.ownerId : null,
    actorType: "human",
    targetId: saved.id,
    oldSlug: existing.slug,
    newSlug: saved.slug,
  });
  await auditEdit(access, "save_post", "item", saved.id, saved.title);
  if (saved.id) await reconcileCollabLogAfterExternalWrite(saved.id);
  if (options.revalidate !== false) {
    await revalidateBlog(handle, [existing.slug, saved.slug]);
  }
  return saved;
}

// MARK: Comments and bookmark recapture

export type ItemCommentView = {
  id: string;
  parentId: string | null;
  body: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
  resolvedAt: string | null;
  anchor: ItemComment["anchor"];
};

function itemCommentView(comment: ItemComment): ItemCommentView {
  const actorLabel =
    comment.author.actorType === "ai"
      ? "AI"
      : comment.author.actorType === "external_agent"
        ? "External agent"
        : "Someone";
  return {
    id: comment.id,
    parentId: comment.parentId,
    body: comment.body,
    authorName: comment.authorName?.trim() || actorLabel,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    resolved: comment.resolved,
    resolvedAt: comment.resolvedAt,
    anchor: comment.anchor,
  };
}

async function storedItemComments(postId: string): Promise<ItemCommentView[]> {
  return (await listItemComments(postId)).map(itemCommentView);
}

function cleanCommentBody(value: unknown): string {
  if (typeof value !== "string") throw new Error("Comment must be text");
  const body = value.replace(/\u0000/g, "").trim();
  if (!body) throw new Error("Write a comment first");
  if (body.length > 4_000) throw new Error("Comments can be up to 4,000 characters");
  return body;
}

async function accessibleItemForComments(
  handleInput: unknown,
  postIdInput: unknown,
  permission: "view" | "edit",
) {
  const handle = cleanHandle(handleInput);
  const postId = cleanPostId(postIdInput);
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in to use comments");
  const access = await resolveItemAccess({ handle, postId, user });
  if (!access.canView) throw new Error("You cannot view comments on this item");
  if (permission === "edit" && !access.canEditContent) {
    throw new Error("You cannot resolve comments on this item");
  }
  const actorUserId =
    access.userId ?? user.userId ?? (await getUserIdBySub(user.sub));
  if (!actorUserId) throw new Error("Your account could not be resolved");
  return { access, actorUserId, handle, postId, user };
}

export async function listItemCommentsAction(
  handleInput: unknown,
  postIdInput: unknown,
): Promise<ItemCommentView[]> {
  const item = await accessibleItemForComments(handleInput, postIdInput, "view");
  return storedItemComments(item.postId);
}

export async function addItemCommentAction(
  handleInput: unknown,
  postIdInput: unknown,
  bodyInput: unknown,
  anchorFieldInput?: unknown,
  anchorExactInput?: unknown,
  anchorStartInput?: unknown,
  anchorEndInput?: unknown,
): Promise<ItemCommentView[]> {
  const item = await accessibleItemForComments(handleInput, postIdInput, "view");
  const body = cleanCommentBody(bodyInput);
  const anchorField =
    anchorFieldInput === "title" ||
    anchorFieldInput === "excerpt" ||
    anchorFieldInput === "body"
      ? anchorFieldInput
      : undefined;
  const anchorExact =
    typeof anchorExactInput === "string" && anchorExactInput.trim()
      ? anchorExactInput.slice(0, 4_000)
      : undefined;
  if ((anchorField && !anchorExact) || (!anchorField && anchorExact)) {
    throw new Error("Anchored comments need a field and quoted text");
  }
  const anchorStart =
    typeof anchorStartInput === "number" && Number.isInteger(anchorStartInput)
      ? anchorStartInput
      : undefined;
  const anchorEnd =
    typeof anchorEndInput === "number" && Number.isInteger(anchorEndInput)
      ? anchorEndInput
      : undefined;
  if ((anchorStart === undefined) !== (anchorEnd === undefined)) {
    throw new Error("Anchored comments need both start and end offsets");
  }
  await createItemComment(
    {
      itemId: item.postId,
      body,
      anchor:
        anchorField && anchorExact
          ? {
              field: anchorField,
              exactQuote: anchorExact,
              ...(anchorStart === undefined ? {} : { start: anchorStart }),
              ...(anchorEnd === undefined ? {} : { end: anchorEnd }),
            }
          : null,
    },
    {
      actorUserId: item.actorUserId,
      actorType: "human",
      actorName:
        item.user.name?.trim() || item.user.email?.split("@")[0] || "Someone",
    },
  );
  await recordAction({
    actorUserId: item.actorUserId,
    actorType: "human",
    actionName: "comment.add",
    targetType: "item",
    targetId: item.postId,
    inputSummary: body,
  });
  return storedItemComments(item.postId);
}

export async function replyItemCommentAction(
  handleInput: unknown,
  postIdInput: unknown,
  parentCommentIdInput: unknown,
  bodyInput: unknown,
): Promise<ItemCommentView[]> {
  const item = await accessibleItemForComments(handleInput, postIdInput, "view");
  const parentId = cleanPostId(parentCommentIdInput);
  const body = cleanCommentBody(bodyInput);
  const comments = await storedItemComments(item.postId);
  const parent = comments.find((comment) => comment.id === parentId);
  if (!parent || parent.parentId) {
    throw new Error("Comment thread not found");
  }
  await createItemComment(
    { itemId: item.postId, parentId, body },
    {
      actorUserId: item.actorUserId,
      actorType: "human",
      actorName:
        item.user.name?.trim() || item.user.email?.split("@")[0] || "Someone",
    },
  );
  await recordAction({
    actorUserId: item.actorUserId,
    actorType: "human",
    actionName: "comment.reply",
    targetType: "item",
    targetId: item.postId,
    inputSummary: `${parentId}: ${body}`,
  });
  return storedItemComments(item.postId);
}

async function setItemCommentResolutionAction(
  handleInput: unknown,
  postIdInput: unknown,
  commentIdInput: unknown,
  resolved: boolean,
): Promise<ItemCommentView[]> {
  const item = await accessibleItemForComments(handleInput, postIdInput, "edit");
  const commentId = cleanPostId(commentIdInput);
  const comments = await storedItemComments(item.postId);
  const comment = comments.find((candidate) => candidate.id === commentId);
  if (!comment || comment.parentId) {
    throw new Error("Comment thread not found");
  }
  await setItemCommentResolved(item.postId, commentId, resolved, {
    actorUserId: item.actorUserId,
    actorType: "human",
    actorName:
      item.user.name?.trim() || item.user.email?.split("@")[0] || "Someone",
  });
  await recordAction({
    actorUserId: item.actorUserId,
    actorType: "human",
    actionName: resolved ? "comment.resolve" : "comment.reopen",
    targetType: "item",
    targetId: item.postId,
    inputSummary: commentId,
  });
  return storedItemComments(item.postId);
}

export async function resolveItemCommentAction(
  handleInput: unknown,
  postIdInput: unknown,
  commentIdInput: unknown,
): Promise<ItemCommentView[]> {
  return setItemCommentResolutionAction(
    handleInput,
    postIdInput,
    commentIdInput,
    true,
  );
}

export async function reopenItemCommentAction(
  handleInput: unknown,
  postIdInput: unknown,
  commentIdInput: unknown,
): Promise<ItemCommentView[]> {
  return setItemCommentResolutionAction(
    handleInput,
    postIdInput,
    commentIdInput,
    false,
  );
}

export async function recaptureBookmarkAction(
  handleInput: unknown,
  postIdInput: unknown,
): Promise<Post> {
  const handle = cleanHandle(handleInput);
  const postId = cleanPostId(postIdInput);
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in to recapture bookmarks");
  const access = await resolveItemAccess({ handle, postId, user });
  if (!access.isOwner) throw new Error("Only the owner can recapture bookmarks");
  const post = await getPostById(handle, postId);
  if (!post || post.type !== "bookmark") throw new Error("Bookmark not found");
  const url = cleanBookmarkUrl(post.links?.[0]?.href ?? post.capture?.url);
  const pending = await markCapturePending(handle, postId, url.toString());
  if (!pending) throw new Error("Bookmark not found");
  await recordAction({
    actorUserId:
      access.userId ?? user.userId ?? (await getUserIdBySub(user.sub)),
    actorType: "human",
    actionName: "recapture_bookmark",
    targetType: "item",
    targetId: postId,
    inputSummary: url.toString(),
  });
  await revalidateBlog(handle, [post.slug]);
  return pending;
}

// MARK: Item covers and assets

async function ownedItemForAssets(handleInput: unknown, postIdInput: unknown) {
  const item = await accessibleItemForComments(handleInput, postIdInput, "view");
  if (!item.access.isOwner) throw new Error("Only the owner can manage item assets");
  const post = await getPostById(item.handle, item.postId);
  if (!post?.id) throw new Error("Item not found");
  return { ...item, post };
}

function cleanAssetUrl(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const candidate = value.trim();
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
  return url.toString();
}

function cleanAssetPlacement(value: unknown): ItemAssetPlacement {
  if (value === "cover" || value === "body_end" || value === "gallery") {
    return value;
  }
  throw new Error("Asset placement is not supported");
}

function cleanOptionalAssetText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("Asset text must be text");
  return value.replace(/\u0000/g, "").trim().slice(0, max) || undefined;
}

async function saveAssetPost(
  handle: string,
  post: Post,
  actionName: string,
  summary?: string,
): Promise<Post> {
  const saved = await savePost(handle, post, {
    preservePublishedAt: true,
    ...(typeof post.revision === "number"
      ? { expectedRevision: post.revision }
      : {}),
  });
  const user = await getCurrentUser();
  await recordAction({
    actorUserId: user
      ? user.userId ?? (await getUserIdBySub(user.sub))
      : null,
    actorType: "human",
    actionName,
    targetType: "item",
    targetId: saved.id,
    inputSummary: summary,
  });
  await revalidateBlog(handle, [saved.slug]);
  return saved;
}

export async function listItemAssetsAction(
  handleInput: unknown,
  postIdInput: unknown,
): Promise<ItemAssetReference[]> {
  const item = await accessibleItemForComments(handleInput, postIdInput, "view");
  const post = await getPostById(item.handle, item.postId);
  if (!post) throw new Error("Item not found");
  return listItemAssetReferences(post);
}

export async function addItemAssetAction(
  handleInput: unknown,
  postIdInput: unknown,
  sourceUrlInput: unknown,
  placementInput: unknown,
  altTextInput?: unknown,
  captionInput?: unknown,
): Promise<{ asset: ItemAssetReference; post: Post }> {
  const item = await ownedItemForAssets(handleInput, postIdInput);
  const placement = cleanAssetPlacement(placementInput);
  const sourceUrl = cleanAssetUrl(sourceUrlInput, "Asset URL");
  const altText = cleanOptionalAssetText(altTextInput, 500);
  const caption = cleanOptionalAssetText(captionInput, 2_000);
  const asset = await importItemAssetFromUrl({
    handle: item.handle,
    itemId: item.postId,
    sourceUrl,
    media: placement === "cover" ? "image" : "image-or-video",
  });
  const saved = await saveAssetPost(
    item.handle,
    attachItemAsset(item.post, asset, placement, { altText, caption }),
    "add_item_asset",
    `${placement}: ${asset.filename} (${asset.bytes} bytes)`,
  );
  return {
    asset: {
      url: asset.url,
      role: placement === "body_end" ? "body" : placement,
      contentType: asset.contentType,
      filename: asset.filename,
      originalUrl: asset.sourceUrl,
      altText,
      caption,
    },
    post: saved,
  };
}

export async function removeItemAssetAction(
  handleInput: unknown,
  postIdInput: unknown,
  assetUrlInput: unknown,
): Promise<{ changed: boolean; post: Post }> {
  const item = await ownedItemForAssets(handleInput, postIdInput);
  const assetUrl = cleanAssetUrl(assetUrlInput, "Asset URL");
  const removed = removeItemAssetReferences(item.post, assetUrl);
  if (!removed.changed) return { changed: false, post: item.post };
  const saved = await saveAssetPost(
    item.handle,
    removed.post,
    "remove_item_asset",
    assetUrl,
  );
  return { changed: true, post: saved };
}

export async function setItemCoverAction(
  handleInput: unknown,
  postIdInput: unknown,
  sourceInput: unknown,
  urlInput?: unknown,
  captionInput?: unknown,
  heightInput?: unknown,
): Promise<Post> {
  const item = await ownedItemForAssets(handleInput, postIdInput);
  if (sourceInput !== "url" && sourceInput !== "auto" && sourceInput !== "none") {
    throw new Error("Cover source is not supported");
  }
  const url = sourceInput === "url" ? cleanAssetUrl(urlInput, "Cover URL") : undefined;
  if (
    url &&
    !listItemAssetReferences(item.post).some((asset) => asset.url === url)
  ) {
    throw new Error("Import or attach that asset before using it as the cover");
  }
  const caption =
    captionInput === null
      ? undefined
      : cleanOptionalAssetText(captionInput, 2_000) ?? item.post.coverCaption;
  const height =
    heightInput === null
      ? undefined
      : typeof heightInput === "number" && Number.isInteger(heightInput)
        ? Math.min(860, Math.max(180, heightInput))
        : item.post.coverHeight;
  return saveAssetPost(
    item.handle,
    {
      ...item.post,
      cover:
        sourceInput === "url"
          ? url
          : sourceInput === "none"
            ? NO_COVER_VALUE
            : undefined,
      coverCaption: caption,
      coverHeight: height,
    },
    "set_item_cover",
    String(sourceInput),
  );
}

// MARK: Sharing

function cleanScopeType(value: unknown): CollaboratorScopeType {
  if (value === "workspace" || value === "folder" || value === "item") {
    return value;
  }
  throw new Error("Share scope not found");
}

function cleanScopeRole(
  scopeType: CollaboratorScopeType,
  value: unknown,
): ScopeShareRole {
  if (scopeType === "workspace") {
    return isWorkspaceMemberRole(value) ? value : "guest";
  }
  return isItemShareRole(value) ? value : "viewer";
}

async function manageableScopeForSharing(
  handleInput: unknown,
  scopeTypeInput: unknown,
  scopeIdInput: unknown,
) {
  const handle = cleanHandle(handleInput);
  const scopeType = cleanScopeType(scopeTypeInput);
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in to share");
  const access = await getBlogEditAccess(handle);
  const workspaceAccess = await resolveWorkspaceAccess({ handle, user });
  if (!access.isOwner && !workspaceAccess.canManage) {
    throw new Error("Only the owner can share");
  }

  if (scopeType === "workspace") {
    if (!access.blogId) throw new Error("Workspace not found");
    return { handle, scopeType, scopeId: access.blogId, user, post: null };
  }

  if (scopeType === "folder") {
    const scopeId = cleanPostId(scopeIdInput);
    const folder = (await getFolders(handle)).find((entry) => entry.id === scopeId);
    if (!folder) throw new Error("Folder not found");
    return { handle, scopeType, scopeId: folder.id, user, post: null };
  }

  const postId = cleanPostId(scopeIdInput);
  const post = await getPostById(handle, postId);
  if (!post?.id) throw new Error("Post not found");
  return { handle, scopeType, scopeId: post.id, user, post };
}

async function ownedPostForSharing(handleInput: unknown, postIdInput: unknown) {
  const scope = await manageableScopeForSharing(handleInput, "item", postIdInput);
  if (!scope.post) throw new Error("Post not found");
  return { handle: scope.handle, post: scope.post };
}

export async function shareScopeAction(
  handleInput: unknown,
  scopeTypeInput: unknown,
  scopeIdInput: unknown,
  emailInput: unknown,
  roleInput: unknown,
): Promise<ScopeShare[]> {
  const scope = await manageableScopeForSharing(
    handleInput,
    scopeTypeInput,
    scopeIdInput,
  );
  const email = typeof emailInput === "string" ? emailInput : "";
  const role = cleanScopeRole(scope.scopeType, roleInput);
  const share = await inviteScopeShare({
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    email,
    role,
    invitedBySub: scope.user.sub,
  });
  if (scope.scopeType === "item" && scope.post) {
    void sendShareInviteEmail({
      to: share.email,
      role: role === "editor" ? "editor" : "viewer",
      post: scope.post,
      handle: scope.handle,
      inviterName: scope.user.name ?? scope.user.email ?? "Someone",
    }).catch((error) => console.warn("share invite email failed", error));
  }
  return listScopeShares(scope.scopeType, scope.scopeId);
}

export async function updateScopeShareRoleAction(
  handleInput: unknown,
  scopeTypeInput: unknown,
  scopeIdInput: unknown,
  shareIdInput: unknown,
  roleInput: unknown,
): Promise<ScopeShare[]> {
  const scope = await manageableScopeForSharing(
    handleInput,
    scopeTypeInput,
    scopeIdInput,
  );
  const shareId = cleanPostId(shareIdInput);
  await updateScopeShareRole({
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    shareId,
    role: cleanScopeRole(scope.scopeType, roleInput),
    updatedBySub: scope.user.sub,
  });
  return listScopeShares(scope.scopeType, scope.scopeId);
}

export async function revokeScopeShareAction(
  handleInput: unknown,
  scopeTypeInput: unknown,
  scopeIdInput: unknown,
  shareIdInput: unknown,
): Promise<ScopeShare[]> {
  const scope = await manageableScopeForSharing(
    handleInput,
    scopeTypeInput,
    scopeIdInput,
  );
  const shareId = cleanPostId(shareIdInput);
  await revokeScopeShare(scope.scopeType, scope.scopeId, shareId, scope.user.sub);
  return listScopeShares(scope.scopeType, scope.scopeId);
}

export async function listScopeSharesAction(
  handleInput: unknown,
  scopeTypeInput: unknown,
  scopeIdInput: unknown,
): Promise<ScopeShare[]> {
  const scope = await manageableScopeForSharing(
    handleInput,
    scopeTypeInput,
    scopeIdInput,
  );
  return listScopeShares(scope.scopeType, scope.scopeId);
}

export async function sharePostAction(
  handleInput: unknown,
  postIdInput: unknown,
  emailInput: unknown,
  roleInput: unknown,
): Promise<PostShare[]> {
  const role: ShareRole = roleInput === "editor" ? "editor" : "viewer";
  await shareScopeAction(handleInput, "item", postIdInput, emailInput, role);
  const { post } = await ownedPostForSharing(handleInput, postIdInput);
  return listPostShares(post.id!);
}

export async function revokePostShareAction(
  handleInput: unknown,
  postIdInput: unknown,
  shareIdInput: unknown,
): Promise<PostShare[]> {
  const { post } = await ownedPostForSharing(handleInput, postIdInput);
  const user = await getCurrentUser();
  if (!user) throw new Error("Sign in to share");
  const shareId = cleanPostId(shareIdInput);
  await revokePostShare(post.id!, shareId, user.sub);
  return listPostShares(post.id!);
}

export async function listPostSharesAction(
  handleInput: unknown,
  postIdInput: unknown,
): Promise<PostShare[]> {
  const { post } = await ownedPostForSharing(handleInput, postIdInput);
  return listPostShares(post.id!);
}

// MARK: Folders

export async function createSubfolderAction(
  handleInput: unknown,
  parentPathInput: unknown,
  nameInput: unknown,
): Promise<Folder> {
  const { handle, access } = await editableHandleFor(handleInput);
  const parentPath =
    typeof parentPathInput === "string" ? parentPathInput.trim() : "";
  const name = typeof nameInput === "string" ? nameInput : "";
  const folder = await createSubfolder(handle, parentPath, name);
  await auditEdit(access, "create_folder", "workspace", folder.id, folder.path);
  await revalidateBlog(handle);
  return folder;
}

export async function renameFolderAction(
  handleInput: unknown,
  folderIdInput: unknown,
  nameInput: unknown,
): Promise<Folder> {
  const { handle, access } = await editableHandleFor(handleInput);
  const folderId = cleanPostId(folderIdInput);
  const name = typeof nameInput === "string" ? nameInput : "";
  const folder = await renameFolder(handle, folderId, name);
  await auditEdit(access, "rename_folder", "workspace", folder.id, folder.name);
  await revalidateBlog(handle);
  return folder;
}

export async function trashFolderAction(
  handleInput: unknown,
  folderIdInput: unknown,
): Promise<{ folderId: string }> {
  const { handle, access } = await editableHandleFor(handleInput);
  const folderId = cleanPostId(folderIdInput);
  await trashFolder(handle, folderId);
  await auditEdit(access, "trash_folder", "workspace", folderId);
  await revalidateBlog(handle);
  return { folderId };
}

export async function restoreFolderAction(
  handleInput: unknown,
  folderIdInput: unknown,
): Promise<{ folderId: string }> {
  const { handle, access } = await editableHandleFor(handleInput);
  const folderId = cleanPostId(folderIdInput);
  await restoreFolder(handle, folderId);
  await auditEdit(access, "restore_folder", "workspace", folderId);
  await revalidateBlog(handle);
  return { folderId };
}

export async function permanentlyDeleteFolderAction(
  handleInput: unknown,
  folderIdInput: unknown,
): Promise<{ folderId: string }> {
  const { handle, access } = await editableHandleFor(handleInput);
  const folderId = cleanPostId(folderIdInput);
  await permanentlyDeleteFolder(handle, folderId);
  await auditEdit(access, "permanently_delete_folder", "workspace", folderId);
  await revalidateBlog(handle);
  return { folderId };
}

export async function movePostToFolderAction(
  handleInput: unknown,
  postIdInput: unknown,
  folderPathInput: unknown,
): Promise<Post> {
  const { handle, access } = await editableHandleFor(handleInput);
  const postId = cleanPostId(postIdInput);
  const folderPath =
    typeof folderPathInput === "string" ? folderPathInput.trim() : "";
  if (!postId) throw new Error("Post not found");
  const moved = await setPostFolder(handle, postId, folderPath);
  if (!moved) throw new Error("Post not found");
  await auditEdit(access, "move_post", "item", moved.id, folderPath);
  await revalidateBlog(handle, [moved.slug]);
  return moved;
}

export async function toggleEditablePostPinnedAction(
  handleOrId: unknown,
  maybeId?: unknown,
): Promise<Post> {
  const { handle, access } = await editableHandleFor(
    maybeId === undefined ? undefined : handleOrId,
  );
  const id = maybeId === undefined ? handleOrId : maybeId;
  const postId = cleanPostId(id);
  const existing = await getPostById(handle, postId);
  if (!existing) throw new Error("Post not found");
  const saved = await setPostPinned(handle, postId, !existing.pinned);
  await auditEdit(
    access,
    saved.pinned ? "pin_post" : "unpin_post",
    "item",
    saved.id,
    saved.title,
  );
  await revalidateBlog(handle, [existing.slug]);
  return saved;
}

export async function setEditablePostCreatedAtAction(
  handleInput: unknown,
  postIdInput: unknown,
  dateInput: unknown,
): Promise<Post> {
  const { handle, access } = await editableHandleFor(handleInput);
  const postId = cleanPostId(postIdInput);
  const date = typeof dateInput === "string" ? dateInput.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Choose a valid date");
  const saved = await setPostCreatedAt(
    handle,
    postId,
    new Date(`${date}T12:00:00.000Z`),
  );
  await auditEdit(access, "change_post_date", "item", saved.id, date);
  await revalidateBlog(handle, [saved.slug]);
  return saved;
}

export async function setEditablePostStatusAction(
  handleInput: unknown,
  postIdInput: unknown,
  statusInput: unknown,
): Promise<Post> {
  const { handle, access } = await editableHandleFor(handleInput);
  const postId = cleanPostId(postIdInput);
  const existing = await getPostById(handle, postId);
  if (!existing) throw new Error("Post not found");
  const status = isUnlistedPostType(existing.type)
    ? ("draft" as const)
    : cleanStatus(statusInput);
  const saved = await savePost(
    handle,
    { ...existing, status },
    { expectedRevision: existing.revision },
  );
  await auditEdit(
    access,
    status === "published" ? "publish_post" : "unpublish_post",
    "item",
    saved.id,
    saved.title,
  );
  await revalidateBlog(handle, [existing.slug, saved.slug]);
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
  await auditEdit(access, "delete_post", "item", postId, existing.title);
  await revalidateBlog(handle, [existing.slug]);
  return { handle };
}

export async function restoreEditablePostAction(
  handleInput: unknown,
  postIdInput: unknown,
): Promise<Post> {
  const { handle, access } = await editableHandleFor(handleInput);
  const postId = cleanPostId(postIdInput);
  const restored = await restorePost(handle, postId);
  await auditEdit(access, "restore_post", "item", postId, restored.title);
  await revalidateBlog(handle, [restored.slug]);
  return restored;
}

export async function permanentlyDeleteEditablePostAction(
  handleInput: unknown,
  postIdInput: unknown,
): Promise<{ postId: string }> {
  const { handle, access } = await editableHandleFor(handleInput);
  const postId = cleanPostId(postIdInput);
  await permanentlyDeletePost(handle, postId);
  await auditEdit(access, "permanently_delete_post", "item", postId);
  await revalidateBlog(handle);
  return { postId };
}

export async function emptyTrashAction(
  handleInput: unknown,
): Promise<{ removed: number }> {
  const { handle, access } = await editableHandleFor(handleInput);
  const removed = await emptyTrash(handle);
  await auditEdit(access, "empty_trash", "workspace", handle, `${removed} items`);
  await revalidateBlog(handle);
  return { removed };
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
    await auditEdit(
      access,
      "trash_workspace_posts",
      "workspace",
      access.blogId,
      `${existingPosts.length} posts`,
    );
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
    await auditEdit(access, "rename_blog", "workspace", access.blogId, updated.name);
    await revalidateBlog(handle, [], updated);
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
    await recordAction({
      actorType: "human",
      actionName: "claim_workspace",
      targetType: "workspace",
      targetId: access.blogId,
      inputSummary: blog.handle,
    });
    await revalidateBlog(handle, [], blog);
    return { ok: true, handle: blog.handle };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Could not claim") };
  }
}
