"use client";

import {
  addItemAssetAction,
  addItemCommentAction,
  createSubfolderAction,
  createWorkspacePostAction,
  deleteEditablePostAction,
  listItemAssetsAction,
  listItemCommentsAction,
  listScopeSharesAction,
  movePostToFolderAction,
  recaptureBookmarkAction,
  renameFolderAction,
  removeItemAssetAction,
  replyItemCommentAction,
  reopenItemCommentAction,
  restoreFolderAction,
  restoreEditablePostAction,
  revokeScopeShareAction,
  saveEditablePostAction,
  setEditablePostStatusAction,
  shareScopeAction,
  resolveItemCommentAction,
  toggleEditablePostPinnedAction,
  trashFolderAction,
} from "@/app/editor/actions";
import {
  WORKSPACE_FOLDER_MODES,
  WORKSPACE_SCOPE_CAPABILITIES,
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
  isWorkspaceToolName,
  parseWorkspaceToolInput,
} from "@/lib/ai/tools";
import type { WorkspaceToolInput, WorkspaceToolName } from "@/lib/ai/tools";
import type { NativeAgentToolExecutor } from "@/lib/ai/native";
import type {
  WorkspaceItemTextPatch,
  WorkspaceItemTextSnapshot,
} from "@/lib/ai/workspace-item-draft";
import { isPrivatePostType } from "@/lib/content";
import type { Post, PostType } from "@/lib/content";
import { NO_COVER_VALUE } from "@/lib/cover";
import { normalizeTags } from "@/lib/tags";
import {
  folderModeForPostType,
  itemKindForPostType,
  parsePostMarkdownFile,
  postTypeForItemKind,
} from "@/lib/markdown-files";
import {
  initialDraft,
  isPlaceholderSlug,
  payloadFor,
  slugify,
  uniqueSlug,
} from "@/lib/post-edit-draft";
import {
  addPost,
  ensurePostBody,
  getCachedWorkspacePostBody,
  moveFolderToTrash,
  movePost,
  movePostToTrash,
  restoreFolderFromTrash,
  restorePostFromTrash,
  seedWorkspacePool,
  updateFolder,
  updatePost,
} from "@/lib/pool/store";
import {
  findPoolPostById,
  folderPathForPoolPost,
  poolPostsForFolder,
  postFromPoolPost,
} from "@/lib/pool/selectors";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";

export const WORKSPACE_AGENT_TOOL_NAMES = WORKSPACE_TOOL_NAMES;

export const WORKSPACE_AGENT_TOOL_DEFINITIONS = WORKSPACE_TOOL_NAMES.map((name) => {
  const definition = WORKSPACE_TOOL_DEFINITIONS[name];
  return Object.freeze({
    name,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.jsonSchema,
    mutability: definition.mutability,
    confirmation: definition.confirmation,
    annotations: definition.annotations,
  });
});

type ToolArgs = Record<string, unknown>;

export type WorkspaceAgentToolsOptions = {
  handle: string;
  getPool: () => WorkspacePoolPayload | null;
  readItemText?: (postId: string) => Promise<WorkspaceItemTextSnapshot>;
  applyItemPatch?: (
    postId: string,
    patch: WorkspaceItemTextPatch,
  ) => Promise<unknown> | unknown;
  /** Required for soft deletion and audience-changing restore/status calls. */
  confirmDestructive?: (description: string) => Promise<boolean> | boolean;
};

function normalizeFolderPath(
  raw: string,
  folders: Array<{ path: string }>,
): string {
  const exact = folders.find((folder) => folder.path === raw);
  if (exact) return raw;
  const cleaned = raw.toLowerCase().match(/^[a-z0-9/_-]+/)?.[0] ?? "";
  const cleanedMatch = folders.find((folder) => folder.path === cleaned);
  if (cleanedMatch) return cleaned;
  const prefix = folders.find(
    (folder) =>
      cleaned.startsWith(folder.path) || folder.path.startsWith(cleaned),
  );
  return prefix?.path ?? raw;
}

function defaultBlogFolderPath(
  folders: Array<{ path: string; mode?: string }>,
): string {
  const exact = folders.find(
    (folder) => folder.path === "blog" && folder.mode === "blog",
  );
  if (exact) return exact.path;
  const blogFolders = folders
    .filter((folder) => folder.mode === "blog")
    .sort((left, right) => {
      const depth = left.path.split("/").length - right.path.split("/").length;
      return depth || left.path.localeCompare(right.path);
    });
  return blogFolders[0]?.path ?? "blog";
}

function normalizeLegacyNativeArgs(
  name: WorkspaceToolName,
  args: ToolArgs,
  folders: Array<{ path: string; mode?: string }>,
): ToolArgs {
  const normalized = { ...args };
  if (
    (name === "list_items" || name === "create_item" || name === "move_item") &&
    normalized.folder_path === undefined &&
    typeof normalized.folder === "string"
  ) {
    normalized.folder_path = normalizeFolderPath(normalized.folder, folders);
  }
  if (
    name === "create_item" &&
    (typeof normalized.folder_path !== "string" ||
      !normalized.folder_path.trim())
  ) {
    normalized.folder_path = defaultBlogFolderPath(folders);
  }
  if (
    name === "append_to_item" &&
    normalized.markdown_fragment === undefined &&
    typeof normalized.markdown === "string"
  ) {
    normalized.markdown_fragment = normalized.markdown;
  }
  delete normalized.folder;
  if (name === "append_to_item") delete normalized.markdown;
  return normalized;
}

function capped(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function itemKind(type: PostType) {
  return itemKindForPostType(type);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function poolPostFromPost(post: Post, blogId: string): WorkspacePoolPost | null {
  if (!post.id) return null;
  return {
    id: post.id,
    blogId,
    folderId: post.folderId,
    type: post.type,
    captureStatus: post.captureStatus,
    capture: post.capture,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    accent: post.accent,
    cover: post.cover,
    coverCaption: post.coverCaption,
    coverHeight: post.coverHeight,
    gallery: post.gallery,
    links: post.links,
    tags: normalizeTags(post.tags),
    videoUrl: post.videoUrl,
    venue: post.venue,
    duration: post.duration,
    wordCount: post.wordCount,
    readingTime: post.readingTime,
    date: post.date,
    publishedAt: post.status === "published" ? post.date : undefined,
    status: post.status,
    pinned: post.pinned,
    starred: post.starred,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

const createdByRequest = new Map<string, Map<string, unknown>>();
const CREATED_REQUEST_LIMIT = 8;

function requestCreates(tag: string): Map<string, unknown> {
  const existing = createdByRequest.get(tag);
  if (existing) return existing;
  const created = new Map<string, unknown>();
  createdByRequest.set(tag, created);
  while (createdByRequest.size > CREATED_REQUEST_LIMIT) {
    const oldest = createdByRequest.keys().next().value;
    if (oldest === undefined) break;
    createdByRequest.delete(oldest);
  }
  return created;
}

async function readBody(blogId: string, postId: string): Promise<string> {
  const cached = getCachedWorkspacePostBody(blogId, postId);
  if (cached) return cached.body;
  await ensurePostBody(blogId, postId);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const entry = getCachedWorkspacePostBody(blogId, postId);
    if (entry) return entry.body;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Could not load the item body");
}

function searchSnippet(text: string, query: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const index = normalized.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return capped(normalized, 180);
  const start = Math.max(0, index - 70);
  const end = Math.min(normalized.length, index + query.length + 100);
  return `${start > 0 ? "..." : ""}${normalized.slice(start, end)}${
    end < normalized.length ? "..." : ""
  }`;
}

export function createWorkspaceAgentTools(options: WorkspaceAgentToolsOptions): {
  executor: NativeAgentToolExecutor;
  toolNames: WorkspaceToolName[];
  toolDefinitions: typeof WORKSPACE_AGENT_TOOL_DEFINITIONS;
  describeContext: (view?: {
    level?: string;
    folderPath?: string;
    postId?: string;
  }) => string;
} {
  const {
    handle,
    getPool,
    readItemText,
    applyItemPatch,
    confirmDestructive,
  } = options;

  function pool(): WorkspacePoolPayload {
    const current = getPool();
    if (!current) throw new Error("The workspace is not loaded yet");
    return current;
  }

  function requirePost(id: string): WorkspacePoolPost {
    const post = findPoolPostById(pool(), id);
    if (!post) throw new Error(`No item with id ${id}`);
    return post;
  }

  function requireTrashedPost(id: string): WorkspacePoolPost {
    const post = (pool().trashedPosts ?? []).find((entry) => entry.id === id);
    if (!post) throw new Error(`No item with id ${id} exists in Trash`);
    return post;
  }

  function requireFolder(id: string) {
    const folder = pool().folders.find((entry) => entry.id === id);
    if (!folder) throw new Error(`No folder with id ${id}`);
    return folder;
  }

  function requireTrashedFolder(id: string) {
    const folder = (pool().trashedFolders ?? []).find((entry) => entry.id === id);
    if (!folder) throw new Error(`No folder with id ${id} exists in Trash`);
    return folder;
  }

  function syncPost(post: Post) {
    const mapped = poolPostFromPost(post, pool().blogId);
    if (mapped) updatePost(mapped.id, mapped);
  }

  function addFolderToPool(folder: WorkspacePoolPayload["folders"][number]) {
    const current = pool();
    if (current.folders.some((entry) => entry.id === folder.id)) return;
    seedWorkspacePool({
      ...current,
      folders: [...current.folders, folder],
      counts: { ...current.counts, [folder.path]: 0 },
      fetchedAt: new Date().toISOString(),
    });
  }

  async function currentText(post: WorkspacePoolPost) {
    return readItemText
      ? await readItemText(post.id)
      : {
          title: post.title,
          excerpt: post.excerpt ?? "",
          body: await readBody(pool().blogId, post.id),
          tags: normalizeTags(post.tags),
        };
  }

  async function saveDraftPatch(
    poolPost: WorkspacePoolPost,
    patch: WorkspaceItemTextPatch,
  ) {
    const current = await currentText(poolPost);
    if (applyItemPatch) {
      await applyItemPatch(poolPost.id, patch);
      return {
        ...postFromPoolPost(poolPost, patch.body ?? current.body),
        title: patch.title ?? current.title,
        excerpt: patch.excerpt ?? current.excerpt,
        tags: normalizeTags(patch.tags ?? poolPost.tags),
      };
    }

    const post = postFromPoolPost(poolPost, patch.body ?? current.body);
    const draft = initialDraft(post);
    if (patch.title !== undefined) draft.title = patch.title;
    if (patch.excerpt !== undefined) draft.excerpt = patch.excerpt;
    if (patch.body !== undefined) draft.body = patch.body;
    if (patch.tags !== undefined) draft.tags = normalizeTags(patch.tags);
    if (patch.title && isPlaceholderSlug(draft.slug)) {
      const used = pool()
        .posts.filter((candidate) => candidate.id !== poolPost.id)
        .map((candidate) => candidate.slug);
      draft.slug = uniqueSlug(slugify(patch.title, "post"), used);
    }
    const saved = await saveEditablePostAction(
      handle,
      payloadFor(poolPost.id, draft, poolPost.slug, poolPost.updatedAt),
    );
    syncPost(saved);
    return saved;
  }

  async function saveCreatedItem(
    poolPost: WorkspacePoolPost,
    input: {
      type: PostType;
      title?: string;
      excerpt?: string;
      body: string;
      slug?: string;
      accent?: string;
      cover?: string;
      coverCaption?: string;
      coverHeight?: number;
      videoUrl?: string;
      venue?: string;
      duration?: string;
      tags?: string[];
    },
  ) {
    const draft = initialDraft(postFromPoolPost(poolPost, input.body));
    draft.type = input.type;
    draft.title = input.title ?? draft.title;
    draft.excerpt = input.excerpt ?? "";
    draft.body = input.body;
    draft.slug = input.slug ?? draft.slug;
    draft.accent = input.accent ?? draft.accent;
    draft.cover = input.cover ?? draft.cover;
    draft.coverCaption = input.coverCaption ?? draft.coverCaption;
    draft.coverHeight = input.coverHeight ?? draft.coverHeight;
    draft.videoUrl = input.videoUrl ?? draft.videoUrl;
    draft.venue = input.venue ?? draft.venue;
    draft.duration = input.duration ?? draft.duration;
    draft.tags = normalizeTags(input.tags ?? draft.tags);
    draft.status = "draft";
    if (input.title && isPlaceholderSlug(draft.slug)) {
      const used = pool()
        .posts.filter((candidate) => candidate.id !== poolPost.id)
        .map((candidate) => candidate.slug);
      draft.slug = uniqueSlug(slugify(input.title, "post"), used);
    }
    const saved = await saveEditablePostAction(
      handle,
      payloadFor(poolPost.id, draft, poolPost.slug, poolPost.updatedAt),
    );
    syncPost(saved);
    return saved;
  }

  async function saveItemUpdate(
    poolPost: WorkspacePoolPost,
    input: Omit<
      WorkspaceToolInput<"update_item">,
      "id" | "markdown" | "if_match_hash"
    >,
  ) {
    if (input.date !== undefined && poolPost.status !== "published") {
      throw new Error("Publication date can only be set on a published item");
    }
    const text = await currentText(poolPost);
    const draft = initialDraft(postFromPoolPost(poolPost, text.body));
    draft.title = input.title ?? text.title;
    draft.excerpt =
      input.excerpt === null ? "" : (input.excerpt ?? text.excerpt);
    draft.body = input.body ?? text.body;
    if (input.slug !== undefined) draft.slug = input.slug;
    if (input.accent !== undefined) draft.accent = input.accent ?? "";
    if (input.cover !== undefined) draft.cover = input.cover ?? "";
    if (input.cover_caption !== undefined) {
      draft.coverCaption = input.cover_caption ?? "";
    }
    if (input.cover_height !== undefined) {
      draft.coverHeight = input.cover_height;
    }
    if (input.date !== undefined) draft.date = input.date;
    if (input.tags !== undefined) draft.tags = normalizeTags(input.tags);
    if (
      draft.cover !== poolPost.cover &&
      draft.cover &&
      draft.cover !== NO_COVER_VALUE
    ) {
      const assets = await listItemAssetsAction(handle, poolPost.id);
      if (!assets.some((asset) => asset.url === draft.cover)) {
        throw new Error("Import or attach that asset before using it as the cover");
      }
    }
    const pinChanged =
      input.pinned !== undefined && input.pinned !== Boolean(poolPost.pinned);
    const saveRequested = Object.entries(input).some(
      ([key, value]) => key !== "pinned" && value !== undefined,
    );
    let saved = saveRequested
      ? await saveEditablePostAction(
          handle,
          payloadFor(poolPost.id, draft, poolPost.slug, poolPost.updatedAt),
        )
      : postFromPoolPost(poolPost, text.body);
    if (pinChanged) {
      saved = await toggleEditablePostPinnedAction(handle, poolPost.id);
    }
    syncPost(saved);
    return saved;
  }

  async function confirmTool(
    name: WorkspaceToolName,
    input: Record<string, unknown>,
  ): Promise<boolean> {
    if (WORKSPACE_TOOL_DEFINITIONS[name].confirmation === "none") return true;
    if (!confirmDestructive) return false;

    if (name === "delete_folder" || name === "restore_folder") {
      const folderId = typeof input.folder_id === "string" ? input.folder_id : "";
      const folder =
        name === "restore_folder"
          ? requireTrashedFolder(folderId)
          : requireFolder(folderId);
      return await confirmDestructive(
        name === "delete_folder"
          ? `Move the "${folder.name}" folder and its contents to Trash?`
          : `Restore the "${folder.name}" folder and its contents?`,
      );
    }

    if (name === "set_access" || name === "revoke_access") {
      const scope = String(input.scope_type ?? "workspace");
      const description =
        name === "set_access"
          ? `Give ${String(input.email ?? "this person")} ${String(input.role ?? "access")} access to this ${scope}?`
          : `Revoke this ${scope} access grant?`;
      return await confirmDestructive(description);
    }

    const id = typeof input.id === "string" ? input.id : "";
    const post = name === "restore_item" ? requireTrashedPost(id) : requirePost(id);
    if (
      name === "restore_item" &&
      post.status === "published" &&
      isPrivatePostType(post.type)
    ) {
      throw new Error("Notes and bookmarks must be unlisted before restoration");
    }
    if (
      name === "set_item_status" &&
      input.status === "published" &&
      isPrivatePostType(post.type)
    ) {
      throw new Error("Notes and bookmarks are always unlisted");
    }
    const title = post.title || "Untitled";
    const description =
      name === "delete_item"
        ? `Move "${title}" to Trash?`
        : name === "restore_item"
          ? `Restore "${title}"${post.status === "published" ? " and make it public again" : ""}?`
          : name === "set_item_status"
            ? `${input.status === "published" ? "Publish" : "Unpublish"} "${title}"?`
            : name === "remove_item_asset"
              ? `Remove this asset from "${title}"?`
              : `Apply this change to "${title}"?`;
    return await confirmDestructive(description);
  }

  const executor: NativeAgentToolExecutor = async (rawName, rawArgs, requestTag) => {
    if (!isWorkspaceToolName(rawName)) throw new Error(`Unknown tool: ${rawName}`);
    const normalized = normalizeLegacyNativeArgs(rawName, rawArgs, pool().folders);
    const args = parseWorkspaceToolInput(rawName, normalized);
    if (!(await confirmTool(rawName, args as Record<string, unknown>))) {
      return { ok: false, cancelled: true };
    }

    switch (rawName) {
      case "get_workspace": {
        const current = pool();
        return {
          workspace: {
            id: current.blogId,
            handle: current.blog.handle,
            username: current.blog.username ?? null,
            name: current.blog.name,
            author: current.blog.author,
          },
          capabilities: {
            folderModes: WORKSPACE_FOLDER_MODES,
            scopes: WORKSPACE_SCOPE_CAPABILITIES,
            permanentDeletion: false,
            memberManagement: true,
            accessManagement: true,
            comments: true,
            bookmarkRecapture: true,
            itemAssets: true,
          },
        };
      }

      case "list_folders": {
        const current = pool();
        return {
          folders: current.folders.map((folder) => ({
            id: folder.id,
            path: folder.path,
            name: folder.name,
            mode: folder.mode,
            parentId: folder.parentId ?? null,
            items: current.posts.filter((post) => post.folderId === folder.id)
              .length,
          })),
        };
      }

      case "create_folder": {
        const input = args as WorkspaceToolInput<"create_folder">;
        const folder = await createSubfolderAction(
          handle,
          input.parent_path,
          input.name,
        );
        addFolderToPool(folder);
        return { ok: true, folder };
      }

      case "rename_folder": {
        const input = args as WorkspaceToolInput<"rename_folder">;
        if (!pool().folders.some((folder) => folder.id === input.folder_id)) {
          throw new Error("Folder not found");
        }
        const folder = await renameFolderAction(handle, input.folder_id, input.name);
        updateFolder(folder.id, folder);
        return { ok: true, folder };
      }

      case "delete_folder": {
        const input = args as WorkspaceToolInput<"delete_folder">;
        requireFolder(input.folder_id);
        moveFolderToTrash(input.folder_id);
        try {
          await trashFolderAction(handle, input.folder_id);
        } catch (error) {
          restoreFolderFromTrash(input.folder_id);
          throw error;
        }
        return { ok: true, folder_id: input.folder_id, trashed: true };
      }

      case "restore_folder": {
        const input = args as WorkspaceToolInput<"restore_folder">;
        requireTrashedFolder(input.folder_id);
        restoreFolderFromTrash(input.folder_id);
        try {
          await restoreFolderAction(handle, input.folder_id);
        } catch (error) {
          moveFolderToTrash(input.folder_id);
          throw error;
        }
        return { ok: true, folder_id: input.folder_id, restored: true };
      }

      case "list_items": {
        const input = args as WorkspaceToolInput<"list_items">;
        const folderPath = normalizeFolderPath(
          input.folder_path ?? "blog",
          pool().folders,
        );
        const items = poolPostsForFolder(pool(), folderPath).slice(
          0,
          input.limit ?? 50,
        );
        return {
          folder_path: folderPath,
          items: items.map((item) => ({
            id: item.id,
            slug: item.slug,
            title: capped(item.title || "Untitled", 120),
            kind: itemKind(item.type),
            status: item.status,
            pinned: Boolean(item.pinned),
            updatedAt: item.updatedAt ?? null,
          })),
        };
      }

      case "list_trash": {
        const trashedFolders = pool().trashedFolders ?? [];
        const trashedFolderIds = new Set(trashedFolders.map((folder) => folder.id));
        const restorationUnits = trashedFolders.filter(
          (folder) => !folder.parentId || !trashedFolderIds.has(folder.parentId),
        );
        return {
          folders: restorationUnits.map((folder) => ({
            id: folder.id,
            path: folder.path,
            name: folder.name,
            mode: folder.mode,
            items: (pool().trashedPosts ?? []).filter(
              (post) => post.folderId === folder.id,
            ).length,
          })),
          items: (pool().trashedPosts ?? [])
            .filter((item) => !item.folderId || !trashedFolderIds.has(item.folderId))
            .map((item) => ({
            id: item.id,
            slug: item.slug,
            title: capped(item.title || "Untitled", 120),
            kind: itemKind(item.type),
            status: item.status,
            folderId: item.folderId ?? null,
            updatedAt: item.updatedAt ?? null,
            })),
        };
      }

      case "read_item": {
        const input = args as WorkspaceToolInput<"read_item">;
        const post = requirePost(input.id);
        const text = await currentText(post);
        return {
          id: input.id,
          title: text.title,
          excerpt: text.excerpt,
          kind: itemKind(post.type),
          status: post.status,
          pinned: Boolean(post.pinned),
          folder_path: folderPathForPoolPost(pool(), post),
          slug: post.slug,
          accent: post.accent ?? null,
          cover: post.cover ?? null,
          cover_caption: post.coverCaption ?? null,
          cover_height: post.coverHeight ?? null,
          tags: normalizeTags(post.tags),
          date: post.date ?? null,
          updatedAt: post.updatedAt ?? null,
          body: capped(text.body, 12_000),
          assets: await listItemAssetsAction(handle, input.id),
        };
      }

      case "search": {
        const input = args as WorkspaceToolInput<"search">;
        const query = input.query.toLowerCase();
        const results: Array<Record<string, unknown>> = [];
        for (const post of pool().posts) {
          const summary = `${post.title}\n${post.excerpt ?? ""}`;
          let matchedText = summary;
          if (!summary.toLowerCase().includes(query)) {
            try {
              matchedText = (await currentText(post)).body;
            } catch {
              continue;
            }
          }
          if (!matchedText.toLowerCase().includes(query)) continue;
          results.push({
            id: post.id,
            slug: post.slug,
            title: post.title,
            kind: itemKind(post.type),
            status: post.status,
            snippet: searchSnippet(matchedText, input.query),
          });
          if (results.length >= (input.limit ?? 25)) break;
        }
        return { query: input.query, results };
      }

      case "create_item": {
        const input = args as WorkspaceToolInput<"create_item">;
        const folderPath = normalizeFolderPath(
          input.folder_path ?? defaultBlogFolderPath(pool().folders),
          pool().folders,
        );
        const folder = pool().folders.find(
          (candidate) => candidate.path === folderPath,
        );
        if (!folder) throw new Error(`No folder at path ${folderPath}`);

        const parsed = input.markdown
          ? parsePostMarkdownFile(input.markdown)
          : {
              fields: {
                title: input.title,
                excerpt: input.excerpt ?? undefined,
                type: input.kind ? postTypeForItemKind(input.kind) : undefined,
              },
              body: input.body ?? "",
              unknownKeys: [],
            };
        if (parsed.unknownKeys.length > 0) {
          throw new Error(
            `Unsupported frontmatter keys: ${parsed.unknownKeys.join(", ")}`,
          );
        }
        if (parsed.fields.status === "published") {
          throw new Error("New items must start as drafts");
        }
        if (parsed.fields.pinned) throw new Error("New items cannot start pinned");
        if (parsed.fields.starred) {
          throw new Error("New items cannot start starred; star them in the workspace");
        }
        if (parsed.fields.date) {
          throw new Error("A draft cannot have a publication date");
        }
        const type =
          parsed.fields.type ??
          (folder.mode === "notes"
            ? "note"
            : folder.mode === "bookmarks"
              ? "bookmark"
              : "article");
        if (folderModeForPostType(type) !== folder.mode) {
          throw new Error(`A ${type} cannot be created in the ${folder.mode} folder`);
        }

        const title = parsed.fields.title ?? input.title ?? "Untitled";
        const dedupeKey = `${folderPath}::${title.toLowerCase()}`;
        const priorCreates = requestTag ? requestCreates(requestTag) : null;
        const prior = priorCreates?.get(dedupeKey);
        if (prior) {
          return { ...(prior as Record<string, unknown>), alreadyCreated: true };
        }

        const actionType: Extract<PostType, "article" | "note" | "bookmark"> =
          type === "note" || type === "bookmark" ? type : "article";
        let saved = await createWorkspacePostAction(handle, actionType, folderPath);
        const poolPost = poolPostFromPost(saved, pool().blogId);
        if (poolPost) addPost(poolPost);
        if (poolPost) {
          saved = await saveCreatedItem(poolPost, {
            type,
            title: parsed.fields.title,
            excerpt: parsed.fields.excerpt,
            body: parsed.body,
            slug: parsed.fields.slug,
            accent: parsed.fields.accent,
            cover: parsed.fields.cover,
            coverCaption: parsed.fields.coverCaption,
            coverHeight: parsed.fields.coverHeight,
            videoUrl: parsed.fields.videoUrl,
            venue: parsed.fields.venue,
            duration: parsed.fields.duration,
            tags: parsed.fields.tags,
          });
        }
        const created = {
          ok: true,
          id: saved.id,
          title: saved.title,
          folder_path: folderPath,
          status: saved.status,
        };
        priorCreates?.set(dedupeKey, created);
        return created;
      }

      case "update_item": {
        const input = args as WorkspaceToolInput<"update_item">;
        const post = requirePost(input.id);
        let values: Omit<
          WorkspaceToolInput<"update_item">,
          "id" | "markdown" | "if_match_hash"
        >;
        if (input.markdown) {
          const parsed = parsePostMarkdownFile(input.markdown);
          if (parsed.unknownKeys.length > 0) {
            throw new Error(
              `Unsupported frontmatter keys: ${parsed.unknownKeys.join(", ")}`,
            );
          }
          const protectedFields: Array<
            [keyof typeof parsed.fields, unknown]
          > = [
            ["type", post.type],
            ["status", post.status],
            ["starred", Boolean(post.starred)],
            ["gallery", post.gallery],
            ["links", post.links],
            ["videoUrl", post.videoUrl],
            ["venue", post.venue],
            ["duration", post.duration],
          ];
          for (const [key, stored] of protectedFields) {
            if (!Object.prototype.hasOwnProperty.call(parsed.fields, key)) continue;
            const incoming =
              key === "pinned" || key === "starred"
                ? Boolean(parsed.fields[key])
                : parsed.fields[key];
            if (!sameValue(incoming, stored)) {
              throw new Error(`update_item cannot change ${key}`);
            }
          }
          values = {
            title: parsed.fields.title ?? post.title,
            excerpt: parsed.fields.excerpt ?? post.excerpt ?? "",
            body: parsed.body,
            ...(Object.prototype.hasOwnProperty.call(parsed.fields, "tags")
              ? { tags: normalizeTags(parsed.fields.tags) }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(parsed.fields, "slug")
              ? { slug: parsed.fields.slug }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(parsed.fields, "accent")
              ? { accent: parsed.fields.accent }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(parsed.fields, "cover")
              ? { cover: parsed.fields.cover }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(parsed.fields, "coverCaption")
              ? { cover_caption: parsed.fields.coverCaption }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(parsed.fields, "coverHeight")
              ? { cover_height: parsed.fields.coverHeight }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(parsed.fields, "date")
              ? { date: parsed.fields.date }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(parsed.fields, "pinned")
              ? { pinned: Boolean(parsed.fields.pinned) }
              : {}),
          };
        } else {
          values = {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
            ...(input.body !== undefined ? { body: input.body } : {}),
            ...(input.tags !== undefined ? { tags: input.tags } : {}),
            ...(input.slug !== undefined ? { slug: input.slug } : {}),
            ...(input.accent !== undefined ? { accent: input.accent } : {}),
            ...(input.cover !== undefined ? { cover: input.cover } : {}),
            ...(input.cover_caption !== undefined
              ? { cover_caption: input.cover_caption }
              : {}),
            ...(input.cover_height !== undefined
              ? { cover_height: input.cover_height }
              : {}),
            ...(input.date !== undefined ? { date: input.date } : {}),
            ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
          };
        }
        const metadataRequested =
          values.slug !== undefined ||
          values.accent !== undefined ||
          values.cover !== undefined ||
          values.cover_caption !== undefined ||
          values.cover_height !== undefined ||
          values.date !== undefined ||
          values.pinned !== undefined;
        const saved = metadataRequested
          ? await saveItemUpdate(post, values)
          : await saveDraftPatch(post, {
              title: values.title,
              excerpt:
                values.excerpt === null ? "" : values.excerpt,
              body: values.body,
              tags: values.tags,
            });
        return { ok: true, id: input.id, title: saved.title };
      }

      case "append_to_item": {
        const input = args as WorkspaceToolInput<"append_to_item">;
        const post = requirePost(input.id);
        const body = (await currentText(post)).body;
        const fragment = input.markdown_fragment.trim();
        const joined = body.trim()
          ? `${body.replace(/\s+$/, "")}\n\n${fragment}`
          : fragment;
        await saveDraftPatch(post, { body: joined });
        return { ok: true, id: input.id };
      }

      case "move_item": {
        const input = args as WorkspaceToolInput<"move_item">;
        const folderPath = normalizeFolderPath(input.folder_path, pool().folders);
        const post = requirePost(input.id);
        const folder = pool().folders.find(
          (candidate) => candidate.path === folderPath,
        );
        if (!folder) throw new Error(`No folder at path ${folderPath}`);
        if (folder.mode !== folderModeForPostType(post.type)) {
          throw new Error(`A ${post.type} cannot move into the ${folder.mode} folder`);
        }
        if (post.folderId === folder.id) {
          return { ok: true, changed: false, id: input.id, folder_path: folderPath };
        }
        const previousFolderId = post.folderId;
        movePost(input.id, folder.id);
        try {
          const moved = await movePostToFolderAction(handle, input.id, folder.path);
          syncPost(moved);
        } catch (error) {
          movePost(input.id, previousFolderId);
          throw error;
        }
        return { ok: true, changed: true, id: input.id, folder_path: folderPath };
      }

      case "delete_item": {
        const input = args as WorkspaceToolInput<"delete_item">;
        requirePost(input.id);
        movePostToTrash(input.id);
        try {
          await deleteEditablePostAction(handle, input.id);
        } catch (error) {
          restorePostFromTrash(input.id);
          throw error;
        }
        return { ok: true, id: input.id, trashed: true };
      }

      case "restore_item": {
        const input = args as WorkspaceToolInput<"restore_item">;
        const post = requireTrashedPost(input.id);
        if (post.status === "published" && isPrivatePostType(post.type)) {
          throw new Error("Notes and bookmarks must be unlisted before restoration");
        }
        restorePostFromTrash(input.id);
        try {
          const restored = await restoreEditablePostAction(handle, input.id);
          syncPost(restored);
          return { ok: true, id: input.id, status: restored.status };
        } catch (error) {
          movePostToTrash(input.id);
          throw error;
        }
      }

      case "set_item_status": {
        const input = args as WorkspaceToolInput<"set_item_status">;
        const post = requirePost(input.id);
        if (isPrivatePostType(post.type) && input.status === "published") {
          throw new Error("Notes and bookmarks are always unlisted");
        }
        if (post.status === input.status) {
          return { ok: true, changed: false, id: input.id, status: post.status };
        }
        const previous = { status: post.status, publishedAt: post.publishedAt };
        updatePost(input.id, {
          status: input.status,
          publishedAt:
            input.status === "published" ? (post.date ?? post.publishedAt) : undefined,
        });
        try {
          const saved = await setEditablePostStatusAction(
            handle,
            input.id,
            input.status,
          );
          syncPost(saved);
        } catch (error) {
          updatePost(input.id, previous);
          throw error;
        }
        return { ok: true, changed: true, id: input.id, status: input.status };
      }

      case "list_access": {
        const input = args as WorkspaceToolInput<"list_access">;
        return {
          scope: { type: input.scope_type, id: input.scope_id ?? pool().blogId },
          access: await listScopeSharesAction(
            handle,
            input.scope_type,
            input.scope_id,
          ),
        };
      }

      case "set_access": {
        const input = args as WorkspaceToolInput<"set_access">;
        return {
          ok: true,
          access: await shareScopeAction(
            handle,
            input.scope_type,
            input.scope_id,
            input.email,
            input.role,
          ),
        };
      }

      case "revoke_access": {
        const input = args as WorkspaceToolInput<"revoke_access">;
        return {
          ok: true,
          access: await revokeScopeShareAction(
            handle,
            input.scope_type,
            input.scope_id,
            input.access_id,
          ),
        };
      }

      case "list_comments": {
        const input = args as WorkspaceToolInput<"list_comments">;
        requirePost(input.id);
        const comments = await listItemCommentsAction(handle, input.id);
        return {
          item_id: input.id,
          comments: comments.filter((comment) =>
            input.state === "open"
              ? !comment.resolvedAt
              : input.state === "resolved"
                ? Boolean(comment.resolvedAt)
                : true,
          ),
        };
      }

      case "add_comment": {
        const input = args as WorkspaceToolInput<"add_comment">;
        requirePost(input.id);
        const comments = input.parent_comment_id
          ? await replyItemCommentAction(
              handle,
              input.id,
              input.parent_comment_id,
              input.body,
            )
          : await addItemCommentAction(
              handle,
              input.id,
              input.body,
              input.anchor_field,
              input.anchor_exact,
              input.anchor_start,
              input.anchor_end,
            );
        return { ok: true, item_id: input.id, comments };
      }

      case "set_comment_resolved": {
        const input = args as WorkspaceToolInput<"set_comment_resolved">;
        requirePost(input.id);
        const comments = input.resolved
          ? await resolveItemCommentAction(handle, input.id, input.comment_id)
          : await reopenItemCommentAction(handle, input.id, input.comment_id);
        return { ok: true, item_id: input.id, comments };
      }

      case "recapture_bookmark": {
        const input = args as WorkspaceToolInput<"recapture_bookmark">;
        const post = requirePost(input.id);
        if (post.type !== "bookmark") {
          throw new Error("Only bookmarks can be recaptured");
        }
        const pending = await recaptureBookmarkAction(handle, input.id);
        syncPost(pending);
        return { ok: true, queued: true, id: input.id };
      }

      case "add_item_asset": {
        const input = args as WorkspaceToolInput<"add_item_asset">;
        requirePost(input.id);
        const result = await addItemAssetAction(
          handle,
          input.id,
          input.source_url,
          input.placement,
          input.alt_text,
          input.caption,
        );
        syncPost(result.post);
        return { ok: true, asset: result.asset, id: input.id };
      }

      case "remove_item_asset": {
        const input = args as WorkspaceToolInput<"remove_item_asset">;
        requirePost(input.id);
        const result = await removeItemAssetAction(handle, input.id, input.asset_url);
        syncPost(result.post);
        return { ok: true, changed: result.changed, id: input.id };
      }

    }
  };

  return {
    executor,
    toolNames: [...WORKSPACE_TOOL_NAMES],
    toolDefinitions: WORKSPACE_AGENT_TOOL_DEFINITIONS,
    describeContext: (view) => {
      if (!view || view.level === "root" || !view.level) {
        const blogPath = defaultBlogFolderPath(pool().folders);
        return `The user is at the workspace root, looking at the folder list. When no destination is named, create blog posts and other public items in the Blog folder at path "${blogPath}".`;
      }
      if (view.level === "section") {
        return `The user is looking at the "${view.folderPath ?? ""}" folder.`;
      }
      if (view.level === "trash") return "The user is looking at Trash.";
      if (view.level === "shared") {
        return "The user is looking at items shared with them.";
      }
      if (!view.postId) return "The user is looking at the workspace.";
      const post = findPoolPostById(pool(), view.postId);
      const title = post?.title || "Untitled";
      return `The user has the item "${title}" (id ${view.postId}) open in ${
        view.level === "edit" ? "the editor" : "the reader"
      }.`;
    },
  };
}
