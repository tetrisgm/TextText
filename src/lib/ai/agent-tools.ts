"use client";
import {
  WORKSPACE_FOLDER_MODES,
  WORKSPACE_SCOPE_CAPABILITIES,
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
  isWorkspaceToolName,
  parseWorkspaceToolInput,
} from "@/lib/ai/tools";
import type { WorkspaceToolInput, WorkspaceToolName } from "@/lib/ai/tools";
import type {
  WorkspaceAgentActivity,
  WorkspaceAgentActivityField,
  WorkspaceAgentActor,
  WorkspaceAgentToolExecutor,
} from "@/lib/ai/agent-protocol";
import { executeWorkspaceToolRequest } from "@/lib/ai/workspace-tool-client";
import type {
  WorkspaceItemTextPatch,
  WorkspaceItemTextSnapshot,
} from "@/lib/ai/workspace-item-draft";
import { isPrivatePostType } from "@/lib/content";
import type { ItemKind } from "@/lib/content";
import { normalizeTags } from "@/lib/tags";
import {
  folderModeForPostType,
  parsePostMarkdownFile,
} from "@/lib/markdown-files";
import { parseItemInput } from "@/lib/item-creation";
import {
  ensurePostBody,
  getCachedWorkspacePostBody,
  moveFolderToTrash,
  movePost,
  movePostToTrash,
  refreshWorkspacePool,
  restoreFolderFromTrash,
  restorePostFromTrash,
  updateFolder,
  updatePost,
  updatePostBody,
} from "@/lib/pool/store";
import {
  findPoolPostById,
  folderPathForPoolPost,
  poolPostsForFolder,
} from "@/lib/pool/selectors";
import type { WorkspacePoolPayload, WorkspacePoolPost } from "@/lib/pool/types";

export const WORKSPACE_AGENT_TOOL_DEFINITIONS = WORKSPACE_TOOL_NAMES.map(
  (name) => {
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
  },
);

type WorkspaceAgentView = {
  level?: string;
  folderPath?: string;
  postId?: string;
};

type ToolArgs = Record<string, unknown>;

export type WorkspaceAgentToolsOptions = {
  handle: string;
  getPool: () => WorkspacePoolPayload | null;
  openItem?: (
    post: WorkspacePoolPost,
    mode: "read" | "edit",
  ) => Promise<void> | void;
  readItemText?: (postId: string) => Promise<WorkspaceItemTextSnapshot>;
  applyItemPatch?: (
    postId: string,
    patch: WorkspaceItemTextPatch,
    expected?: WorkspaceItemTextPatch,
    ifMatchHash?: string,
  ) =>
    | Promise<{ queued?: boolean; synced: boolean } | void>
    | { queued?: boolean; synced: boolean }
    | void;
  /** Required for soft deletion and audience-changing restore/status calls. */
  confirmDestructive?: (description: string) => Promise<boolean> | boolean;
  executeTool?: <Name extends WorkspaceToolName>(
    name: Name,
    args: WorkspaceToolInput<Name>,
  ) => Promise<Record<string, unknown>>;
  refreshPool?: () => Promise<void>;
  /**
   * Publish collaborator presence for an external agent before it opens or
   * edits an item, so its avatar and cursor arrive with the change rather than
   * after it. Presence is decoration: a rejection here must never block the
   * mutation, so callers of the tool executor swallow its failures.
   */
  signalAgentActivity?: (
    postId: string,
    activity: WorkspaceAgentActivity,
    actor: WorkspaceAgentActor,
  ) => Promise<void> | void;
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

/**
 * Where an item of this kind belongs when the model named no folder.
 *
 * This used to answer "blog" for everything. A note asked for by name was
 * therefore filed into the one folder that refuses notes, and the executor's
 * kind-versus-mode check reported the collision as if the request had been
 * impossible: "Kind note does not belong in blog". The model had done nothing
 * wrong, and neither had the person; two layers of our own normalization had
 * overwritten the destination before either was consulted.
 *
 * A caller who names a folder still gets that folder, and an unrecognized kind
 * still lands on blog, which is what an article, media post or video post
 * wants. Capture already routed this way; ordinary creation now agrees with it.
 */
function defaultFolderPathForKind(
  folders: Array<{ path: string; mode?: string }>,
  kind: unknown,
): string {
  const mode =
    kind === "note" ? "notes" : kind === "bookmark" ? "bookmarks" : "blog";
  const exact = folders.find(
    (folder) => folder.path === mode && folder.mode === mode,
  );
  if (exact) return exact.path;
  const matching = folders
    .filter((folder) => folder.mode === mode)
    .sort((left, right) => {
      const depth = left.path.split("/").length - right.path.split("/").length;
      return depth || left.path.localeCompare(right.path);
    });
  return matching[0]?.path ?? mode;
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
    (typeof normalized.title !== "string" || !normalized.title.trim()) &&
    typeof normalized.body === "string" &&
    normalized.body.trim()
  ) {
    normalized.title = parseItemInput(normalized.body).title;
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function itemKind(type: ItemKind) {
  return type;
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

export function createWorkspaceAgentTools(
  options: WorkspaceAgentToolsOptions,
): {
  executor: WorkspaceAgentToolExecutor;
  toolNames: WorkspaceToolName[];
  toolDefinitions: typeof WORKSPACE_AGENT_TOOL_DEFINITIONS;
  describeContext: (view?: WorkspaceAgentView) => string;
} {
  const {
    handle,
    getPool,
    openItem,
    readItemText,
    applyItemPatch,
    confirmDestructive,
    executeTool,
    refreshPool,
    signalAgentActivity,
  } = options;
  const executeWorkspaceTool =
    executeTool ??
    (<Name extends WorkspaceToolName>(
      name: Name,
      args: WorkspaceToolInput<Name>,
    ) => executeWorkspaceToolRequest(handle, name, args));

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
    const folder = (pool().trashedFolders ?? []).find(
      (entry) => entry.id === id,
    );
    if (!folder) throw new Error(`No folder with id ${id} exists in Trash`);
    return folder;
  }

  async function runRemote<Name extends WorkspaceToolName>(
    name: Name,
    input: WorkspaceToolInput<Name>,
  ) {
    return executeWorkspaceTool(name, input);
  }

  async function refreshPoolFromServer() {
    if (refreshPool) {
      await refreshPool();
      return;
    }
    await refreshWorkspacePool(handle, pool().blogId);
  }

  async function refreshPoolAfterMutation() {
    try {
      await refreshPoolFromServer();
    } catch (error) {
      // The command already succeeded. Keep the optimistic client state and
      // let the workspace's normal refresh loop reconcile in the background.
      console.warn("workspace assistant refresh failed", error);
    }
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
    ifMatchHash?: string,
  ) {
    const current = await currentText(poolPost);
    if (applyItemPatch) {
      const commit = await applyItemPatch(poolPost.id, patch, {}, ifMatchHash);
      const synced = commit?.synced === true && commit.queued !== true;
      return {
        id: poolPost.id,
        title: patch.title ?? current.title,
        excerpt: patch.excerpt ?? current.excerpt,
        body: patch.body ?? current.body,
        tags: normalizeTags(patch.tags ?? poolPost.tags),
        queued: !synced,
        synced,
      };
    }
    const title = patch.title ?? current.title;
    const excerpt = patch.excerpt ?? current.excerpt;
    const body = patch.body ?? current.body;
    const tags = normalizeTags(patch.tags ?? poolPost.tags);
    const previousPost = {
      title: poolPost.title,
      excerpt: poolPost.excerpt,
      tags: poolPost.tags,
    };
    updatePost(poolPost.id, { title, excerpt, tags });
    updatePostBody(pool().blogId, poolPost.id, body);
    try {
      await runRemote("update_item", {
        id: poolPost.id,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.excerpt !== undefined ? { excerpt: patch.excerpt } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.tags !== undefined ? { tags } : {}),
        ...(ifMatchHash ? { if_match_hash: ifMatchHash } : {}),
      });
    } catch (error) {
      updatePost(poolPost.id, previousPost);
      updatePostBody(pool().blogId, poolPost.id, current.body);
      throw error;
    }
    await refreshPoolAfterMutation();
    return {
      id: poolPost.id,
      title,
      excerpt,
      body,
      tags,
      queued: false,
      synced: true,
    };
  }

  async function confirmTool(
    name: WorkspaceToolName,
    input: Record<string, unknown>,
  ): Promise<boolean> {
    if (WORKSPACE_TOOL_DEFINITIONS[name].confirmation === "none") return true;
    if (!confirmDestructive) return false;

    if (name === "delete_folder" || name === "restore_folder") {
      const folderId =
        typeof input.folder_id === "string" ? input.folder_id : "";
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
    const post =
      name === "restore_item" ? requireTrashedPost(id) : requirePost(id);
    if (
      name === "restore_item" &&
      post.status === "published" &&
      isPrivatePostType(post.type)
    ) {
      throw new Error(
        "Notes and bookmarks must be unlisted before restoration",
      );
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

  /**
   * Which field an edit touches, so the agent's cursor lands where the change
   * does. Deterministic and body-first: body, then title, then subtitle.
   */
  function editedField(input: {
    body?: unknown;
    markdown?: unknown;
    markdown_fragment?: unknown;
    title?: unknown;
    excerpt?: unknown;
    text_edit?: { field?: unknown };
  }): WorkspaceAgentActivityField {
    if (input.text_edit?.field === "title") return "title";
    if (input.text_edit?.field === "excerpt") return "subtitle";
    if (input.text_edit?.field === "body") return "body";
    if (
      input.body !== undefined ||
      input.markdown !== undefined ||
      input.markdown_fragment !== undefined
    ) {
      return "body";
    }
    if (input.title !== undefined) return "title";
    if (input.excerpt !== undefined) return "subtitle";
    return "body";
  }

  /**
   * Announce the agent before the operation. Presence is decoration for a
   * mutation that carries its own authorization, so a failure here is
   * swallowed: the edit must still land when presence is unavailable.
   */
  async function signalActivity(
    postId: string,
    activity: WorkspaceAgentActivity,
    actor: WorkspaceAgentActor | undefined,
  ): Promise<void> {
    if (!signalAgentActivity || !actor) return;
    try {
      await signalAgentActivity(postId, activity, actor);
    } catch {
      // Never block a content mutation on presence reporting.
    }
  }

  const executor: WorkspaceAgentToolExecutor = async (
    rawName,
    rawArgs,
    requestTag,
    actor,
  ) => {
    if (!isWorkspaceToolName(rawName))
      throw new Error(`Unknown tool: ${rawName}`);
    const normalized = normalizeLegacyNativeArgs(
      rawName,
      rawArgs,
      pool().folders,
    );
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
        const result = await runRemote("create_folder", input);
        await refreshPoolAfterMutation();
        return { ok: true, ...result };
      }

      case "create_item_type": {
        const input = args as WorkspaceToolInput<"create_item_type">;
        const result = await runRemote("create_item_type", input);
        await refreshPoolAfterMutation();
        return { ok: true, ...result };
      }

      case "update_item_type": {
        const input = args as WorkspaceToolInput<"update_item_type">;
        const result = await runRemote("update_item_type", input);
        await refreshPoolAfterMutation();
        return { ok: true, ...result };
      }

      case "rename_folder": {
        const input = args as WorkspaceToolInput<"rename_folder">;
        const folder = requireFolder(input.folder_id);
        updateFolder(folder.id, { name: input.name });
        try {
          const result = await runRemote("rename_folder", input);
          await refreshPoolAfterMutation();
          return { ok: true, ...result };
        } catch (error) {
          updateFolder(folder.id, { name: folder.name });
          throw error;
        }
      }

      case "delete_folder": {
        const input = args as WorkspaceToolInput<"delete_folder">;
        requireFolder(input.folder_id);
        moveFolderToTrash(input.folder_id);
        try {
          const result = await runRemote("delete_folder", input);
          await refreshPoolAfterMutation();
          return { ok: true, ...result };
        } catch (error) {
          restoreFolderFromTrash(input.folder_id);
          throw error;
        }
      }

      case "restore_folder": {
        const input = args as WorkspaceToolInput<"restore_folder">;
        requireTrashedFolder(input.folder_id);
        restoreFolderFromTrash(input.folder_id);
        try {
          const result = await runRemote("restore_folder", input);
          await refreshPoolAfterMutation();
          return { ok: true, ...result };
        } catch (error) {
          moveFolderToTrash(input.folder_id);
          throw error;
        }
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
        const trashedFolderIds = new Set(
          trashedFolders.map((folder) => folder.id),
        );
        const restorationUnits = trashedFolders.filter(
          (folder) =>
            !folder.parentId || !trashedFolderIds.has(folder.parentId),
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
            .filter(
              (item) => !item.folderId || !trashedFolderIds.has(item.folderId),
            )
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
        const [text, persisted] = await Promise.all([
          currentText(post),
          runRemote("read_item", input).catch(
            (): Record<string, unknown> => ({}),
          ),
        ]);
        const persistedItem = asRecord(persisted.item);
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
          hash:
            typeof persistedItem.hash === "string"
              ? persistedItem.hash
              : typeof persisted.hash === "string"
                ? persisted.hash
                : null,
          assets: Array.isArray(persisted.assets) ? persisted.assets : [],
        };
      }

      case "open_item": {
        const input = args as WorkspaceToolInput<"open_item">;
        const post = requirePost(input.id);
        if (!openItem) {
          const result = await runRemote("open_item", input);
          return { ok: true, ...result };
        }
        const folderPath = folderPathForPoolPost(pool(), post);
        const mode = input.mode ?? "read";
        // Announce the agent before navigating, so it is already present in the
        // collaborator list as the item appears.
        await signalActivity(post.id, { kind: "open", field: "body" }, actor);
        await openItem(post, mode);
        return {
          ok: true,
          id: post.id,
          title: post.title,
          folder_path: folderPath,
          mode,
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
        // Where an unplaced item goes is the WORKSPACE's rule, and it lives in
        // the one command executor every surface calls. This adapter used to
        // answer it as well, with its own copy, and because the copy ran first
        // the executor's rule never got a say on this lane: a note the person
        // never placed was addressed to "blog" here and refused there. Resolve
        // only a folder the person actually named, so "Notes" and "notes" mean
        // the same thing, and pass the kind through untouched.
        const folderPath = input.folder_path
          ? normalizeFolderPath(input.folder_path, pool().folders)
          : undefined;
        if (
          folderPath &&
          !pool().folders.some((candidate) => candidate.path === folderPath)
        ) {
          throw new Error(`No folder at path ${folderPath}`);
        }
        const title = input.capture
          ? parseItemInput(input.capture).title || "Saved link"
          : input.markdown
            ? (parsePostMarkdownFile(input.markdown).fields.title ?? "Untitled")
            : (input.title ?? "Untitled");
        const dedupeKey = `${folderPath ?? input.kind ?? "capture"}::${title.toLowerCase()}`;
        const priorCreates = requestTag ? requestCreates(requestTag) : null;
        const prior = priorCreates?.get(dedupeKey);
        if (prior) {
          return {
            ...(prior as Record<string, unknown>),
            alreadyCreated: true,
          };
        }
        const result = await runRemote("create_item", {
          ...input,
          ...(folderPath ? { folder_path: folderPath } : {}),
        });
        const item = asRecord(result.item);
        const receipt = asRecord(result.receipt);
        // The workspace decided where this went, so the workspace says so.
        const savedTo =
          typeof receipt.saved_to === "string"
            ? receipt.saved_to
            : (folderPath ?? "");
        const created = {
          ok: true,
          id: typeof item.id === "string" ? item.id : "",
          title: typeof item.title === "string" ? item.title : title,
          folder_path: savedTo,
          status: typeof item.status === "string" ? item.status : "draft",
        };
        priorCreates?.set(dedupeKey, created);
        await refreshPoolAfterMutation();
        return created;
      }

      case "update_item": {
        const input = args as WorkspaceToolInput<"update_item">;
        const post = requirePost(input.id);
        // Place the agent's cursor on the field it is about to change, before
        // the change lands.
        await signalActivity(
          post.id,
          { kind: "edit", field: editedField(input) },
          actor,
        );
        const metadataRequested =
          input.text_edit !== undefined ||
          input.section !== undefined ||
          input.markdown !== undefined ||
          input.fields !== undefined ||
          input.slug !== undefined ||
          input.accent !== undefined ||
          input.cover !== undefined ||
          input.cover_caption !== undefined ||
          input.cover_height !== undefined ||
          input.date !== undefined ||
          input.pinned !== undefined;
        if (!metadataRequested) {
          const saved = await saveDraftPatch(
            post,
            {
              title: input.title,
              excerpt: input.excerpt === null ? "" : input.excerpt,
              body: input.body,
              tags: input.tags,
            },
            input.if_match_hash,
          );
          const acknowledged = saved.synced && !saved.queued;
          return {
            ok: acknowledged,
            id: input.id,
            title: saved.title,
            queued: saved.queued,
            sync_status: acknowledged ? "acknowledged" : "queued_locally",
          };
        }

        const optimistic = {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.excerpt !== undefined
            ? { excerpt: input.excerpt ?? undefined }
            : {}),
          ...(input.tags !== undefined
            ? { tags: normalizeTags(input.tags) }
            : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.accent !== undefined
            ? { accent: input.accent ?? undefined }
            : {}),
          ...(input.cover !== undefined
            ? { cover: input.cover ?? undefined }
            : {}),
          ...(input.cover_caption !== undefined
            ? { coverCaption: input.cover_caption ?? undefined }
            : {}),
          ...(input.cover_height !== undefined
            ? { coverHeight: input.cover_height ?? undefined }
            : {}),
          ...(input.date !== undefined ? { date: input.date } : {}),
          ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        };
        const previousPost = {
          title: post.title,
          excerpt: post.excerpt,
          tags: post.tags,
          slug: post.slug,
          accent: post.accent,
          cover: post.cover,
          coverCaption: post.coverCaption,
          coverHeight: post.coverHeight,
          date: post.date,
          pinned: post.pinned,
        };
        const replacesWholeBody =
          input.body !== undefined && input.section === undefined;
        const previousBody = replacesWholeBody
          ? (await currentText(post)).body
          : undefined;
        updatePost(input.id, optimistic);
        if (replacesWholeBody && input.body !== undefined) {
          updatePostBody(pool().blogId, input.id, input.body);
        }
        let result: Record<string, unknown>;
        try {
          result = await runRemote("update_item", input);
        } catch (error) {
          updatePost(input.id, previousPost);
          if (previousBody !== undefined) {
            updatePostBody(pool().blogId, input.id, previousBody);
          }
          throw error;
        }
        await refreshPoolAfterMutation();
        const item = asRecord(result.item);
        return {
          ok: true,
          id: input.id,
          title: typeof item.title === "string" ? item.title : post.title,
        };
      }

      case "append_to_item": {
        const input = args as WorkspaceToolInput<"append_to_item">;
        const post = requirePost(input.id);
        await signalActivity(post.id, { kind: "edit", field: "body" }, actor);
        const body = (await currentText(post)).body;
        // Either spelling, same as the MCP rung.
        const fragment = (
          input.markdown ??
          input.markdown_fragment ??
          ""
        ).trim();
        if (!fragment)
          throw new Error("Pass the text to append as `markdown`.");
        const joined = body.trim()
          ? `${body.replace(/\s+$/, "")}\n\n${fragment}`
          : fragment;
        if (!applyItemPatch) {
          const result = await runRemote("append_to_item", input);
          await refreshPoolAfterMutation();
          return {
            ok: true,
            id: input.id,
            queued: false,
            sync_status: "acknowledged",
            ...result,
          };
        }
        const saved = await saveDraftPatch(post, { body: joined });
        const acknowledged = saved.synced && !saved.queued;
        return {
          ok: acknowledged,
          id: input.id,
          queued: saved.queued,
          sync_status: acknowledged ? "acknowledged" : "queued_locally",
        };
      }

      case "move_item": {
        const input = args as WorkspaceToolInput<"move_item">;
        const folderPath = normalizeFolderPath(
          input.folder_path,
          pool().folders,
        );
        const post = requirePost(input.id);
        const folder = pool().folders.find(
          (candidate) => candidate.path === folderPath,
        );
        if (!folder) throw new Error(`No folder at path ${folderPath}`);
        if (folder.mode !== folderModeForPostType(post.type)) {
          throw new Error(
            `A ${post.type} cannot move into the ${folder.mode} folder`,
          );
        }
        if (post.folderId === folder.id) {
          return {
            ok: true,
            changed: false,
            id: input.id,
            folder_path: folderPath,
          };
        }
        const previousFolderId = post.folderId;
        movePost(input.id, folder.id);
        try {
          const result = await runRemote("move_item", {
            ...input,
            folder_path: folder.path,
          });
          await refreshPoolAfterMutation();
          return { ok: true, changed: true, ...result };
        } catch (error) {
          movePost(input.id, previousFolderId);
          throw error;
        }
      }

      case "delete_item": {
        const input = args as WorkspaceToolInput<"delete_item">;
        requirePost(input.id);
        movePostToTrash(input.id);
        try {
          const result = await runRemote("delete_item", input);
          await refreshPoolAfterMutation();
          return { ok: true, ...result };
        } catch (error) {
          restorePostFromTrash(input.id);
          throw error;
        }
      }

      case "restore_item": {
        const input = args as WorkspaceToolInput<"restore_item">;
        const post = requireTrashedPost(input.id);
        if (post.status === "published" && isPrivatePostType(post.type)) {
          throw new Error(
            "Notes and bookmarks must be unlisted before restoration",
          );
        }
        restorePostFromTrash(input.id);
        try {
          const result = await runRemote("restore_item", input);
          await refreshPoolAfterMutation();
          return { ok: true, ...result };
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
          return {
            ok: true,
            changed: false,
            id: input.id,
            status: post.status,
          };
        }
        const previous = { status: post.status, publishedAt: post.publishedAt };
        updatePost(input.id, {
          status: input.status,
          publishedAt:
            input.status === "published"
              ? (post.date ?? post.publishedAt)
              : undefined,
        });
        try {
          const result = await runRemote("set_item_status", input);
          await refreshPoolAfterMutation();
          return { ok: true, changed: true, ...result };
        } catch (error) {
          updatePost(input.id, previous);
          throw error;
        }
      }

      case "list_access": {
        const input = args as WorkspaceToolInput<"list_access">;
        return await runRemote("list_access", input);
      }

      case "set_access": {
        const input = args as WorkspaceToolInput<"set_access">;
        return { ok: true, ...(await runRemote("set_access", input)) };
      }

      case "revoke_access": {
        const input = args as WorkspaceToolInput<"revoke_access">;
        return { ok: true, ...(await runRemote("revoke_access", input)) };
      }

      case "list_comments": {
        const input = args as WorkspaceToolInput<"list_comments">;
        requirePost(input.id);
        return await runRemote("list_comments", input);
      }

      case "add_comment": {
        const input = args as WorkspaceToolInput<"add_comment">;
        requirePost(input.id);
        return { ok: true, ...(await runRemote("add_comment", input)) };
      }

      case "set_comment_resolved": {
        const input = args as WorkspaceToolInput<"set_comment_resolved">;
        requirePost(input.id);
        return {
          ok: true,
          ...(await runRemote("set_comment_resolved", input)),
        };
      }

      case "recapture_bookmark": {
        const input = args as WorkspaceToolInput<"recapture_bookmark">;
        const post = requirePost(input.id);
        if (post.type !== "bookmark") {
          throw new Error("Only bookmarks can be recaptured");
        }
        const previousStatus = post.captureStatus;
        updatePost(input.id, { captureStatus: "pending" });
        try {
          const result = await runRemote("recapture_bookmark", input);
          await refreshPoolAfterMutation();
          return { ok: true, ...result };
        } catch (error) {
          updatePost(input.id, { captureStatus: previousStatus });
          throw error;
        }
      }

      case "add_item_asset": {
        const input = args as WorkspaceToolInput<"add_item_asset">;
        requirePost(input.id);
        const result = await runRemote("add_item_asset", input);
        await refreshPoolAfterMutation();
        return { ok: true, ...result };
      }

      case "remove_item_asset": {
        const input = args as WorkspaceToolInput<"remove_item_asset">;
        requirePost(input.id);
        const result = await runRemote("remove_item_asset", input);
        await refreshPoolAfterMutation();
        return { ok: true, ...result };
      }
    }
  };

  return {
    executor,
    toolNames: [...WORKSPACE_TOOL_NAMES],
    toolDefinitions: WORKSPACE_AGENT_TOOL_DEFINITIONS,
    describeContext: (view) => {
      if (!view || view.level === "root" || !view.level) {
        const blogPath = defaultFolderPathForKind(pool().folders, "article");
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
      }. This is the active item. Requests using "this", "it", "the title", or "add a section" modify this item. Do not create another item unless the user explicitly asks for a separate new item.`;
    },
  };
}
