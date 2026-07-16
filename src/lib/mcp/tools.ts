import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { recordAction, type AuditEntry } from "@/lib/audit";
import { hasActiveCoEditors } from "@/lib/collab";
import {
  WORKSPACE_FOLDER_MODES,
  WORKSPACE_SCOPE_CAPABILITIES,
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
  parseWorkspaceToolInput,
} from "@/lib/ai/tools";
import type { WorkspaceToolInput, WorkspaceToolName } from "@/lib/ai/tools";
import type { Blog, Folder, Post } from "@/lib/content";
import { NO_COVER_VALUE } from "@/lib/cover";
import {
  attachItemAsset,
  importItemAssetFromUrl,
  listItemAssetReferences,
  removeItemAssetReferences,
} from "@/lib/item-assets";
import {
  parsePostMarkdownFile,
  postTypeForItemKind,
  slugForNewFile,
} from "@/lib/markdown-files";
import {
  type AccessUser,
  type CollaboratorScopeType,
  type EffectiveAccess,
  resolveFolderAccess,
  resolveItemAccess,
  resolveWorkspaceAccess,
} from "@/lib/permissions";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import {
  inviteScopeShare,
  listScopeShares,
  revokeScopeShare,
  updateScopeShareRole,
} from "@/lib/shares";
import type { ScopeShareRole } from "@/lib/shares";
import {
  createItemComment,
  createDraftInFolder,
  createSubfolder,
  deletePost,
  deletePostAtomic,
  getAccessibleAllPostFiles,
  getAccessibleFolderCounts,
  getAccessibleFolderPostFiles,
  getAccessibleFolders,
  getPostById,
  getTrashedFolders,
  getTrashedPosts,
  listItemComments,
  markCapturePending,
  movePostFile,
  PostConflictError,
  renameFolder,
  restoreFolder,
  restorePost,
  savePost,
  savePostContentPatch,
  setItemCommentResolved,
  trashFolder,
} from "@/lib/store";
import { workspaceBlog } from "./auth";
import {
  DEFAULT_TYPE_BY_MODE,
  folderModeForType,
  isAlwaysDraftType,
  itemEntry,
  itemKindForPost,
  kindsForFolderMode,
  normalizeItemHash,
  postMatchesQuery,
  renderItemFile,
  searchSnippet,
} from "./items";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_SAVE_ERRORS = new Set(["That URL is already used"]);

type ToolContext = { authInfo?: AuthInfo };
type ToolTargetType = "workspace" | "folder" | "item";
type RegisteredCallback = (
  args: Record<string, unknown>,
  extra: ToolContext,
) => Promise<CallToolResult>;
type RegisterTool = (
  name: string,
  config: {
    title: string;
    description: string;
    inputSchema: z.ZodType;
    annotations: ToolAnnotations;
  },
  callback: RegisteredCallback,
) => unknown;

export type McpScopeAccess = "full" | "read-only" | "none";

function isReadOnlyScope(scope: string): boolean {
  const normalized = scope.trim().toLowerCase();
  return (
    normalized === "read" ||
    normalized === "readonly" ||
    normalized === "read-only" ||
    /(?:^|[:./_-])read(?:[-_]?only)?$/.test(normalized)
  );
}

export function resolveMcpScopeAccess(
  scopes: readonly string[] | undefined,
): McpScopeAccess {
  const values = scopes ?? [];
  if (values.some(isReadOnlyScope)) return "read-only";
  if (values.includes("sync")) return "full";
  return "none";
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function jsonResult(value: unknown): CallToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function parseErrorResult(error: unknown): CallToolResult {
  const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
  return errorResult(`Could not parse the markdown file.${detail}`);
}

function saveErrorResult(error: unknown): CallToolResult {
  if (error instanceof Error && CLIENT_SAVE_ERRORS.has(error.message)) {
    return errorResult(error.message);
  }
  console.error("MCP workspace mutation failed:", error);
  return errorResult("The item could not be saved. Try again.");
}

function conflictResult(post: Pick<Post, "slug" | "title">, action: string) {
  return errorResult(
    `Conflict: "${post.title || post.slug}" changed before ${action}. ` +
      "Read the latest item, merge the change, then retry with its new hash.",
  );
}

/** A raw body overwrite while people are co-editing the item in the browser
 * would be silently discarded by the next co-editor autosave (the canonical
 * body and the live Yjs document are separate write paths). Refuse instead of
 * losing the write; the agent can retry once the session ends. */
function coEditingConflictResult(post: Pick<Post, "slug" | "title">) {
  return errorResult(
    `"${post.title || post.slug}" is being co-edited right now. ` +
      "Its body is owned by the live editing session; try again after it ends.",
  );
}

function accessUser(extra: ToolContext): AccessUser {
  const sub = extra.authInfo?.extra?.sub;
  const userId = extra.authInfo?.extra?.userId;
  return {
    sub: typeof sub === "string" ? sub : null,
    userId: typeof userId === "string" ? userId : null,
  };
}

async function auditMcp(
  extra: ToolContext,
  actionName: string,
  targetType: ToolTargetType,
  targetId: string | undefined,
  summary?: string,
) {
  const userId = extra.authInfo?.extra?.userId;
  await recordAction({
    actorUserId: typeof userId === "string" ? userId : null,
    actorType: "external_agent",
    actionName,
    targetType,
    targetId,
    inputSummary: summary,
  });
}

/** Build (rather than write) the audit entry, to fold it atomically into a
 * store mutation's own transaction instead of recording it as a follow-up. */
function mcpAuditEntry(
  extra: ToolContext,
  actionName: string,
  targetType: ToolTargetType,
  targetId: string | undefined,
  summary?: string,
): AuditEntry {
  const userId = extra.authInfo?.extra?.userId;
  return {
    actorUserId: typeof userId === "string" ? userId : null,
    actorType: "external_agent",
    actionName,
    targetType,
    targetId,
    inputSummary: summary,
  };
}

function isToolResult<T extends object>(
  value: T | CallToolResult,
): value is CallToolResult {
  return "content" in value;
}

async function requireBlog(extra: ToolContext): Promise<Blog | CallToolResult> {
  const blog = await workspaceBlog(extra.authInfo);
  if (!blog) {
    return errorResult(
      "No workspace exists for this token's user. Open the editor once to create one.",
    );
  }
  return blog;
}

async function requireWorkspace(
  extra: ToolContext,
  ownerOnly = false,
): Promise<{ blog: Blog; access: EffectiveAccess } | CallToolResult> {
  const blog = await requireBlog(extra);
  if (isToolResult(blog)) return blog;
  const access = await resolveWorkspaceAccess({
    handle: blog.handle,
    user: accessUser(extra),
  });
  if (!access.canView || (ownerOnly && !access.isOwner)) {
    return errorResult(
      ownerOnly
        ? "Only the workspace owner can perform this action."
        : "You cannot access this workspace.",
    );
  }
  return { blog, access };
}

async function requirePost(
  extra: ToolContext,
  id: string,
): Promise<{ blog: Blog; post: Post; access: EffectiveAccess } | CallToolResult> {
  const blog = await requireBlog(extra);
  if (isToolResult(blog)) return blog;
  const post = UUID_RE.test(id) ? await getPostById(blog.handle, id) : null;
  if (!post) return errorResult(`No item with id "${id}" exists in this workspace.`);
  const access = await resolveItemAccess({
    handle: blog.handle,
    postId: id,
    user: accessUser(extra),
  });
  if (!access.canView) {
    return errorResult(`No item with id "${id}" exists in this workspace.`);
  }
  return { blog, post, access };
}

async function accessibleFolder(
  blog: Blog,
  extra: ToolContext,
  path: string,
): Promise<Folder | CallToolResult> {
  const folders = await getAccessibleFolders(blog.handle, accessUser(extra));
  const folder = folders.find((entry) => entry.path === path);
  return (
    folder ??
    errorResult(
      `No folder with path "${path}" exists. Call list_folders for available paths.`,
    )
  );
}

function hashConflict(
  blog: Blog,
  post: Post,
  expected: string | undefined,
): CallToolResult | null {
  if (!expected) return null;
  const current = renderItemFile(blog, post);
  if (normalizeItemHash(expected) === current.hash) return null;
  return errorResult(
    `Conflict: "${post.title || post.slug}" changed since it was read ` +
      `(its hash is now ${current.hash}). Read the latest item, merge, then retry.`,
  );
}

function mutationRevision(post: Post): number | CallToolResult {
  return post.revision ?? errorResult(
    "This item has no revision and cannot be mutated safely. Read it again and retry.",
  );
}

function folderSummary(folder: Folder, count?: number) {
  return {
    id: folder.id,
    name: folder.name,
    path: folder.path,
    mode: folder.mode,
    parentId: folder.parentId ?? null,
    ...(count === undefined ? {} : { itemCount: count }),
  };
}

function requiredSub(extra: ToolContext): string | CallToolResult {
  const sub = extra.authInfo?.extra?.sub;
  return typeof sub === "string" && sub.trim()
    ? sub
    : errorResult("This connection is not associated with a signed-in user.");
}

async function accessTarget(
  extra: ToolContext,
  scopeType: CollaboratorScopeType,
  scopeId?: string,
): Promise<
  | {
      blog: Blog;
      access: EffectiveAccess;
      scopeType: CollaboratorScopeType;
      scopeId: string;
    }
  | CallToolResult
> {
  const resolved = await requireWorkspace(extra);
  if (isToolResult(resolved)) return resolved;
  if (scopeType === "workspace") {
    if (!resolved.access.blogId) return errorResult("Workspace not found.");
    return {
      blog: resolved.blog,
      access: resolved.access,
      scopeType,
      scopeId: resolved.access.blogId,
    };
  }
  if (!scopeId || !UUID_RE.test(scopeId)) return errorResult("Scope not found.");
  if (scopeType === "folder") {
    const folder = (await getAccessibleFolders(
      resolved.blog.handle,
      accessUser(extra),
    )).find((entry) => entry.id === scopeId);
    if (!folder) return errorResult("Folder not found.");
    const access = await resolveFolderAccess({
      handle: resolved.blog.handle,
      folderId: folder.id,
      user: accessUser(extra),
    });
    return { blog: resolved.blog, access, scopeType, scopeId: folder.id };
  }
  const item = await requirePost(extra, scopeId);
  if (isToolResult(item)) return item;
  return {
    blog: item.blog,
    access: item.access,
    scopeType,
    scopeId: item.post.id!,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function markdownContentUpdate(
  post: Post,
  markdown: string,
):
  | { title: string; excerpt: string | undefined; body: string }
  | CallToolResult {
  let parsed: ReturnType<typeof parsePostMarkdownFile>;
  try {
    parsed = parsePostMarkdownFile(markdown);
  } catch (error) {
    return parseErrorResult(error);
  }
  if (parsed.unknownKeys.length > 0) {
    return errorResult(
      `Unsupported frontmatter keys: ${parsed.unknownKeys.join(", ")}.`,
    );
  }

  const protectedFields: Array<[keyof typeof parsed.fields, unknown]> = [
    ["type", post.type],
    ["slug", post.slug],
    ["status", post.status],
    ["date", post.date],
    ["accent", post.accent],
    ["cover", post.cover],
    ["coverCaption", post.coverCaption],
    ["coverHeight", post.coverHeight],
    ["pinned", Boolean(post.pinned)],
    ["gallery", post.gallery],
    ["links", post.links],
    ["videoUrl", post.videoUrl],
    ["venue", post.venue],
    ["duration", post.duration],
  ];
  for (const [key, stored] of protectedFields) {
    if (!Object.prototype.hasOwnProperty.call(parsed.fields, key)) continue;
    const incoming =
      key === "pinned" ? Boolean(parsed.fields.pinned) : parsed.fields[key];
    if (!sameValue(incoming, stored)) {
      return errorResult(
        `update_item cannot change ${key}. Use its dedicated workspace tool.`,
      );
    }
  }

  return {
    title: parsed.fields.title ?? post.title,
    excerpt: parsed.fields.excerpt ?? post.excerpt,
    body: parsed.body,
  };
}

function scopeError(name: WorkspaceToolName, extra: ToolContext): CallToolResult | null {
  const definition = WORKSPACE_TOOL_DEFINITIONS[name];
  const scope = resolveMcpScopeAccess(extra.authInfo?.scopes);
  if (scope === "none") {
    return errorResult("This token has no supported workspace scope.");
  }
  if (definition.requiredScope === "sync" && scope !== "full") {
    return errorResult(
      `This connection is read-only and cannot invoke ${name}.`,
    );
  }
  return null;
}

async function executeMcpTool(
  name: WorkspaceToolName,
  rawArgs: Record<string, unknown>,
  extra: ToolContext,
): Promise<CallToolResult> {
  const denied = scopeError(name, extra);
  if (denied) return denied;

  let args: WorkspaceToolInput<typeof name>;
  try {
    args = parseWorkspaceToolInput(name, rawArgs);
  } catch (error) {
    return errorResult(
      `Invalid arguments for ${name}: ${error instanceof Error ? error.message : "invalid input"}`,
    );
  }

  switch (name) {
    case "get_workspace": {
      const resolved = await requireWorkspace(extra);
      if (isToolResult(resolved)) return resolved;
      const scope = resolveMcpScopeAccess(extra.authInfo?.scopes);
      return jsonResult({
        workspace: {
          handle: resolved.blog.handle,
          username: resolved.blog.username ?? null,
          name: resolved.blog.name,
          author: resolved.blog.author,
        },
        access: {
          role: resolved.access.role,
          owner: resolved.access.isOwner,
          scope,
          grantedScopes: extra.authInfo?.scopes ?? [],
          canEdit: resolved.access.canEditContent && scope === "full",
          canManage: resolved.access.canManage && scope === "full",
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
      });
    }

    case "list_folders": {
      const resolved = await requireWorkspace(extra);
      if (isToolResult(resolved)) return resolved;
      const [folders, counts] = await Promise.all([
        getAccessibleFolders(resolved.blog.handle, accessUser(extra)),
        getAccessibleFolderCounts(resolved.blog.handle, accessUser(extra)),
      ]);
      return jsonResult({
        workspace: {
          handle: resolved.blog.handle,
          username: resolved.blog.username ?? null,
          name: resolved.blog.name,
        },
        folders: folders.map((folder) => folderSummary(folder, counts[folder.path] ?? 0)),
      });
    }

    case "create_folder": {
      const input = args as WorkspaceToolInput<"create_folder">;
      const resolved = await requireWorkspace(extra, true);
      if (isToolResult(resolved)) return resolved;
      try {
        const folder = await createSubfolder(
          resolved.blog.handle,
          input.parent_path,
          input.name,
        );
        await auditMcp(
          extra,
          "mcp.create_folder",
          "folder",
          folder.id,
          folder.path,
        );
        revalidateBlogPaths(resolved.blog);
        return jsonResult({ folder: folderSummary(folder) });
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : "Could not create folder.",
        );
      }
    }

    case "rename_folder": {
      const input = args as WorkspaceToolInput<"rename_folder">;
      const resolved = await requireWorkspace(extra, true);
      if (isToolResult(resolved)) return resolved;
      const folders = await getAccessibleFolders(resolved.blog.handle, accessUser(extra));
      if (!folders.some((folder) => folder.id === input.folder_id)) {
        return errorResult("Folder not found.");
      }
      try {
        const folder = await renameFolder(
          resolved.blog.handle,
          input.folder_id,
          input.name,
        );
        await auditMcp(
          extra,
          "mcp.rename_folder",
          "folder",
          folder.id,
          folder.name,
        );
        revalidateBlogPaths(resolved.blog);
        return jsonResult({ folder: folderSummary(folder) });
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : "Could not rename folder.",
        );
      }
    }

    case "delete_folder": {
      const input = args as WorkspaceToolInput<"delete_folder">;
      const resolved = await requireWorkspace(extra, true);
      if (isToolResult(resolved)) return resolved;
      const folder = (await getAccessibleFolders(
        resolved.blog.handle,
        accessUser(extra),
      )).find((entry) => entry.id === input.folder_id);
      if (!folder) return errorResult("Folder not found.");
      try {
        await trashFolder(resolved.blog.handle, folder.id);
        await auditMcp(
          extra,
          "mcp.delete_folder",
          "folder",
          folder.id,
          folder.path,
        );
        revalidateBlogPaths(resolved.blog);
        return jsonResult({ ok: true, folder: folderSummary(folder), trashed: true });
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : "Folder could not be moved to Trash.",
        );
      }
    }

    case "restore_folder": {
      const input = args as WorkspaceToolInput<"restore_folder">;
      const resolved = await requireWorkspace(extra, true);
      if (isToolResult(resolved)) return resolved;
      const folder = (await getTrashedFolders(resolved.blog.handle)).find(
        (entry) => entry.id === input.folder_id,
      );
      if (!folder) return errorResult("Folder not found in Trash.");
      try {
        await restoreFolder(resolved.blog.handle, folder.id);
        await auditMcp(
          extra,
          "mcp.restore_folder",
          "folder",
          folder.id,
          folder.path,
        );
        revalidateBlogPaths(resolved.blog);
        return jsonResult({ ok: true, folder: folderSummary(folder), restored: true });
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : "Folder could not be restored.",
        );
      }
    }

    case "list_items": {
      const input = args as WorkspaceToolInput<"list_items">;
      const blog = await requireBlog(extra);
      if (isToolResult(blog)) return blog;
      const path = input.folder_path ?? "blog";
      const folder = await accessibleFolder(blog, extra, path);
      if (isToolResult(folder)) return folder;
      const posts = await getAccessibleFolderPostFiles(
        blog.handle,
        folder.path,
        accessUser(extra),
      );
      return jsonResult({
        folder: folderSummary(folder),
        items: posts
          .filter((post) => post.id)
          .slice(0, input.limit ?? 50)
          .map((post) => itemEntry(blog, post)),
      });
    }

    case "list_trash": {
      const resolved = await requireWorkspace(extra, true);
      if (isToolResult(resolved)) return resolved;
      const [posts, folders] = await Promise.all([
        getTrashedPosts(resolved.blog.handle),
        getTrashedFolders(resolved.blog.handle),
      ]);
      const trashedFolderIds = new Set(folders.map((folder) => folder.id));
      const folderUnits = folders.filter(
        (folder) => !folder.parentId || !trashedFolderIds.has(folder.parentId),
      );
      return jsonResult({
        folders: folderUnits.map((folder) => folderSummary(folder)),
        items: posts
          .filter((post) => !post.folderId || !trashedFolderIds.has(post.folderId))
          .map((post) => {
          const entry = itemEntry(resolved.blog, post);
          return { ...entry, file: undefined, folderId: post.folderId ?? null };
          }),
      });
    }

    case "read_item": {
      const input = args as WorkspaceToolInput<"read_item">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      return textResult(renderItemFile(resolved.blog, resolved.post).text);
    }

    case "search": {
      const input = args as WorkspaceToolInput<"search">;
      const blog = await requireBlog(extra);
      if (isToolResult(blog)) return blog;
      const posts = await getAccessibleAllPostFiles(blog.handle, accessUser(extra));
      const results = posts
        .filter((post) => post.id && postMatchesQuery(post, input.query))
        .slice(0, input.limit ?? 25)
        .map((post) => ({
          ...itemEntry(blog, post),
          snippet: searchSnippet(post, input.query),
        }));
      return jsonResult({ query: input.query, results });
    }

    case "create_item": {
      const input = args as WorkspaceToolInput<"create_item">;
      const blog = await requireBlog(extra);
      if (isToolResult(blog)) return blog;
      const folder = await accessibleFolder(blog, extra, input.folder_path);
      if (isToolResult(folder)) return folder;
      const folderAccess = await resolveFolderAccess({
        handle: blog.handle,
        folderId: folder.id,
        user: accessUser(extra),
      });
      if (!folderAccess.isOwner) {
        return errorResult("Only the owner can create items in this folder.");
      }

      let parsed: ReturnType<typeof parsePostMarkdownFile>;
      try {
        parsed = input.markdown
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
      } catch (error) {
        return parseErrorResult(error);
      }
      if (parsed.unknownKeys.length > 0) {
        return errorResult(
          `Unsupported frontmatter keys: ${parsed.unknownKeys.join(", ")}.`,
        );
      }
      if (parsed.fields.status === "published") {
        return errorResult(
          "New items must start as drafts. Create it first, then use set_item_status after human confirmation.",
        );
      }
      if (parsed.fields.pinned) {
        return errorResult(
          "New items cannot start pinned. Create it first, then use set_item_pinned.",
        );
      }
      if (parsed.fields.date) {
        return errorResult(
          "A draft cannot have a publication date. Set the date after publishing.",
        );
      }

      const type = parsed.fields.type ?? DEFAULT_TYPE_BY_MODE[folder.mode];
      if (folderModeForType(type) !== folder.mode) {
        return errorResult(
          `Kind "${itemKindForPost({ type })}" does not belong in ` +
            `"${folder.path}", which holds ${kindsForFolderMode(folder.mode)} items.`,
        );
      }

      const created = await createDraftInFolder(blog.handle, folder.id);
      try {
        const saved = await savePost(blog.handle, {
          ...created,
          ...parsed.fields,
          type,
          status: "draft",
          pinned: false,
          date: undefined,
          slug: slugForNewFile(parsed.fields, created.slug),
          body: parsed.body,
        });
        await auditMcp(extra, "mcp.create_item", "item", saved.id, saved.title);
        revalidateBlogPaths(blog, [saved.slug]);
        return jsonResult({
          folder: folderSummary(folder),
          item: itemEntry(blog, saved),
        });
      } catch (error) {
        if (created.id) await deletePost(blog.handle, created.id).catch(() => {});
        return saveErrorResult(error);
      }
    }

    case "update_item": {
      const input = args as WorkspaceToolInput<"update_item">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      const { blog, post, access } = resolved;
      if (!access.canEditContent) return errorResult("You cannot edit this item.");
      const stale = hashConflict(blog, post, input.if_match_hash);
      if (stale) return stale;
      const revision = mutationRevision(post);
      if (typeof revision !== "number") return revision;

      const content = input.markdown
        ? markdownContentUpdate(post, input.markdown)
        : {
            title: input.title ?? post.title,
            excerpt:
              input.excerpt === null ? undefined : (input.excerpt ?? post.excerpt),
            body: input.body ?? post.body,
          };
      if (isToolResult(content)) return content;
      if (!access.isOwner && input.excerpt !== undefined) {
        return errorResult("Only the owner can change an item's excerpt.");
      }
      // Only a real body change can clobber a live co-editing session; a
      // title/excerpt-only edit leaves the Yjs document alone.
      if (content.body !== post.body && post.id && (await hasActiveCoEditors(post.id))) {
        return coEditingConflictResult(post);
      }

      try {
        const saved = access.isOwner
          ? await savePost(
              blog.handle,
              {
                ...post,
                ...content,
                status: isAlwaysDraftType(post.type) ? "draft" : post.status,
                date: post.status === "published" ? post.date : undefined,
              },
              { expectedRevision: revision },
            )
          : await savePostContentPatch(
              blog.handle,
              post,
              { title: content.title, body: content.body },
              { expectedRevision: revision },
            );
        await auditMcp(extra, "mcp.update_item", "item", saved.id, saved.title);
        revalidateBlogPaths(blog, [post.slug, saved.slug]);
        return jsonResult({ item: itemEntry(blog, saved) });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(post, "the update could be saved");
        }
        return saveErrorResult(error);
      }
    }

    case "append_to_item": {
      const input = args as WorkspaceToolInput<"append_to_item">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      const { blog, post, access } = resolved;
      if (!access.canEditContent) return errorResult("You cannot edit this item.");
      const stale = hashConflict(blog, post, input.if_match_hash);
      if (stale) return stale;
      const revision = mutationRevision(post);
      if (typeof revision !== "number") return revision;
      // Appending rewrites the whole body, which a live co-editing session
      // owns; refuse rather than have the next autosave discard it.
      if (post.id && (await hasActiveCoEditors(post.id))) {
        return coEditingConflictResult(post);
      }
      const fragment = input.markdown_fragment.trim();
      const base = post.body.replace(/\s+$/, "");
      const body = base ? `${base}\n\n${fragment}` : fragment;
      try {
        const saved = access.isOwner
          ? await savePost(
              blog.handle,
              {
                ...post,
                body,
                status: isAlwaysDraftType(post.type) ? "draft" : post.status,
                date: post.status === "published" ? post.date : undefined,
              },
              { expectedRevision: revision },
            )
          : await savePostContentPatch(
              blog.handle,
              post,
              { body },
              { expectedRevision: revision },
            );
        await auditMcp(extra, "mcp.append_to_item", "item", saved.id, saved.title);
        revalidateBlogPaths(blog, [saved.slug]);
        return jsonResult({ item: itemEntry(blog, saved) });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(post, "the append could be saved");
        }
        return saveErrorResult(error);
      }
    }

    case "move_item": {
      const input = args as WorkspaceToolInput<"move_item">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.canEditContent) {
        return errorResult("You cannot move this item.");
      }
      const folder = await accessibleFolder(resolved.blog, extra, input.folder_path);
      if (isToolResult(folder)) return folder;
      const targetAccess = await resolveFolderAccess({
        handle: resolved.blog.handle,
        folderId: folder.id,
        user: accessUser(extra),
      });
      if (!targetAccess.canEditContent) {
        return errorResult("You cannot move items into this folder.");
      }
      const stale = hashConflict(resolved.blog, resolved.post, input.if_match_hash);
      if (stale) return stale;
      const revision = mutationRevision(resolved.post);
      if (typeof revision !== "number") return revision;
      try {
        const moved = await movePostFile(
          resolved.blog.handle,
          input.id,
          {
            folderId: folder.id,
            expectedRevision: revision,
          },
          mcpAuditEntry(extra, "mcp.move_item", "item", input.id, folder.path),
        );
        if (!moved) return errorResult("Item not found.");
        if (moved.changed) {
          // The mcp.move_item audit was written atomically inside movePostFile.
          revalidateBlogPaths(resolved.blog, [moved.post.slug]);
        }
        return jsonResult({
          changed: moved.changed,
          folder: folderSummary(folder),
          item: itemEntry(resolved.blog, moved.post),
        });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(resolved.post, "the move could be saved");
        }
        return errorResult(error instanceof Error ? error.message : "Could not move item.");
      }
    }

    case "delete_item": {
      const input = args as WorkspaceToolInput<"delete_item">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.isOwner) {
        return errorResult("Only the owner can move this item to Trash.");
      }
      const stale = hashConflict(resolved.blog, resolved.post, input.if_match_hash);
      if (stale) return stale;
      const revision = mutationRevision(resolved.post);
      if (typeof revision !== "number") return revision;
      try {
        await deletePostAtomic(
          resolved.blog.handle,
          input.id,
          revision,
          mcpAuditEntry(extra, "mcp.delete_item", "item", input.id, resolved.post.title),
        );
        // The mcp.delete_item audit was written atomically inside deletePostAtomic.
        revalidateBlogPaths(resolved.blog, [resolved.post.slug]);
        return jsonResult({ ok: true, id: input.id, trashed: true });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(resolved.post, "it could be moved to Trash");
        }
        return errorResult("The item could not be moved to Trash.");
      }
    }

    case "restore_item": {
      const input = args as WorkspaceToolInput<"restore_item">;
      const resolved = await requireWorkspace(extra, true);
      if (isToolResult(resolved)) return resolved;
      const trashed = await getTrashedPosts(resolved.blog.handle);
      const post = trashed.find((entry) => entry.id === input.id);
      if (!post) return errorResult("Item not found in Trash.");
      if (isAlwaysDraftType(post.type) && post.status === "published") {
        return errorResult(
          "Notes and bookmarks must be unlisted before restoration.",
        );
      }
      try {
        const restored = await restorePost(resolved.blog.handle, input.id);
        await auditMcp(
          extra,
          "mcp.restore_item",
          "item",
          input.id,
          restored.title,
        );
        revalidateBlogPaths(resolved.blog, [restored.slug]);
        return jsonResult({ item: itemEntry(resolved.blog, restored) });
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : "The item could not be restored.",
        );
      }
    }

    case "set_item_status": {
      const input = args as WorkspaceToolInput<"set_item_status">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.isOwner) {
        return errorResult("Only the owner can change publication status.");
      }
      if (isAlwaysDraftType(resolved.post.type) && input.status === "published") {
        return errorResult("Notes and bookmarks are always unlisted.");
      }
      const stale = hashConflict(resolved.blog, resolved.post, input.if_match_hash);
      if (stale) return stale;
      const revision = mutationRevision(resolved.post);
      if (typeof revision !== "number") return revision;
      if (resolved.post.status === input.status) {
        return jsonResult({ changed: false, item: itemEntry(resolved.blog, resolved.post) });
      }
      try {
        const saved = await savePost(
          resolved.blog.handle,
          {
            ...resolved.post,
            status: isAlwaysDraftType(resolved.post.type) ? "draft" : input.status,
            date:
              input.status === "published" ? resolved.post.date : undefined,
          },
          { expectedRevision: revision },
        );
        await auditMcp(
          extra,
          input.status === "published"
            ? "mcp.publish_item"
            : "mcp.unpublish_item",
          "item",
          saved.id,
          saved.title,
        );
        revalidateBlogPaths(resolved.blog, [resolved.post.slug, saved.slug]);
        return jsonResult({ changed: true, item: itemEntry(resolved.blog, saved) });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(resolved.post, "the status change could be saved");
        }
        return saveErrorResult(error);
      }
    }

    case "set_item_metadata": {
      const input = args as WorkspaceToolInput<"set_item_metadata">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.isOwner) {
        return errorResult("Only the owner can change item metadata.");
      }
      const stale = hashConflict(resolved.blog, resolved.post, input.if_match_hash);
      if (stale) return stale;
      const revision = mutationRevision(resolved.post);
      if (typeof revision !== "number") return revision;
      if (input.date !== undefined && resolved.post.status !== "published") {
        return errorResult("Publication date can only be set on a published item.");
      }
      const next: Post = {
        ...resolved.post,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.excerpt !== undefined
          ? { excerpt: input.excerpt ?? undefined }
          : {}),
        ...(input.accent !== undefined
          ? { accent: input.accent ?? undefined }
          : {}),
        ...(input.cover !== undefined ? { cover: input.cover ?? undefined } : {}),
        ...(input.cover_caption !== undefined
          ? { coverCaption: input.cover_caption ?? undefined }
          : {}),
        ...(input.cover_height !== undefined
          ? { coverHeight: input.cover_height ?? undefined }
          : {}),
        ...(input.date !== undefined ? { date: input.date } : {}),
        status: isAlwaysDraftType(resolved.post.type)
          ? "draft"
          : resolved.post.status,
        pinned: resolved.post.pinned,
      };
      const changed =
        next.title !== resolved.post.title ||
        next.slug !== resolved.post.slug ||
        next.excerpt !== resolved.post.excerpt ||
        next.accent !== resolved.post.accent ||
        next.cover !== resolved.post.cover ||
        next.coverCaption !== resolved.post.coverCaption ||
        next.coverHeight !== resolved.post.coverHeight ||
        next.date !== resolved.post.date;
      if (!changed) {
        return jsonResult({ changed: false, item: itemEntry(resolved.blog, resolved.post) });
      }
      try {
        const saved = await savePost(resolved.blog.handle, next, {
          expectedRevision: revision,
        });
        await auditMcp(
          extra,
          "mcp.set_item_metadata",
          "item",
          saved.id,
          saved.title,
        );
        revalidateBlogPaths(resolved.blog, [resolved.post.slug, saved.slug]);
        return jsonResult({ changed: true, item: itemEntry(resolved.blog, saved) });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(resolved.post, "the metadata change could be saved");
        }
        return saveErrorResult(error);
      }
    }

    case "set_item_pinned": {
      const input = args as WorkspaceToolInput<"set_item_pinned">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.isOwner) {
        return errorResult("Only the owner can pin or unpin items.");
      }
      const stale = hashConflict(resolved.blog, resolved.post, input.if_match_hash);
      if (stale) return stale;
      const revision = mutationRevision(resolved.post);
      if (typeof revision !== "number") return revision;
      if (Boolean(resolved.post.pinned) === input.pinned) {
        return jsonResult({ changed: false, item: itemEntry(resolved.blog, resolved.post) });
      }
      try {
        const saved = await savePost(
          resolved.blog.handle,
          {
            ...resolved.post,
            pinned: input.pinned,
            status: isAlwaysDraftType(resolved.post.type)
              ? "draft"
              : resolved.post.status,
            date:
              resolved.post.status === "published" ? resolved.post.date : undefined,
          },
          { expectedRevision: revision },
        );
        await auditMcp(
          extra,
          input.pinned ? "mcp.pin_item" : "mcp.unpin_item",
          "item",
          saved.id,
          saved.title,
        );
        revalidateBlogPaths(resolved.blog, [saved.slug]);
        return jsonResult({ changed: true, item: itemEntry(resolved.blog, saved) });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(resolved.post, "the pin change could be saved");
        }
        return saveErrorResult(error);
      }
    }

    case "list_access": {
      const input = args as WorkspaceToolInput<"list_access">;
      const target = await accessTarget(extra, input.scope_type, input.scope_id);
      if (isToolResult(target)) return target;
      if (!target.access.canManage) return errorResult("You cannot manage this access list.");
      return jsonResult({
        scope: { type: target.scopeType, id: target.scopeId },
        access: await listScopeShares(target.scopeType, target.scopeId),
      });
    }

    case "grant_access": {
      const input = args as WorkspaceToolInput<"grant_access">;
      const target = await accessTarget(extra, input.scope_type, input.scope_id);
      if (isToolResult(target)) return target;
      if (!target.access.canManage) return errorResult("You cannot manage this access list.");
      const sub = requiredSub(extra);
      if (typeof sub !== "string") return sub;
      try {
        const share = await inviteScopeShare({
          scopeType: target.scopeType,
          scopeId: target.scopeId,
          email: input.email,
          role: input.role as ScopeShareRole,
          invitedBySub: sub,
          actorType: "external_agent",
          actorUserId: accessUser(extra).userId,
          auditActionName: "mcp.grant_access",
        });
        return jsonResult({ share });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Access could not be granted.");
      }
    }

    case "set_access_role": {
      const input = args as WorkspaceToolInput<"set_access_role">;
      const target = await accessTarget(extra, input.scope_type, input.scope_id);
      if (isToolResult(target)) return target;
      if (!target.access.canManage) return errorResult("You cannot manage this access list.");
      const sub = requiredSub(extra);
      if (typeof sub !== "string") return sub;
      const current = await listScopeShares(target.scopeType, target.scopeId);
      if (!current.some((share) => share.id === input.access_id)) {
        return errorResult("Access grant not found.");
      }
      try {
        await updateScopeShareRole({
          scopeType: target.scopeType,
          scopeId: target.scopeId,
          shareId: input.access_id,
          role: input.role as ScopeShareRole,
          updatedBySub: sub,
          actorType: "external_agent",
          actorUserId: accessUser(extra).userId,
          auditActionName: "mcp.set_access_role",
        });
        return jsonResult({
          access: await listScopeShares(target.scopeType, target.scopeId),
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Access role could not be changed.");
      }
    }

    case "revoke_access": {
      const input = args as WorkspaceToolInput<"revoke_access">;
      const target = await accessTarget(extra, input.scope_type, input.scope_id);
      if (isToolResult(target)) return target;
      if (!target.access.canManage) return errorResult("You cannot manage this access list.");
      const sub = requiredSub(extra);
      if (typeof sub !== "string") return sub;
      const current = await listScopeShares(target.scopeType, target.scopeId);
      if (!current.some((share) => share.id === input.access_id)) {
        return jsonResult({ changed: false, access: current });
      }
      try {
        await revokeScopeShare(
          target.scopeType,
          target.scopeId,
          input.access_id,
          sub,
          {
            actorType: "external_agent",
            actorUserId: accessUser(extra).userId,
            auditActionName: "mcp.revoke_access",
          },
        );
        return jsonResult({
          changed: true,
          access: await listScopeShares(target.scopeType, target.scopeId),
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Access could not be revoked.");
      }
    }

    case "list_comments": {
      const input = args as WorkspaceToolInput<"list_comments">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      const resolvedFilter =
        input.state === "open"
          ? false
          : input.state === "resolved"
            ? true
            : undefined;
      return jsonResult({
        itemId: input.id,
        comments: await listItemComments(input.id, { resolved: resolvedFilter }),
      });
    }

    case "add_comment": {
      const input = args as WorkspaceToolInput<"add_comment">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      const comment = await createItemComment(
        {
          itemId: input.id,
          parentId: input.parent_comment_id ?? null,
          body: input.body,
          anchor:
            input.anchor_field && input.anchor_exact
              ? {
                  field: input.anchor_field,
                  exactQuote: input.anchor_exact,
                  ...(input.anchor_start === undefined ? {} : { start: input.anchor_start }),
                  ...(input.anchor_end === undefined ? {} : { end: input.anchor_end }),
                }
              : null,
        },
        {
          actorUserId: resolved.access.userId,
          actorType: "external_agent",
          actorName: "External agent",
        },
      );
      await auditMcp(extra, "mcp.add_comment", "item", input.id, input.body);
      return jsonResult({ comment });
    }

    case "set_comment_resolved": {
      const input = args as WorkspaceToolInput<"set_comment_resolved">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.canEditContent) {
        return errorResult("You cannot resolve comments on this item.");
      }
      const comments = await listItemComments(input.id);
      if (!comments.some((comment) => comment.id === input.comment_id)) {
        return errorResult("Comment not found.");
      }
      const comment = await setItemCommentResolved({
        itemId: input.id,
        commentId: input.comment_id,
        resolved: input.resolved,
        actor: {
          actorUserId: resolved.access.userId,
          actorType: "external_agent",
          actorName: "External agent",
        },
      });
      await auditMcp(
        extra,
        input.resolved ? "mcp.resolve_comment" : "mcp.reopen_comment",
        "item",
        input.id,
        input.comment_id,
      );
      return jsonResult({ comment });
    }

    case "recapture_bookmark": {
      const input = args as WorkspaceToolInput<"recapture_bookmark">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.isOwner || resolved.post.type !== "bookmark") {
        return errorResult("Only the owner can recapture a bookmark.");
      }
      const stale = hashConflict(resolved.blog, resolved.post, input.if_match_hash);
      if (stale) return stale;
      const source = resolved.post.links?.[0]?.href ?? resolved.post.capture?.url;
      if (!source) return errorResult("Bookmark has no original URL.");
      let sourceUrl: URL;
      try {
        sourceUrl = new URL(source);
      } catch {
        return errorResult("Bookmark has no valid original URL.");
      }
      if (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:") {
        return errorResult("Bookmark has no valid original URL.");
      }
      const pending = await markCapturePending(
        resolved.blog.handle,
        input.id,
        sourceUrl.toString(),
      );
      if (!pending) return errorResult("Bookmark not found.");
      await auditMcp(
        extra,
        "mcp.recapture_bookmark",
        "item",
        input.id,
        sourceUrl.toString(),
      );
      revalidateBlogPaths(resolved.blog, [resolved.post.slug]);
      return jsonResult({ queued: true, item: itemEntry(resolved.blog, pending) });
    }

    case "list_item_assets": {
      const input = args as WorkspaceToolInput<"list_item_assets">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      return jsonResult({
        itemId: input.id,
        assets: listItemAssetReferences(resolved.post),
      });
    }

    case "add_item_asset": {
      const input = args as WorkspaceToolInput<"add_item_asset">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.isOwner) return errorResult("Only the owner can attach item assets.");
      const stale = hashConflict(resolved.blog, resolved.post, input.if_match_hash);
      if (stale) return stale;
      const revision = mutationRevision(resolved.post);
      if (typeof revision !== "number") return revision;
      try {
        const asset = await importItemAssetFromUrl({
          handle: resolved.blog.handle,
          itemId: input.id,
          sourceUrl: input.source_url,
          media: input.placement === "cover" ? "image" : "image-or-video",
        });
        const saved = await savePost(
          resolved.blog.handle,
          {
            ...attachItemAsset(resolved.post, asset, input.placement, {
              altText: input.alt_text,
              caption: input.caption,
            }),
            status: isAlwaysDraftType(resolved.post.type)
              ? "draft"
              : resolved.post.status,
            date: resolved.post.status === "published" ? resolved.post.date : undefined,
          },
          { expectedRevision: revision },
        );
        await auditMcp(
          extra,
          "mcp.add_item_asset",
          "item",
          input.id,
          `${input.placement}: ${asset.filename} (${asset.bytes} bytes)`,
        );
        revalidateBlogPaths(resolved.blog, [saved.slug]);
        return jsonResult({ asset, item: itemEntry(resolved.blog, saved) });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(resolved.post, "the asset could be attached");
        }
        return errorResult(error instanceof Error ? error.message : "Asset could not be attached.");
      }
    }

    case "remove_item_asset": {
      const input = args as WorkspaceToolInput<"remove_item_asset">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.isOwner) return errorResult("Only the owner can remove item assets.");
      const stale = hashConflict(resolved.blog, resolved.post, input.if_match_hash);
      if (stale) return stale;
      const revision = mutationRevision(resolved.post);
      if (typeof revision !== "number") return revision;
      const { changed, post: next } = removeItemAssetReferences(
        resolved.post,
        input.asset_url,
      );
      if (!changed) return jsonResult({ changed: false, item: itemEntry(resolved.blog, resolved.post) });
      try {
        const saved = await savePost(resolved.blog.handle, next, {
          expectedRevision: revision,
        });
        await auditMcp(
          extra,
          "mcp.remove_item_asset",
          "item",
          input.id,
          input.asset_url,
        );
        revalidateBlogPaths(resolved.blog, [saved.slug]);
        return jsonResult({ changed: true, item: itemEntry(resolved.blog, saved) });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(resolved.post, "the asset could be removed");
        }
        return saveErrorResult(error);
      }
    }

    case "set_item_cover": {
      const input = args as WorkspaceToolInput<"set_item_cover">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.isOwner) return errorResult("Only the owner can set an item cover.");
      const stale = hashConflict(resolved.blog, resolved.post, input.if_match_hash);
      if (stale) return stale;
      const revision = mutationRevision(resolved.post);
      if (typeof revision !== "number") return revision;
      if (
        input.source === "url" &&
        !listItemAssetReferences(resolved.post).some((asset) => asset.url === input.url)
      ) {
        return errorResult("Import or attach that asset before using it as the cover.");
      }
      const cover =
        input.source === "url"
          ? input.url
          : input.source === "none"
            ? NO_COVER_VALUE
            : undefined;
      try {
        const saved = await savePost(
          resolved.blog.handle,
          {
            ...resolved.post,
            cover,
            coverCaption:
              input.caption === null ? undefined : (input.caption ?? resolved.post.coverCaption),
            coverHeight:
              input.height === null ? undefined : (input.height ?? resolved.post.coverHeight),
          },
          { expectedRevision: revision },
        );
        await auditMcp(
          extra,
          "mcp.set_item_cover",
          "item",
          input.id,
          input.source,
        );
        revalidateBlogPaths(resolved.blog, [saved.slug]);
        return jsonResult({ item: itemEntry(resolved.blog, saved) });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(resolved.post, "the cover could be changed");
        }
        return saveErrorResult(error);
      }
    }
  }
}

export function registerWriteTools(server: McpServer): void {
  const register = server.registerTool.bind(server) as unknown as RegisterTool;
  for (const name of WORKSPACE_TOOL_NAMES) {
    const definition = WORKSPACE_TOOL_DEFINITIONS[name];
    register(
      name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: definition.annotations,
      },
      (args, extra) => executeMcpTool(name, args, extra),
    );
  }
}

/**
 * Run a workspace tool for an in-app SESSION actor (the cloud assistant rung),
 * reusing the exact same executor as the MCP server so every privacy, audit, and
 * permission invariant is shared rather than re-implemented. The session is
 * granted full workspace capability, but per-item access is still enforced from
 * the resolved user (`accessUser`), so full-access scope does not bypass sharing.
 *
 * NOTE: the shared executor currently records `actorType: "external_agent"` for
 * mutations. That mislabels the built-in assistant; giving the in-app assistant a
 * distinct actor label is a small follow-up tracked in the BYO-cloud plan.
 */
export async function runWorkspaceToolForSession(
  name: WorkspaceToolName,
  args: Record<string, unknown>,
  actor: { sub: string; userId: string | null },
): Promise<CallToolResult> {
  const extra: ToolContext = {
    authInfo: {
      token: "session",
      clientId: "in-app-assistant",
      scopes: [WORKSPACE_SCOPE_CAPABILITIES.fullAccess],
      extra: { sub: actor.sub, userId: actor.userId },
    },
  };
  return executeMcpTool(name, args, extra);
}
