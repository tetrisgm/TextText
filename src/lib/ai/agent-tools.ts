"use client";

// The page-side executor for on-device agent tool calls (see native.ts).
// Each tool maps onto the SAME pool store mutations and server actions the
// UI and command palette use, so agent edits are optimistic, synced, and
// audited exactly like human edits, and the model can never do anything the
// signed-in page could not.
//
// Turnkey wiring (the assistant sidebar does this once on mount):
//
//   const tools = createWorkspaceAgentTools({
//     handle,
//     getPool: () => poolRef.current,
//     confirmDestructive: (what) => assistantConfirmation.request(what),
//   });
//   useEffect(() => registerNativeAgentTools(tools.executor), [tools]);
//   ...
//   const reply = await nativeAgent(promptText, {
//     context: tools.describeContext(view),
//     onEvent: (event) => setBusyTool(event.name),
//   });

import {
  createWorkspacePostAction,
  deleteEditablePostAction,
  movePostToFolderAction,
  saveEditablePostAction,
  setEditablePostStatusAction,
} from "@/app/editor/actions";
import { isPrivatePostType } from "@/lib/content";
import type { Post, PostType } from "@/lib/content";
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
  movePost,
  movePostToTrash,
  restorePostFromTrash,
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
import type { NativeAgentToolExecutor } from "@/lib/ai/native";
import type {
  WorkspaceItemTextPatch,
  WorkspaceItemTextSnapshot,
} from "@/lib/ai/workspace-item-draft";

export const WORKSPACE_AGENT_TOOL_NAMES = [
  "list_folders",
  "list_items",
  "read_item",
  "create_item",
  "update_item",
  "append_to_item",
  "move_item",
  "delete_item",
  "set_item_status",
] as const;

type ToolArgs = Record<string, unknown>;

export type WorkspaceAgentToolsOptions = {
  handle: string;
  getPool: () => WorkspacePoolPayload | null;
  readItemText?: (postId: string) => Promise<WorkspaceItemTextSnapshot>;
  applyItemPatch?: (
    postId: string,
    patch: WorkspaceItemTextPatch,
  ) => Promise<unknown> | unknown;
  /**
   * Gate for delete_item and set_item_status. Return false to cancel; the
   * model receives the cancellation and reports it. Omit to deny destructive
   * calls; the UI must provide an explicit confirmation surface.
   */
  confirmDestructive?: (description: string) => Promise<boolean> | boolean;
};

function str(args: ToolArgs, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${key}`);
  }
  return value.trim();
}

// Small on-device models occasionally emit glitched argument tokens (for
// example a folder of "blog}<ctrl45>..."). Folder values are a closed set,
// so recover the intended path instead of failing the whole request.
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

function optionalStr(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function capped(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function poolPostFromPost(
  post: Post,
  blogId: string,
): WorkspacePoolPost | null {
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
    videoUrl: post.videoUrl,
    venue: post.venue,
    duration: post.duration,
    wordCount: post.wordCount,
    readingTime: post.readingTime,
    date: post.date,
    publishedAt: post.status === "published" ? post.date : undefined,
    status: post.status,
    pinned: post.pinned,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

// Deterministic idempotency for create_item within one agent request: if the
// model asks to create the same title in the same folder twice under one
// request tag (small models sometimes redo the last item), return the first
// result instead of creating a duplicate.
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

export function createWorkspaceAgentTools(options: WorkspaceAgentToolsOptions): {
  executor: NativeAgentToolExecutor;
  toolNames: string[];
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

  async function confirmOrCancel(description: string): Promise<boolean> {
    if (!confirmDestructive) return false;
    return await confirmDestructive(description);
  }

  async function saveDraftPatch(
    poolPost: WorkspacePoolPost,
    patch: WorkspaceItemTextPatch,
  ) {
    const current = readItemText
      ? await readItemText(poolPost.id)
      : {
          title: poolPost.title,
          excerpt: poolPost.excerpt ?? "",
          body: await readBody(pool().blogId, poolPost.id),
        };
    if (applyItemPatch) {
      await applyItemPatch(poolPost.id, patch);
      return {
        ...postFromPoolPost(poolPost, patch.body ?? current.body),
        title: patch.title ?? current.title,
        excerpt: patch.excerpt ?? current.excerpt,
      };
    }

    const post = postFromPoolPost(poolPost, patch.body ?? current.body);
    const draft = initialDraft(post);
    if (patch.title !== undefined) draft.title = patch.title;
    if (patch.excerpt !== undefined) draft.excerpt = patch.excerpt;
    if (patch.body !== undefined) draft.body = patch.body;
    // Same behavior as the editor's title blur: a placeholder slug follows
    // the title, so agent-created posts get real slugs, not untitled-x URLs.
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
    updatePost(poolPost.id, {
      title: saved.title,
      excerpt: saved.excerpt,
      slug: saved.slug,
      updatedAt: saved.updatedAt,
    });
    return saved;
  }

  const executor: NativeAgentToolExecutor = async (name, args, requestTag) => {
    switch (name) {
      case "list_folders": {
        const current = pool();
        return {
          folders: current.folders.map((folder) => ({
            path: folder.path,
            name: folder.name,
            mode: folder.mode,
            items: current.posts.filter((post) => post.folderId === folder.id)
              .length,
          })),
        };
      }

      case "list_items": {
        const folder = normalizeFolderPath(str(args, "folder"), pool().folders);
        const items = poolPostsForFolder(pool(), folder).slice(0, 40);
        return {
          items: items.map((item) => ({
            id: item.id,
            title: capped(item.title || "Untitled", 80),
            type: item.type,
            status: item.status,
          })),
        };
      }

      case "read_item": {
        const id = str(args, "id");
        const post = requirePost(id);
        const current = readItemText
          ? await readItemText(id)
          : {
              title: post.title,
              excerpt: post.excerpt ?? "",
              body: await readBody(pool().blogId, id),
            };
        return {
          id,
          title: current.title,
          excerpt: current.excerpt,
          type: post.type,
          status: post.status,
          folder: folderPathForPoolPost(pool(), post),
          body: capped(current.body, 6_000),
        };
      }

      case "create_item": {
        const folder = normalizeFolderPath(str(args, "folder"), pool().folders);
        const title = str(args, "title");
        const body = optionalStr(args, "body");
        const dedupeKey = `${folder}::${title.toLowerCase()}`;
        const priorCreates = requestTag ? requestCreates(requestTag) : null;
        const prior = priorCreates?.get(dedupeKey);
        if (prior) {
          return { ...(prior as Record<string, unknown>), alreadyCreated: true };
        }
        const requestedKind = optionalStr(args, "kind");
        const folderMode = pool().folders.find(
          (candidate) => candidate.path === folder,
        )?.mode;
        const kind = (requestedKind ??
          (folderMode === "notes"
            ? "note"
            : folderMode === "bookmarks"
              ? "bookmark"
              : "article")) as Extract<
          PostType,
          "article" | "note" | "bookmark"
        >;
        let saved = await createWorkspacePostAction(handle, kind, folder);
        const poolPost = poolPostFromPost(saved, pool().blogId);
        if (poolPost) addPost(poolPost);
        if (poolPost && (title || body)) {
          saved = await saveDraftPatch(poolPost, { title, body });
        }
        const created = {
          ok: true,
          id: saved.id,
          title: saved.title,
          folder,
          status: saved.status,
        };
        priorCreates?.set(dedupeKey, created);
        return created;
      }

      case "update_item": {
        const id = str(args, "id");
        const title = optionalStr(args, "title");
        const excerpt = optionalStr(args, "excerpt");
        const body = optionalStr(args, "body");
        if (title === undefined && excerpt === undefined && body === undefined) {
          throw new Error("Nothing to update: pass title, excerpt, or body");
        }
        const saved = await saveDraftPatch(requirePost(id), {
          title,
          excerpt,
          body,
        });
        return { ok: true, id, title: saved.title };
      }

      case "append_to_item": {
        const id = str(args, "id");
        const markdown = str(args, "markdown");
        const post = requirePost(id);
        const body = readItemText
          ? (await readItemText(id)).body
          : await readBody(pool().blogId, id);
        const joined = body.trim()
          ? `${body.replace(/\s+$/, "")}\n\n${markdown}`
          : markdown;
        await saveDraftPatch(post, { body: joined });
        return { ok: true, id };
      }

      case "move_item": {
        const id = str(args, "id");
        const folderPath = normalizeFolderPath(str(args, "folder"), pool().folders);
        const post = requirePost(id);
        const folder = pool().folders.find(
          (candidate) => candidate.path === folderPath,
        );
        if (!folder) throw new Error(`No folder at path ${folderPath}`);
        const previousFolderId = post.folderId;
        movePost(id, folder.id);
        try {
          await movePostToFolderAction(handle, id, folder.path);
        } catch (error) {
          movePost(id, previousFolderId);
          throw error;
        }
        return { ok: true, id, folder: folderPath };
      }

      case "delete_item": {
        const id = str(args, "id");
        const post = requirePost(id);
        const allowed = await confirmOrCancel(
          `Delete "${post.title || "Untitled"}"?`,
        );
        if (!allowed) return { ok: false, cancelled: true };
        movePostToTrash(id);
        try {
          await deleteEditablePostAction(handle, id);
        } catch (error) {
          restorePostFromTrash(id);
          throw error;
        }
        return { ok: true, id, deleted: true };
      }

      case "set_item_status": {
        const id = str(args, "id");
        const status = str(args, "status") as "published" | "draft";
        if (status !== "published" && status !== "draft") {
          throw new Error("status must be published or draft");
        }
        const post = requirePost(id);
        if (isPrivatePostType(post.type)) {
          throw new Error("Notes and bookmarks are always unlisted");
        }
        const allowed = await confirmOrCancel(
          `${status === "published" ? "Publish" : "Unpublish"} "${post.title || "Untitled"}"?`,
        );
        if (!allowed) return { ok: false, cancelled: true };
        const previous = { status: post.status, publishedAt: post.publishedAt };
        updatePost(id, {
          status,
          publishedAt:
            status === "published" ? (post.date ?? post.publishedAt) : undefined,
        });
        try {
          await setEditablePostStatusAction(handle, id, status);
        } catch (error) {
          updatePost(id, previous);
          throw error;
        }
        return { ok: true, id, status };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };

  return {
    executor,
    toolNames: [...WORKSPACE_AGENT_TOOL_NAMES],
    describeContext: (view) => {
      if (!view || view.level === "root" || !view.level) {
        return "The user is at the workspace root, looking at the folder list.";
      }
      if (view.level === "section") {
        return `The user is looking at the "${view.folderPath ?? ""}" folder.`;
      }
      if (view.level === "trash") {
        return "The user is looking at Trash.";
      }
      if (view.level === "shared") {
        return "The user is looking at items shared with them.";
      }
      if (!view.postId) {
        return "The user is looking at the workspace.";
      }
      const post = view.postId
        ? findPoolPostById(pool(), view.postId)
        : null;
      const title = post?.title || "Untitled";
      return `The user has the item "${title}" (id ${view.postId}) open in ${
        view.level === "edit" ? "the editor" : "the reader"
      }.`;
    },
  };
}
