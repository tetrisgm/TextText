import type { AuthInfo } from "./types";
import type { CallToolResult, ToolAnnotations } from "./types";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { recordAction, type AuditActorType, type AuditEntry } from "@/lib/audit";
import {
  applyLiveDocumentMutation,
  agentSelectionAtEnd,
  hasActiveCoEditors,
  markCollabMaterialized,
  materializeCollabDocument,
  upsertPresence,
  type AgentSelectionState,
} from "@/lib/collab";
import { listDocumentResponses } from "@/lib/documents/responses.server";
import type { AgentFocusEvent } from "@/lib/collab/agent-focus";
import type { DocumentMutation } from "@/lib/collab/document";
import { buildAgentPresence } from "@/lib/collab/agent-presence.server";
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
import { requireDocumentSnapshot } from "@/lib/documents/model";
import {
  attachItemAsset,
  importItemAssetFromUrl,
  listItemAssetReferences,
  removeItemAssetReferences,
} from "@/lib/item-assets";
import { parseItemInput } from "@/lib/item-creation";
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
import { blogPostEditPath, blogPostPath } from "@/lib/public-paths";
import { normalizeTags } from "@/lib/tags";
import { applyTemplateOperations } from "@/lib/presentation/operations";
import {
  inviteScopeShare,
  listScopeShares,
  revokeScopeShare,
} from "@/lib/shares";
import type { ScopeShareRole } from "@/lib/shares";
import {
  createItemComment,
  claimIdempotencyKey,
  createDocumentTemplateVersion,
  createDraftInFolder,
  createSubfolder,
  deletePost,
  deletePostAtomic,
  getBlog,
  getDocumentTemplate,
  getAccessibleAllPostFiles,
  getAccessibleFolderCounts,
  getAccessibleFolderPostFiles,
  getAccessibleFolders,
  getPostById,
  getPostStoreContext,
  getTrashedFolders,
  getTrashedPosts,
  listItemComments,
  listDocumentTemplates,
  markCapturePending,
  movePostFile,
  PostConflictError,
  renameFolder,
  releaseIdempotencyKey,
  resolveIdempotencyKey,
  restoreFolder,
  restorePost,
  savePost,
  savePostContentPatch,
  setItemCommentResolved,
  signalWorkspaceChange,
  trashFolder,
} from "@/lib/store";
import { workspaceBlog } from "./auth";
import {
  type BacklinkRef,
  DEFAULT_TYPE_BY_MODE,
  folderModeForType,
  isAlwaysDraftType,
  itemBacklinks,
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

export type ToolContext = { authInfo?: AuthInfo };
type ToolTargetType = "workspace" | "folder" | "item" | "mode";
type RegisteredCallback = (
  args: Record<string, unknown>,
  extra: ToolContext,
) => Promise<CallToolResult>;
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
  const text = JSON.stringify(value, null, 2);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      content: [{ type: "text", text }],
      structuredContent: value as Record<string, unknown>,
    };
  }
  return textResult(text);
}

function automationKey(operation: "create" | "append", key: string): string {
  return `agent:${operation}:${key}`;
}

function idempotencyInflightResult(): CallToolResult {
  return errorResult(
    "This operation is already in progress. Retry shortly with the same idempotency_key.",
  );
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

function accessUser(extra: ToolContext): AccessUser {
  const sub = extra.authInfo?.extra?.sub;
  const userId = extra.authInfo?.extra?.userId;
  return {
    sub: typeof sub === "string" ? sub : null,
    userId: typeof userId === "string" ? userId : null,
  };
}

// The audit actor for this executor call. An external MCP connection audits as
// external_agent; the in-app assistant (a session actor via
// runWorkspaceToolForSession) passes actorType "ai", so its mutations are
// labelled correctly in action_audit rather than looking like an outside agent.
function mcpActorType(extra: ToolContext): AuditActorType {
  const value = extra.authInfo?.extra?.actorType;
  return value === "ai" || value === "human" ? value : "external_agent";
}

function agentPresence(
  extra: ToolContext,
  state: {
    selection?: AgentSelectionState | null;
    focus?: AgentFocusEvent | null;
  } = {},
) {
  if (mcpActorType(extra) !== "external_agent") return null;
  const userId = extra.authInfo?.extra?.userId;
  if (typeof userId !== "string" || !userId) return null;
  return buildAgentPresence(
    {
      userId,
      connectionName: extra.authInfo?.extra?.connectionName as string,
    },
    state,
  );
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
    actorType: mcpActorType(extra),
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
    actorType: mcpActorType(extra),
    actionName,
    targetType,
    targetId,
    inputSummary: summary,
  };
}

async function saveLiveContentMutation({
  blog,
  post,
  access,
  mutation,
  ownerPatch,
  audit,
  extra,
}: {
  blog: Blog;
  post: Post;
  access: EffectiveAccess;
  mutation: DocumentMutation;
  ownerPatch?: Partial<Post>;
  audit: AuditEntry;
  extra: ToolContext;
}): Promise<Post> {
  if (!post.id) throw new Error("The item has no stable id");
  const selectionField: AgentSelectionState["field"] =
    mutation.body !== undefined || mutation.appendBody !== undefined
      ? "body"
      : mutation.title !== undefined
        ? "title"
        : "subtitle";
  const presence = agentPresence(extra, {
    selection: await agentSelectionAtEnd(post.id, selectionField),
  });
  if (presence) await upsertPresence(post.id, presence);
  const applied = await applyLiveDocumentMutation(post.id, mutation);
  if (!applied) throw new Error("The live document could not be updated");
  if (presence) {
    await upsertPresence(
      post.id,
      agentPresence(extra, {
        selection: await agentSelectionAtEnd(post.id, selectionField),
      }) ?? presence,
    );
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const context = await getPostStoreContext(post.id);
    if (!context || context.handle !== blog.handle) {
      throw new Error("The item no longer exists");
    }
    const snapshot =
      (await materializeCollabDocument(post.id)) ?? applied.snapshot;
    const current = context.post;
    const revision = current.revision;
    if (typeof revision !== "number") {
      throw new Error("The item has no revision");
    }
    try {
      const saved = access.isOwner
        ? await savePost(
            blog.handle,
            {
              ...current,
              ...ownerPatch,
              document: snapshot,
              title: snapshot.content.title,
              excerpt: snapshot.content.subtitle,
              body: snapshot.content.body,
              tags: snapshot.content.tags,
              status: isAlwaysDraftType(current.type)
                ? "draft"
                : current.status,
              date:
                current.status === "published"
                  ? (ownerPatch?.date ?? current.date)
                  : undefined,
            },
            { expectedRevision: revision, audit },
          )
        : await savePostContentPatch(
            blog.handle,
            current,
            { document: snapshot },
            { expectedRevision: revision, audit },
          );
      await markCollabMaterialized(post.id, saved.revision ?? revision);
      return saved;
    } catch (error) {
      if (!(error instanceof PostConflictError) || attempt === 2) throw error;
    }
  }
  throw new PostConflictError();
}

function isToolResult<T extends object>(
  value: T | CallToolResult,
): value is CallToolResult {
  return "content" in value;
}

async function requireBlog(extra: ToolContext): Promise<Blog | CallToolResult> {
  const requestedHandle = extra.authInfo?.extra?.workspaceHandle;
  const blog =
    typeof requestedHandle === "string" && requestedHandle
      ? await getBlog(requestedHandle)
      : await workspaceBlog(extra.authInfo);
  if (!blog) {
    return errorResult(
      "No workspace exists for this token's user. Open the editor once to create one.",
    );
  }
  if (typeof requestedHandle === "string" && requestedHandle) {
    const access = await resolveWorkspaceAccess({
      handle: blog.handle,
      user: accessUser(extra),
    });
    if (!access.canView) {
      return errorResult("You cannot access this workspace.");
    }
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

async function mcpItemEntry(
  extra: ToolContext,
  blog: Blog,
  post: Post,
  options: {
    hash?: string;
    backlinks?: BacklinkRef[];
    visiblePosts?: Post[];
  } = {},
) {
  const visiblePosts =
    options.visiblePosts ??
    (await getAccessibleAllPostFiles(blog.handle, accessUser(extra)));
  return itemEntry(blog, post, { ...options, visiblePosts });
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
  | {
      title: string;
      excerpt: string | undefined;
      body: string;
      tags: string[];
      slug: string;
      accent: string | undefined;
      cover: string | undefined;
      coverCaption: string | undefined;
      coverHeight: number | undefined;
      date: string | undefined;
      pinned: boolean;
    }
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

  // update_item owns content plus owner metadata on both structured and full
  // markdown paths. Keep only publication, kind or folder-implying fields and
  // unrelated workspace metadata protected here.
  const protectedFields: Array<[keyof typeof parsed.fields, unknown]> = [
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
      return errorResult(
        `update_item cannot change ${key}.`,
      );
    }
  }

  return {
    title: parsed.fields.title ?? post.title,
    excerpt: parsed.fields.excerpt ?? post.excerpt,
    body: parsed.body,
    tags: Object.prototype.hasOwnProperty.call(parsed.fields, "tags")
      ? normalizeTags(parsed.fields.tags)
      : normalizeTags(post.tags),
    slug: parsed.fields.slug ?? post.slug,
    accent: Object.prototype.hasOwnProperty.call(parsed.fields, "accent")
      ? parsed.fields.accent
      : post.accent,
    cover: Object.prototype.hasOwnProperty.call(parsed.fields, "cover")
      ? parsed.fields.cover
      : post.cover,
    coverCaption: Object.prototype.hasOwnProperty.call(parsed.fields, "coverCaption")
      ? parsed.fields.coverCaption
      : post.coverCaption,
    coverHeight: Object.prototype.hasOwnProperty.call(parsed.fields, "coverHeight")
      ? parsed.fields.coverHeight
      : post.coverHeight,
    date: Object.prototype.hasOwnProperty.call(parsed.fields, "date")
      ? parsed.fields.date
      : post.date,
    pinned: Object.prototype.hasOwnProperty.call(parsed.fields, "pinned")
      ? Boolean(parsed.fields.pinned)
      : Boolean(post.pinned),
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

export async function executeMcpTool(
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
          documentTemplates: true,
        },
      });
    }

    case "list_document_templates": {
      const resolved = await requireWorkspace(extra);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.blogId) return errorResult("Workspace not found.");
      return jsonResult({
        templates: await listDocumentTemplates(resolved.access.blogId),
      });
    }

    case "customize_document_template": {
      const input = args as WorkspaceToolInput<"customize_document_template">;
      const resolved = await requireWorkspace(extra, true);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.blogId) return errorResult("Workspace not found.");
      const base = await getDocumentTemplate(resolved.access.blogId, {
        id: input.base_template_id,
        version: input.base_template_version,
      });
      if (!base) return errorResult("Base template not found.");
      try {
        const candidate = applyTemplateOperations(
          {
            ...base,
            id: input.template_id,
            version: 1,
            name: input.name,
          },
          input.operations,
        );
        const template = await createDocumentTemplateVersion({
          blogId: resolved.access.blogId,
          definition: candidate,
          createdById: resolved.access.userId,
          actor: mcpAuditEntry(
            extra,
            "mcp.customize_document_template",
            "mode",
            input.template_id,
            input.name,
          ),
        });
        return jsonResult({ template });
      } catch (error) {
        return errorResult(
          error instanceof Error
            ? `Template rejected: ${error.message}`
            : "Template rejected.",
        );
      }
    }

    case "set_item_template": {
      const input = args as WorkspaceToolInput<"set_item_template">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.canEditContent) {
        return errorResult("You cannot change this item's template.");
      }
      const stale = hashConflict(resolved.blog, resolved.post, input.if_match_hash);
      if (stale) return stale;
      const revision = mutationRevision(resolved.post);
      if (typeof revision !== "number") return revision;
      if (!resolved.access.blogId) return errorResult("Workspace not found.");
      const reference = {
        id: input.template_id,
        version: input.template_version,
      };
      const template = await getDocumentTemplate(resolved.access.blogId, reference);
      if (!template) return errorResult("Template not found.");
      const current = requireDocumentSnapshot(
        resolved.post.document,
        `Persisted item ${resolved.post.id ?? resolved.post.slug}`,
      );
      if (
        current.presentation.template.id === reference.id &&
        current.presentation.template.version === reference.version
      ) {
        return jsonResult({
          item: await mcpItemEntry(extra, resolved.blog, resolved.post),
          template,
        });
      }
      try {
        const saved = await savePost(
          resolved.blog.handle,
          {
            ...resolved.post,
            document: {
              ...current,
              presentation: {
                ...current.presentation,
                template: reference,
              },
            },
            template: reference,
          },
          {
            expectedRevision: revision,
            audit: mcpAuditEntry(
              extra,
              "mcp.set_item_template",
              "item",
              resolved.post.id,
              `${reference.id}@${reference.version}`,
            ),
          },
        );
        revalidateBlogPaths(resolved.blog, [saved.slug]);
        return jsonResult({
          item: await mcpItemEntry(extra, resolved.blog, saved),
          template,
        });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(resolved.post, "the template could be applied");
        }
        return saveErrorResult(error);
      }
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
      const [posts, visiblePosts] = await Promise.all([
        getAccessibleFolderPostFiles(blog.handle, folder.path, accessUser(extra)),
        getAccessibleAllPostFiles(blog.handle, accessUser(extra)),
      ]);
      return jsonResult({
        folder: folderSummary(folder),
        items: await Promise.all(
          posts
            .filter((post) => post.id)
            .slice(0, input.limit ?? 50)
            .map((post) =>
              mcpItemEntry(extra, blog, post, { visiblePosts }),
            ),
        ),
      });
    }

    case "list_trash": {
      const resolved = await requireWorkspace(extra, true);
      if (isToolResult(resolved)) return resolved;
      const [posts, folders, visiblePosts] = await Promise.all([
        getTrashedPosts(resolved.blog.handle),
        getTrashedFolders(resolved.blog.handle),
        getAccessibleAllPostFiles(resolved.blog.handle, accessUser(extra)),
      ]);
      const trashedFolderIds = new Set(folders.map((folder) => folder.id));
      const folderUnits = folders.filter(
        (folder) => !folder.parentId || !trashedFolderIds.has(folder.parentId),
      );
      const items = await Promise.all(
        posts
          .filter((post) => !post.folderId || !trashedFolderIds.has(post.folderId))
          .map(async (post) => {
            const entry = await mcpItemEntry(extra, resolved.blog, post, {
              visiblePosts,
            });
            return { ...entry, file: undefined, folderId: post.folderId ?? null };
          }),
      );
      return jsonResult({
        folders: folderUnits.map((folder) => folderSummary(folder)),
        items,
      });
    }

    case "read_item": {
      const input = args as WorkspaceToolInput<"read_item">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      const rendered = renderItemFile(resolved.blog, resolved.post);
      const livePosts = await getAccessibleAllPostFiles(
        resolved.blog.handle,
        accessUser(extra),
      );
      const backlinks = await itemBacklinks(
        resolved.blog,
        resolved.post,
        livePosts,
      );
      return jsonResult({
        item: await mcpItemEntry(extra, resolved.blog, resolved.post, {
          hash: rendered.hash,
          backlinks,
          visiblePosts: livePosts,
        }),
        markdown: rendered.text,
        assets: listItemAssetReferences(resolved.post),
      });
    }

    case "open_item": {
      const input = args as WorkspaceToolInput<"open_item">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      const folders = await getAccessibleFolders(
        resolved.blog.handle,
        accessUser(extra),
      );
      const folderPath =
        folders.find((folder) => folder.id === resolved.post.folderId)?.path ??
        "blog";
      const mode = input.mode ?? "read";
      if (!resolved.post.id) throw new Error("The item has no stable id");
      const postId = resolved.post.id;
      const path =
        mode === "edit"
          ? blogPostEditPath(resolved.blog, resolved.post)
          : blogPostPath(resolved.blog, resolved.post);
      const nativeUrl =
        `write-app://item/${encodeURIComponent(postId)}` +
        `?workspace=${encodeURIComponent(resolved.blog.handle)}` +
        `&mode=${mode}`;
      const userId = extra.authInfo?.extra?.userId;
      const focus =
        typeof userId === "string" && userId
          ? {
              eventId: randomUUID(),
              targetUserId: userId,
              workspaceHandle: resolved.blog.handle,
              folderPath,
              postId,
              path,
              mode,
              requestedAt: new Date().toISOString(),
            } satisfies AgentFocusEvent
          : null;
      const presence = agentPresence(extra, {
        selection: await agentSelectionAtEnd(postId, "body"),
        focus,
      });
      if (presence) {
        await upsertPresence(postId, presence);
        await signalWorkspaceChange(resolved.blog.handle);
      }
      await auditMcp(
        extra,
        "mcp.open_item",
        "item",
        postId,
        `${mode}:${folderPath}`,
      );
      return jsonResult({
        ok: true,
        workspace: resolved.blog.handle,
        folder_path: folderPath,
        item: {
          id: postId,
          title: resolved.post.title,
          path,
        },
        mode,
        native_url: nativeUrl,
      });
    }

    case "search": {
      const input = args as WorkspaceToolInput<"search">;
      const blog = await requireBlog(extra);
      if (isToolResult(blog)) return blog;
      const posts = await getAccessibleAllPostFiles(blog.handle, accessUser(extra));
      const results = await Promise.all(
        posts
          .filter((post) => post.id && postMatchesQuery(post, input.query))
          .slice(0, input.limit ?? 25)
          .map(async (post) => ({
            ...(await mcpItemEntry(extra, blog, post, { visiblePosts: posts })),
            snippet: searchSnippet(post, input.query),
          })),
      );
      return jsonResult({ query: input.query, results });
    }

    case "create_item": {
      const input = args as WorkspaceToolInput<"create_item">;
      const blog = await requireBlog(extra);
      if (isToolResult(blog)) return blog;
      const folder = await accessibleFolder(
        blog,
        extra,
        input.folder_path ?? "blog",
      );
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
                title:
                  input.title ??
                  (input.body ? parseItemInput(input.body).title : undefined),
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
          "New items cannot start pinned. Create it first, then use update_item with pinned.",
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

      const retryKey = input.idempotency_key
        ? automationKey("create", input.idempotency_key)
        : null;
      if (retryKey) {
        const claim = await claimIdempotencyKey(blog.handle, retryKey);
        if (claim.status === "inflight") return idempotencyInflightResult();
        if (claim.status === "done") {
          if (claim.kind !== "post") {
            return errorResult("The idempotency key belongs to a different operation.");
          }
          const existing = await getPostById(blog.handle, claim.id);
          if (!existing) {
            return errorResult(
              "The original item for this idempotency key is unavailable.",
            );
          }
          return jsonResult({
            item: await mcpItemEntry(extra, blog, existing),
            replayed: true,
          });
        }
      }
      let created: Post;
      try {
        created = await createDraftInFolder(blog.handle, folder.id);
      } catch (error) {
        if (retryKey) {
          await releaseIdempotencyKey(blog.handle, retryKey).catch(() => {});
        }
        return saveErrorResult(error);
      }
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
        }, {
          audit: mcpAuditEntry(
            extra,
            "mcp.create_item",
            "item",
            created.id,
            parsed.fields.title ?? created.title,
          ),
        });
        if (retryKey && saved.id) {
          await resolveIdempotencyKey(blog.handle, retryKey, "post", saved.id);
        }
        revalidateBlogPaths(blog, [saved.slug]);
        return jsonResult({
          item: await mcpItemEntry(extra, blog, saved),
          replayed: false,
        });
      } catch (error) {
        if (created.id) await deletePost(blog.handle, created.id).catch(() => {});
        if (retryKey) {
          await releaseIdempotencyKey(blog.handle, retryKey).catch(() => {});
        }
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
            tags:
              input.tags !== undefined
                ? normalizeTags(input.tags)
                : normalizeTags(post.tags),
            slug: input.slug ?? post.slug,
            accent:
              input.accent === null ? undefined : (input.accent ?? post.accent),
            cover: input.cover === null ? undefined : (input.cover ?? post.cover),
            coverCaption:
              input.cover_caption === null
                ? undefined
                : (input.cover_caption ?? post.coverCaption),
            coverHeight:
              input.cover_height === null
                ? undefined
                : (input.cover_height ?? post.coverHeight),
            date: input.date ?? post.date,
            pinned: input.pinned ?? Boolean(post.pinned),
          };
      if (isToolResult(content)) return content;
      if (content.date !== post.date && post.status !== "published") {
        return errorResult("Publication date can only be set on a published item.");
      }
      const ownerMetadataChanged =
        content.excerpt !== post.excerpt ||
        content.slug !== post.slug ||
        content.accent !== post.accent ||
        content.cover !== post.cover ||
        content.coverCaption !== post.coverCaption ||
        content.coverHeight !== post.coverHeight ||
        content.date !== post.date ||
        content.pinned !== Boolean(post.pinned);
      const ownerMetadataRequested = input.markdown
        ? ownerMetadataChanged
        : input.excerpt !== undefined ||
          input.slug !== undefined ||
          input.accent !== undefined ||
          input.cover !== undefined ||
          input.cover_caption !== undefined ||
          input.cover_height !== undefined ||
          input.date !== undefined ||
          input.pinned !== undefined;
      if (!access.isOwner && ownerMetadataRequested) {
        return errorResult(
          "Only the owner can change excerpt, slug, accent, cover, date, or pin metadata.",
        );
      }
      if (
        content.cover !== post.cover &&
        content.cover &&
        content.cover !== NO_COVER_VALUE &&
        !listItemAssetReferences(post).some((asset) => asset.url === content.cover)
      ) {
        return errorResult("Import or attach that asset before using it as the cover.");
      }
      // Custom template fields travel as a PATCH applied inside savePost's
      // canonicalDocumentForSave, which holds the authoritative row. Building
      // the merged document here would need post.document loaded, and list
      // reads legitimately omit it.
      const requestedFields = input.fields ?? null;
      const existingFields = post.document?.content.fields ?? null;
      const fieldsChanged =
        requestedFields !== null &&
        (existingFields === null ||
          Object.entries(requestedFields).some(
            ([key, value]) =>
              JSON.stringify(existingFields[key] ?? null) !==
              JSON.stringify(value),
          ));
      const next: Post = {
        ...post,
        ...content,
        status: isAlwaysDraftType(post.type) ? "draft" : post.status,
        date: post.status === "published" ? content.date : undefined,
      };
      const contentFields = [
        content.title !== post.title ? "title" : null,
        content.excerpt !== post.excerpt ? "excerpt" : null,
        content.body !== post.body ? "body" : null,
        !sameValue(content.tags, normalizeTags(post.tags)) ? "tags" : null,
        fieldsChanged ? "fields" : null,
      ].filter((field): field is string => field !== null);
      const metadataFields = [
        content.slug !== post.slug ? "slug" : null,
        content.accent !== post.accent ? "accent" : null,
        content.cover !== post.cover ? "cover" : null,
        content.coverCaption !== post.coverCaption ? "cover_caption" : null,
        content.coverHeight !== post.coverHeight ? "cover_height" : null,
        content.date !== post.date ? "date" : null,
      ].filter((field): field is string => field !== null);
      const pinChanged = content.pinned !== Boolean(post.pinned);
      if (contentFields.length === 0 && metadataFields.length === 0 && !pinChanged) {
        return jsonResult({ item: await mcpItemEntry(extra, blog, post) });
      }
      const summary = [
        contentFields.length > 0 ? `content (${contentFields.join(", ")})` : null,
        metadataFields.length > 0
          ? `metadata (${metadataFields.join(", ")})`
          : null,
        pinChanged ? "pin (pinned)" : null,
      ]
        .filter((group): group is string => group !== null)
        .join("; ");
      const audit = mcpAuditEntry(
        extra,
        "mcp.update_item",
        "item",
        post.id,
        summary,
      );
      const useLiveDocument =
        contentFields.length > 0 &&
        Boolean(post.id && (await hasActiveCoEditors(post.id)));
      if (fieldsChanged && useLiveDocument) {
        return errorResult(
          "Someone is editing this document right now; field values cannot change mid-session. Retry when the session ends.",
        );
      }

      try {
        const saved = useLiveDocument
          ? await saveLiveContentMutation({
              blog,
              post,
              access,
              mutation: {
                title:
                  content.title !== post.title ? content.title : undefined,
                subtitle:
                  content.excerpt !== post.excerpt
                    ? (content.excerpt ?? null)
                    : undefined,
                body: content.body !== post.body ? content.body : undefined,
                tags: !sameValue(content.tags, normalizeTags(post.tags))
                  ? content.tags
                  : undefined,
              },
              ownerPatch: access.isOwner
                ? {
                    slug: content.slug,
                    accent: content.accent,
                    cover: content.cover,
                    coverCaption: content.coverCaption,
                    coverHeight: content.coverHeight,
                    date: content.date,
                    pinned: content.pinned,
                  }
                : undefined,
              audit,
              extra,
            })
          : access.isOwner
            ? await savePost(
                blog.handle,
                next,
                {
                  expectedRevision: revision,
                  audit,
                  ...(fieldsChanged && requestedFields
                    ? { fieldsPatch: requestedFields }
                    : {}),
                },
              )
            : await savePostContentPatch(
                blog.handle,
                post,
                {
                  title: content.title,
                  body: content.body,
                  tags: content.tags,
                },
                { expectedRevision: revision, audit },
              );
        if (pinChanged) {
          await auditMcp(
            extra,
            content.pinned ? "mcp.pin_item" : "mcp.unpin_item",
            "item",
            saved.id,
            saved.title,
          );
        }
        revalidateBlogPaths(blog, [post.slug, saved.slug]);
        return jsonResult({ item: await mcpItemEntry(extra, blog, saved) });
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
      const retryKey = input.idempotency_key
        ? automationKey("append", input.idempotency_key)
        : null;
      if (retryKey) {
        const claim = await claimIdempotencyKey(blog.handle, retryKey);
        if (claim.status === "inflight") return idempotencyInflightResult();
        if (claim.status === "done") {
          if (claim.kind !== "post" || claim.id !== post.id) {
            return errorResult("The idempotency key belongs to a different item.");
          }
          return jsonResult({
            item: await mcpItemEntry(extra, blog, post),
            replayed: true,
          });
        }
      }
      const stale = hashConflict(blog, post, input.if_match_hash);
      if (stale) {
        if (retryKey) {
          await releaseIdempotencyKey(blog.handle, retryKey).catch(() => {});
        }
        return stale;
      }
      const revision = mutationRevision(post);
      if (typeof revision !== "number") {
        if (retryKey) {
          await releaseIdempotencyKey(blog.handle, retryKey).catch(() => {});
        }
        return revision;
      }
      const fragment = input.markdown_fragment.trim();
      const base = post.body.replace(/\s+$/, "");
      const body = base ? `${base}\n\n${fragment}` : fragment;
      const audit = mcpAuditEntry(
        extra,
        "mcp.append_to_item",
        "item",
        post.id,
        post.title,
      );
      const useLiveDocument = Boolean(
        post.id && (await hasActiveCoEditors(post.id)),
      );
      try {
        const saved = useLiveDocument
          ? await saveLiveContentMutation({
              blog,
              post,
              access,
              mutation: {
                appendBody: fragment,
                operationId: retryKey ?? undefined,
              },
              audit,
              extra,
            })
          : access.isOwner
            ? await savePost(
                blog.handle,
                {
                  ...post,
                  body,
                  status: isAlwaysDraftType(post.type) ? "draft" : post.status,
                  date: post.status === "published" ? post.date : undefined,
                },
                { expectedRevision: revision, audit },
              )
            : await savePostContentPatch(
                blog.handle,
                post,
                { body },
                { expectedRevision: revision, audit },
              );
        if (retryKey && saved.id) {
          await resolveIdempotencyKey(blog.handle, retryKey, "post", saved.id);
        }
        revalidateBlogPaths(blog, [saved.slug]);
        return jsonResult({
          item: await mcpItemEntry(extra, blog, saved),
          replayed: false,
        });
      } catch (error) {
        if (retryKey) {
          await releaseIdempotencyKey(blog.handle, retryKey).catch(() => {});
        }
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
          item: await mcpItemEntry(extra, resolved.blog, moved.post),
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
        return jsonResult({
          item: await mcpItemEntry(extra, resolved.blog, resolved.post),
          trashed: true,
        });
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
        return jsonResult({
          item: await mcpItemEntry(extra, resolved.blog, restored),
          restored: true,
        });
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
        return jsonResult({
          item: await mcpItemEntry(extra, resolved.blog, resolved.post),
        });
      }
      try {
        const saved = await savePost(
          resolved.blog.handle,
          {
            ...resolved.post,
            status: isAlwaysDraftType(resolved.post.type) ? "draft" : input.status,
            visibility:
              input.status === "published" ? "public" : "private",
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
        return jsonResult({
          item: await mcpItemEntry(extra, resolved.blog, saved),
        });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(resolved.post, "the status change could be saved");
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

    case "set_access": {
      const input = args as WorkspaceToolInput<"set_access">;
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
          actorType: mcpActorType(extra),
          actorUserId: accessUser(extra).userId,
          auditActionName: "mcp.set_access",
        });
        return jsonResult({ share });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Access could not be set.");
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
            actorType: mcpActorType(extra),
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

    case "list_responses": {
      const input = args as WorkspaceToolInput<"list_responses">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      const responses = await listDocumentResponses(input.id);
      const tallies: Record<string, Record<string, number>> = {};
      for (const response of responses) {
        const byOption = (tallies[response.fieldId] ??= {});
        for (const value of response.values) {
          byOption[value] = (byOption[value] ?? 0) + 1;
        }
      }
      return jsonResult({ itemId: input.id, tallies, responses });
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
          actorType: mcpActorType(extra),
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
          actorType: mcpActorType(extra),
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
      return jsonResult({
        item: await mcpItemEntry(extra, resolved.blog, pending),
        queued: true,
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
        return jsonResult({
          item: await mcpItemEntry(extra, resolved.blog, saved),
        });
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
      if (!changed) {
        return jsonResult({
          item: await mcpItemEntry(extra, resolved.blog, resolved.post),
        });
      }
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
        return jsonResult({
          item: await mcpItemEntry(extra, resolved.blog, saved),
        });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(resolved.post, "the asset could be removed");
        }
        return saveErrorResult(error);
      }
    }

  }
}

/**
 * Run a workspace tool for an in-app SESSION actor (the cloud assistant rung),
 * reusing the exact same executor as the MCP server so every privacy, audit, and
 * permission invariant is shared rather than re-implemented. The session is
 * granted full workspace capability, but per-item access is still enforced from
 * the resolved user (`accessUser`), so full-access scope does not bypass sharing.
 *
 * Mutations audit as `actorType: "ai"` (via the `actorType` passed in authInfo
 * and read by `mcpActorType`), so the built-in assistant is distinguished from
 * external MCP agents in `action_audit`.
 */
export async function runWorkspaceToolForSession(
  name: WorkspaceToolName,
  args: Record<string, unknown>,
  actor: { sub: string; userId: string | null; handle: string },
): Promise<CallToolResult> {
  const extra: ToolContext = {
    authInfo: {
      token: "session",
      clientId: "in-app-assistant",
      scopes: [WORKSPACE_SCOPE_CAPABILITIES.fullAccess],
      extra: {
        sub: actor.sub,
        userId: actor.userId,
        actorType: "ai",
        workspaceHandle: actor.handle,
      },
    },
  };
  return executeMcpTool(name, args, extra);
}

export async function runWorkspaceToolForAuth(
  name: WorkspaceToolName,
  args: Record<string, unknown>,
  extra: ToolContext,
): Promise<CallToolResult> {
  return executeMcpTool(name, args, extra);
}
