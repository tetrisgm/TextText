import { assessItemTypeQuality } from "@/lib/presentation/item-type-quality";
import type { AuthInfo } from "./types";
import type { CallToolResult, ToolAnnotations } from "./types";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  recordAction,
  type AuditActorType,
  type AuditEntry,
} from "@/lib/audit";
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
import {
  DocumentSectionConflictError,
  DocumentTextRangeConflictError,
  replaceMarkdownSectionBodyIfUnchanged,
  type DocumentMutation,
} from "@/lib/collab/document";
import { buildAgentPresence } from "@/lib/collab/agent-presence.server";
import {
  WORKSPACE_FOLDER_MODES,
  WORKSPACE_SCOPE_CAPABILITIES,
  WORKSPACE_TOOL_DEFINITIONS,
  parseWorkspaceToolInput,
} from "@/lib/ai/tools";
import type { WorkspaceToolInput, WorkspaceToolName } from "@/lib/ai/tools";
import type { Blog, Folder, Post } from "@/lib/content";
import { NO_COVER_VALUE } from "@/lib/cover";
import {
  emptyDocumentSnapshot,
  requireDocumentSnapshot,
  validateDocumentSnapshot,
} from "@/lib/documents/model";
import {
  isLivingBrief,
  parseLivingBrief,
  reviewLivingBriefSources,
  validateLivingBriefDocument,
  type CurrentBriefSource,
} from "@/lib/documents/grounding";
import {
  attachItemAsset,
  importItemAssetFromUrl,
  listItemAssetReferences,
  removeItemAssetReferences,
} from "@/lib/item-assets";
import { captureFolderPath, captureIntent } from "@/lib/capture-intent";
import { parseItemInput } from "@/lib/item-creation";
import {
  parsePostMarkdownFile,
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
import {
  createWorkspaceItemType,
  updateWorkspaceItemType,
} from "@/lib/presentation/item-type.server";
import {
  inviteScopeShare,
  listScopeShares,
  revokeScopeShare,
} from "@/lib/shares";
import type { ScopeShareRole } from "@/lib/shares";
import {
  createItemComment,
  claimIdempotencyKey,
  createDraftInFolder,
  createSubfolder,
  deletePostAtomic,
  getBlog,
  getDocumentTemplate,
  getAccessibleAllPostFiles,
  getAccessibleFolderCounts,
  getAccessibleFolderPostFiles,
  getAccessibleFolders,
  getFolderByPath,
  getPostById,
  getPostStoreContext,
  getTrashedFolders,
  getTrashedPosts,
  listItemComments,
  listDocumentTemplates,
  listEditableItemTypes,
  retireDocumentTemplate,
  saveDocumentAsLook,
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
  retemplateFolderItems,
  setFolderTemplate,
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
  postSearchScore,
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
type McpScopeAccess = "full" | "read-only" | "none";

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
  const detail =
    error instanceof Error && error.message ? ` ${error.message}` : "";
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
/** How the in-app assistant identifies itself as a collaborator. */
const ASSISTANT_CONNECTION_NAME = "Assistant";

function mcpActorType(extra: ToolContext): AuditActorType {
  const value = extra.authInfo?.extra?.actorType;
  return value === "ai" || value === "human" ? value : "external_agent";
}

function boundedMcpConnectionName(extra: ToolContext): string {
  const raw = extra.authInfo?.extra?.connectionName;
  if (typeof raw === "string") {
    const value = raw.trim().slice(0, 120);
    if (value && !/[\u0000-\u001f\u007f]/.test(value)) return value;
  }
  return "";
}

function mcpActorDisplayName(extra: ToolContext): string {
  return (
    boundedMcpConnectionName(extra) ||
    (mcpActorType(extra) === "ai" ? "TextText Assistant" : "External agent")
  );
}

function agentPresence(
  extra: ToolContext,
  state: {
    selection?: AgentSelectionState | null;
    focus?: AgentFocusEvent | null;
  } = {},
) {
  // A human actor already has presence of their own, published by their
  // browser. Every non-human actor needs presence built for it, or its edit
  // arrives in an open document with nobody attached to it, which is exactly
  // what a human edit never looks like. That includes the in-app assistant,
  // which is actorType "ai" rather than "external_agent".
  if (mcpActorType(extra) === "human") return null;
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
  await recordAction(
    mcpAuditEntry(extra, actionName, targetType, targetId, summary),
  );
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
  const trustedIntent = extra.authInfo?.extra?.actorIntent;
  const actorName =
    mcpActorType(extra) === "external_agent"
      ? boundedMcpConnectionName(extra)
      : "";
  const intent =
    typeof trustedIntent === "string" ? trustedIntent.trim().slice(0, 500) : "";
  const attributedSummary =
    actorName || intent
      ? [
          actorName ? `Agent: ${actorName}` : null,
          intent ? `Intent: ${intent}` : null,
          summary,
        ]
          .filter((part): part is string => Boolean(part))
          .join("; ")
      : summary;
  return {
    actorUserId: typeof userId === "string" ? userId : null,
    actorType: mcpActorType(extra),
    actionName,
    targetType,
    targetId,
    inputSummary: attributedSummary,
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
    mutation.textRange !== undefined
      ? mutation.textRange.field
      : mutation.body !== undefined ||
          mutation.appendBody !== undefined ||
          mutation.bodySection !== undefined
        ? "body"
        : mutation.title !== undefined
          ? "title"
          : "subtitle";
  const presence = agentPresence(extra, {
    selection: await agentSelectionAtEnd(post.id, selectionField),
  });
  if (presence) await upsertPresence(post.id, presence);
  // The Yjs delta becomes visible before canonical materialization. Write its
  // audit row in the same database statement so a later CAS failure can never
  // leave a durable, unaudited edit in the collaboration log.
  const applied = await applyLiveDocumentMutation(post.id, mutation, audit);
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
            {
              expectedRevision: revision,
              audit,
              auditAlreadyRecorded: applied.auditRecorded,
            },
          )
        : await savePostContentPatch(
            blog.handle,
            current,
            { document: snapshot },
            {
              expectedRevision: revision,
              audit,
              auditAlreadyRecorded: applied.auditRecorded,
            },
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
): Promise<
  { blog: Blog; post: Post; access: EffectiveAccess } | CallToolResult
> {
  const blog = await requireBlog(extra);
  if (isToolResult(blog)) return blog;
  const post = UUID_RE.test(id) ? await getPostById(blog.handle, id) : null;
  if (!post)
    return errorResult(`No item with id "${id}" exists in this workspace.`);
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
  return (
    post.revision ??
    errorResult(
      "This item has no revision and cannot be mutated safely. Read it again and retry.",
    )
  );
}

function folderSummary(folder: Folder, count?: number) {
  return {
    id: folder.id,
    name: folder.name,
    path: folder.path,
    mode: folder.mode,
    parentId: folder.parentId ?? null,
    // The folder's look: what its index renders from and what new items in it
    // are created with. It was omitted, so an agent could set a folder's look
    // with set_folder_template and never read one back - unable to tell
    // whether its own change landed, or to answer what a folder looks like
    // today.
    defaultTemplate: folder.defaultTemplate ?? null,
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
  if (!scopeId || !UUID_RE.test(scopeId))
    return errorResult("Scope not found.");
  if (scopeType === "folder") {
    const folder = (
      await getAccessibleFolders(resolved.blog.handle, accessUser(extra))
    ).find((entry) => entry.id === scopeId);
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

function replaceTextRangeIfUnchanged(
  current: string,
  edit: {
    start: number;
    end: number;
    expected_text: string;
    replacement_text: string;
  },
): string | null {
  if (
    edit.start < 0 ||
    edit.end < edit.start ||
    edit.end > current.length ||
    current.slice(edit.start, edit.end) !== edit.expected_text
  ) {
    return null;
  }
  return `${current.slice(0, edit.start)}${edit.replacement_text}${current.slice(edit.end)}`;
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
      return errorResult(`update_item cannot change ${key}.`);
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
    coverCaption: Object.prototype.hasOwnProperty.call(
      parsed.fields,
      "coverCaption",
    )
      ? parsed.fields.coverCaption
      : post.coverCaption,
    coverHeight: Object.prototype.hasOwnProperty.call(
      parsed.fields,
      "coverHeight",
    )
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

function scopeError(
  name: WorkspaceToolName,
  extra: ToolContext,
): CallToolResult | null {
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
      // The blueprints come back BESIDE the definitions, never inside them.
      // A definition is what renders; a blueprint is what a person or a model
      // edits. Without this the only way to change a look was to re-author it
      // from compiled output, which is not the language anything writes in.
      const [templates, authoring] = await Promise.all([
        listDocumentTemplates(resolved.access.blogId),
        listEditableItemTypes(resolved.access.blogId),
      ]);
      const { editable, needsMigration } = authoring;
      // Summaries, not whole definitions. A definition is a render tree, and
      // handing over eleven of them was 24,000 characters of a vocabulary the
      // model cannot write in, which buried the blueprints it can. What it
      // needs to answer "what kinds of thing do I have" is the name, the
      // purpose, the fields and the folder layout.
      const summarised = templates.map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        version: template.version,
        folderLayout: template.collection.layout,
        fields: template.fields.map((field) => ({
          id: field.id,
          label: field.label,
          type: field.type,
        })),
      }));
      return jsonResult({
        // Editable first: it is the part a model acts on, and the part that
        // fell off the end when this answer was one long list of render trees.
        editable,
        templates: summarised,
        // Named rather than merely absent. A look designed here that this
        // build's compiler would no longer reproduce is not the same thing as
        // one that was never designed, and saying so is not optional.
        needsMigration,
        note: [
          editable.length
            ? "Types under `editable` can be changed with update_item_type: send its blueprint back with your edit and the version shown."
            : "No type here can be changed with update_item_type.",
          needsMigration.length
            ? `Types under \`needsMigration\` were designed here but with an older version of the designer, so changing them would alter how they render. They are left as they are.`
            : "",
          "Anything in neither list was assembled rather than designed - built-ins, imports, duplicates, and looks saved from a document - and is edited by hand.",
        ]
          .filter(Boolean)
          .join(" "),
      });
    }

    case "create_item_type": {
      const input = args as WorkspaceToolInput<"create_item_type">;
      const resolved = await requireWorkspace(extra, true);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.blogId) return errorResult("Workspace not found.");
      // The same quality bar the studio route applies, which until now ran on
      // only one of the two lanes that reach this executor. The look suite
      // watched a running tracker be saved with no date, no distance and an
      // index that errored, because it came through the tool and the tool had
      // no opinion. An error here is the agent lane's repair loop: the model
      // reads it and calls again with the properties it forgot.
      const quality = assessItemTypeQuality(input.blueprint);
      const blocking = quality.findings.filter(
        (item) => item.severity === "important",
      );
      if (blocking.length) {
        return errorResult(
          `This item type is not ready to save. ${blocking
            .map((item) => item.message)
            .join(" ")}`,
        );
      }
      try {
        const created = await createWorkspaceItemType({
          actor: mcpAuditEntry(
            extra,
            "mcp.create_item_type",
            "mode",
            undefined,
            input.blueprint.name,
          ),
          applyToExisting: input.apply_to_existing,
          blogId: resolved.access.blogId,
          blueprint: input.blueprint,
          folderPath: input.folder_path,
          handle: resolved.blog.handle,
        });

        return jsonResult({
          itemType: created.definition,
          folder: created.folder,
          note: input.folder_path
            ? "The reusable type is saved and the folder now uses it."
            : "The reusable type is saved and available in every look picker.",
        });
      } catch (error) {
        return errorResult(
          error instanceof Error
            ? error.message
            : "The item type could not be created.",
        );
      }
    }

    case "update_item_type": {
      const input = args as WorkspaceToolInput<"update_item_type">;
      const resolved = await requireWorkspace(extra, true);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.blogId) return errorResult("Workspace not found.");
      // The same bar creation is held to. An edit that strips a type back to
      // nothing is as bad as creating one that way, and worse if it restyles
      // the items already wearing it.
      const quality = assessItemTypeQuality(input.blueprint);
      const blocking = quality.findings.filter(
        (item) => item.severity === "important",
      );
      if (blocking.length) {
        return errorResult(
          `This change would leave the item type unusable. ${blocking
            .map((item) => item.message)
            .join(" ")}`,
        );
      }
      try {
        const updated = await updateWorkspaceItemType({
          actor: mcpAuditEntry(
            extra,
            "mcp.update_item_type",
            "mode",
            undefined,
            input.blueprint.name,
          ),
          apply: input.apply,
          applyToExisting: input.apply_to_existing,
          baseVersion: input.base_version,
          blogId: resolved.access.blogId,
          blueprint: input.blueprint,
          handle: resolved.blog.handle,
          templateId: input.template_id,
        });
        // Everything that did not happen is said out loud. A half-restyled
        // folder reported as a finished one is the failure this is for.
        const left = updated.applied.reduce(
          (total, entry) => total + entry.itemsLeft,
          0,
        );
        const busy = updated.applied.reduce(
          (total, entry) => total + entry.itemsBeingEdited,
          0,
        );
        const notes = [
          updated.applied.length
            ? `Version ${updated.definition.version} is live in ${updated.applied
                .map((entry) => entry.path)
                .join(", ")}. Version ${updated.previousVersion} is kept, and anything still on it renders as it did.`
            : `Version ${updated.definition.version} is saved but not applied anywhere yet.`,
          left
            ? `${left} item(s) were not restyled in this pass. Run it again to continue.`
            : "",
          busy
            ? `${busy} item(s) were being edited at that moment and kept their old look, so their words were not overwritten. Run it again when they are done.`
            : "",
          updated.skipped.length
            ? `Left alone because they are pinned to an older version: ${updated.skipped
                .map((entry) => `${entry.path} (version ${entry.pinnedTo})`)
                .join(", ")}.`
            : "",
        ].filter(Boolean);
        return jsonResult({
          itemType: updated.definition,
          previousVersion: updated.previousVersion,
          applied: updated.applied,
          skipped: updated.skipped,
          note: notes.join(" "),
        });
      } catch (error) {
        return errorResult(
          error instanceof Error
            ? error.message
            : "The item type could not be changed.",
        );
      }
    }

    case "save_item_as_look": {
      const input = args as WorkspaceToolInput<"save_item_as_look">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.canEditContent) {
        return errorResult("You cannot save a look from this item.");
      }
      if (!resolved.access.blogId) return errorResult("Workspace not found.");
      try {
        const look = await saveDocumentAsLook({
          blogId: resolved.access.blogId,
          handle: resolved.blog.handle,
          postId: resolved.post.id ?? input.id,
          name: input.name,
          actor: mcpAuditEntry(
            extra,
            "mcp.save_item_as_look",
            "item",
            resolved.post.id,
            input.name,
          ),
        });
        return jsonResult({
          look: { id: look.id, version: look.version, name: look.name },
          note: "Apply it with set_item_template, or give it to a folder with set_folder_template.",
        });
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : "Could not save that look.",
        );
      }
    }

    case "set_folder_template": {
      const input = args as WorkspaceToolInput<"set_folder_template">;
      const resolved = await requireWorkspace(extra, true);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.blogId) return errorResult("Workspace not found.");
      const folder = await getFolderByPath(
        resolved.blog.handle,
        input.folder_path,
      );
      if (!folder) return errorResult("Folder not found.");
      try {
        const reference = {
          id: input.template_id,
          version: input.template_version,
        };
        const updated = await setFolderTemplate(
          resolved.blog.handle,
          folder.id,
          reference,
          {
            audit: mcpAuditEntry(
              extra,
              "mcp.set_folder_template",
              "folder",
              folder.id,
              `${input.template_id}@${input.template_version}`,
            ),
          },
        );
        // Everything already in the folder moves too, unless the caller asked
        // otherwise. A folder whose index changed while every item in it kept
        // the old look reads as the request not having worked.
        const restyled =
          input.apply_to_existing === false
            ? { changed: 0, contested: 0, remaining: 0 }
            : await retemplateFolderItems(
                resolved.blog.handle,
                folder.id,
                reference,
                {
                  audit: (post) =>
                    mcpAuditEntry(
                      extra,
                      "mcp.set_item_template",
                      "item",
                      post.id,
                      `${input.template_id}@${input.template_version}`,
                    ),
                },
              );
        revalidateBlogPaths(resolved.blog, []);
        return jsonResult({
          folder: updated,
          restyledItems: restyled.changed,
          itemsLeftUnchanged: restyled.remaining,
          // Items someone was editing at that moment keep their old look
          // rather than losing what was being typed into them.
          itemsBeingEdited: restyled.contested,
          template: await getDocumentTemplate(
            resolved.access.blogId,
            reference,
          ),
        });
      } catch (error) {
        return errorResult(
          error instanceof Error
            ? error.message
            : "The folder's look could not be set.",
        );
      }
    }

    case "retire_document_template": {
      const input = args as WorkspaceToolInput<"retire_document_template">;
      const resolved = await requireWorkspace(extra, true);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.blogId) return errorResult("Workspace not found.");
      try {
        const retired = await retireDocumentTemplate(
          resolved.access.blogId,
          input.template_id,
          {
            audit: mcpAuditEntry(
              extra,
              "mcp.retire_document_template",
              "workspace",
              resolved.access.blogId,
              input.template_id,
            ),
          },
        );
        if (!retired) {
          return errorResult(
            "No look with that id is in use in this workspace.",
          );
        }
        return jsonResult({
          retired: input.template_id,
          note: "Documents already using it keep rendering unchanged.",
        });
      } catch (error) {
        return errorResult(
          error instanceof Error
            ? error.message
            : "Could not retire that look.",
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
      const stale = hashConflict(
        resolved.blog,
        resolved.post,
        input.if_match_hash,
      );
      if (stale) return stale;
      const revision = mutationRevision(resolved.post);
      if (typeof revision !== "number") return revision;
      if (!resolved.access.blogId) return errorResult("Workspace not found.");
      // Omitting the version means the look's current one. Requiring it made an
      // agent call list_document_templates purely to learn a number, and a
      // wrong guess was a failed call rather than the obvious default.
      let version = input.template_version;
      if (version === undefined) {
        const available = await listDocumentTemplates(resolved.access.blogId);
        const latest = available.find(
          (candidate) => candidate.id === input.template_id,
        );
        if (!latest) return errorResult("Template not found.");
        version = latest.version;
      }
      const reference = { id: input.template_id, version };
      const template = await getDocumentTemplate(
        resolved.access.blogId,
        reference,
      );
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
        folders: folders.map((folder) =>
          folderSummary(folder, counts[folder.path] ?? 0),
        ),
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
          {
            audit: mcpAuditEntry(
              extra,
              "mcp.create_folder",
              "folder",
              undefined,
              `${input.parent_path}/${input.name}`,
            ),
          },
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
      const folders = await getAccessibleFolders(
        resolved.blog.handle,
        accessUser(extra),
      );
      if (!folders.some((folder) => folder.id === input.folder_id)) {
        return errorResult("Folder not found.");
      }
      try {
        const folder = await renameFolder(
          resolved.blog.handle,
          input.folder_id,
          input.name,
          {
            audit: mcpAuditEntry(
              extra,
              "mcp.rename_folder",
              "folder",
              input.folder_id,
              input.name,
            ),
          },
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
      const folder = (
        await getAccessibleFolders(resolved.blog.handle, accessUser(extra))
      ).find((entry) => entry.id === input.folder_id);
      if (!folder) return errorResult("Folder not found.");
      try {
        await trashFolder(resolved.blog.handle, folder.id, {
          audit: mcpAuditEntry(
            extra,
            "mcp.delete_folder",
            "folder",
            folder.id,
            folder.path,
          ),
        });
        revalidateBlogPaths(resolved.blog);
        return jsonResult({
          ok: true,
          folder: folderSummary(folder),
          trashed: true,
        });
      } catch (error) {
        return errorResult(
          error instanceof Error
            ? error.message
            : "Folder could not be moved to Trash.",
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
        await restoreFolder(resolved.blog.handle, folder.id, {
          audit: mcpAuditEntry(
            extra,
            "mcp.restore_folder",
            "folder",
            folder.id,
            folder.path,
          ),
        });
        revalidateBlogPaths(resolved.blog);
        return jsonResult({
          ok: true,
          folder: folderSummary(folder),
          restored: true,
        });
      } catch (error) {
        return errorResult(
          error instanceof Error
            ? error.message
            : "Folder could not be restored.",
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
        getAccessibleFolderPostFiles(
          blog.handle,
          folder.path,
          accessUser(extra),
        ),
        getAccessibleAllPostFiles(blog.handle, accessUser(extra)),
      ]);
      return jsonResult({
        folder: folderSummary(folder),
        items: await Promise.all(
          posts
            .filter((post) => post.id)
            .slice(0, input.limit ?? 50)
            .map((post) => mcpItemEntry(extra, blog, post, { visiblePosts })),
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
          .filter(
            (post) => !post.folderId || !trashedFolderIds.has(post.folderId),
          )
          .map(async (post) => {
            const entry = await mcpItemEntry(extra, resolved.blog, post, {
              visiblePosts,
            });
            return {
              ...entry,
              file: undefined,
              folderId: post.folderId ?? null,
            };
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

    case "review_brief_sources": {
      const input = args as WorkspaceToolInput<"review_brief_sources">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      const document = requireDocumentSnapshot(
        resolved.post.document,
        `Persisted item ${resolved.post.id ?? resolved.post.slug}`,
      );
      if (!isLivingBrief(document)) {
        return errorResult(
          "This item is not a Living brief. Apply the Living brief template or review its sources manually.",
        );
      }
      const brief = parseLivingBrief(document);
      const currentSources: CurrentBriefSource[] = [];
      for (const source of brief.sources) {
        if (!source.itemId || !UUID_RE.test(source.itemId)) continue;
        const sourcePost = await getPostById(
          resolved.blog.handle,
          source.itemId,
        );
        if (!sourcePost) continue;
        const sourceAccess = await resolveItemAccess({
          handle: resolved.blog.handle,
          postId: source.itemId,
          user: accessUser(extra),
        });
        if (!sourceAccess.canView) continue;
        currentSources.push({
          itemId: source.itemId,
          title: sourcePost.title || sourcePost.slug,
          hash: renderItemFile(resolved.blog, sourcePost).hash,
        });
      }
      return jsonResult(reviewLivingBriefSources(brief, currentSources));
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
        `texttext-app://item/${encodeURIComponent(postId)}` +
        `?workspace=${encodeURIComponent(resolved.blog.handle)}` +
        `&mode=${mode}`;
      const userId = extra.authInfo?.extra?.userId;
      const focus =
        typeof userId === "string" && userId
          ? ({
              eventId: randomUUID(),
              targetUserId: userId,
              workspaceHandle: resolved.blog.handle,
              folderPath,
              postId,
              path,
              mode,
              requestedAt: new Date().toISOString(),
            } satisfies AgentFocusEvent)
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
      const user = accessUser(extra);
      const [posts, folders] = await Promise.all([
        getAccessibleAllPostFiles(blog.handle, user),
        getAccessibleFolders(blog.handle, user),
      ]);
      const folderPathById = new Map(
        folders.map((folder) => [folder.id, folder.path]),
      );
      const results = await Promise.all(
        posts
          .flatMap((post) => {
            if (!post.id) return [];
            const score = postSearchScore(post, input.query);
            return score === null ? [] : [{ post, score }];
          })
          .sort(
            (left, right) =>
              left.score - right.score ||
              left.post.title.localeCompare(right.post.title),
          )
          .slice(0, input.limit ?? 25)
          .map(async ({ post }) => ({
            ...(await mcpItemEntry(extra, blog, post, { visiblePosts: posts })),
            folder_path: post.folderId
              ? (folderPathById.get(post.folderId) ?? null)
              : "blog",
            snippet: searchSnippet(post, input.query),
          })),
      );
      return jsonResult({ query: input.query, results });
    }

    case "create_item": {
      const input = args as WorkspaceToolInput<"create_item">;
      const blog = await requireBlog(extra);
      if (isToolResult(blog)) return blog;
      const captured = input.capture ? captureIntent(input.capture) : null;
      let destinationPath = input.folder_path;
      if (captured && !destinationPath) {
        const folders = await getAccessibleFolders(
          blog.handle,
          accessUser(extra),
        );
        destinationPath = captureFolderPath(
          folders,
          captured.preferredFolderMode,
        ) ?? undefined;
        if (!destinationPath) {
          return errorResult(
            `Quick capture needs an accessible ${captured.preferredFolderMode} folder. ` +
              "Create or share that folder, then retry.",
          );
        }
      }
      // An item goes where its TYPE lives.
      //
      // template_id was resolved further down, after the destination had
      // already been chosen, so the thing an item actually is never influenced
      // where it landed. Only `kind` did, and `kind` is a closed list of five.
      // That is the wrong shape for a product whose item types are designed by
      // the assistant: ask for a recipe and the recipe type exists, but the
      // create still routes as if the only kinds were the five built in.
      //
      // The folder using a type is the folder that type was made for, so no
      // table mapping kinds to folders is needed to find it.
      if (!destinationPath && input.template_id) {
        const folders = await getAccessibleFolders(
          blog.handle,
          accessUser(extra),
        );
        destinationPath = folders.find(
          (folder) => folder.defaultTemplate?.id === input.template_id,
        )?.path;
      }
      if (!destinationPath && input.kind) {
        // Route by the kind that was asked for. Defaulting to "blog" here sent
        // an explicit note into the one folder that refuses notes, and the
        // kind-versus-mode check below then reported it as an impossible
        // request. A caller who names a folder is still obeyed, and a create
        // with no kind still lands on blog, which is what an article wants.
        const folders = await getAccessibleFolders(
          blog.handle,
          accessUser(extra),
        );
        const mode = folderModeForType(input.kind);
        // Only the private modes need looking up; blog is the fallback below.
        if (mode === "notes" || mode === "bookmarks") {
          destinationPath = captureFolderPath(folders, mode) ?? undefined;
          if (!destinationPath) {
            // Name the folder that is missing. Falling through to blog would
            // reach the kind-versus-mode check below and report an impossible
            // request instead of an absent folder, which sends the reader
            // looking at the kind they asked for rather than the folder they
            // do not have.
            return errorResult(
              `This workspace has no accessible ${mode} folder for a ` +
                `${itemKindForPost({ type: input.kind })}. ` +
                "Create or share that folder, or name a destination.",
            );
          }
        }
      }
      const folder = await accessibleFolder(
        blog,
        extra,
        destinationPath ?? "blog",
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

      let selectedTemplate: { id: string; version: number } | undefined;
      if (input.template_id) {
        if (!folderAccess.blogId) return errorResult("Workspace not found.");
        let version = input.template_version;
        if (version === undefined) {
          const available = await listDocumentTemplates(folderAccess.blogId);
          version = available.find(
            (candidate) => candidate.id === input.template_id,
          )?.version;
        }
        if (version === undefined) return errorResult("Template not found.");
        const definition = await getDocumentTemplate(folderAccess.blogId, {
          id: input.template_id,
          version,
        });
        if (!definition) return errorResult("Template not found.");
        selectedTemplate = { id: input.template_id, version };
      }

      let parsed: ReturnType<typeof parsePostMarkdownFile>;
      try {
        parsed = captured
          ? {
              fields: {
                links: captured.sourceUrl
                  ? [{ label: captured.title, href: captured.sourceUrl }]
                  : undefined,
                title: captured.title,
                type: captured.kind,
              },
              body: captured.body,
              unknownKeys: [],
            }
          : input.markdown
          ? parsePostMarkdownFile(input.markdown)
          : {
              fields: {
                title:
                  input.title ??
                  (input.body ? parseItemInput(input.body).title : undefined),
                excerpt: input.excerpt ?? undefined,
                type: input.kind ? input.kind : undefined,
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
            return errorResult(
              "The idempotency key belongs to a different operation.",
            );
          }
          const existing = await getPostById(blog.handle, claim.id);
          if (!existing) {
            return errorResult(
              "The original item for this idempotency key is unavailable.",
            );
          }
          const existingFolders = await getAccessibleFolders(
            blog.handle,
            accessUser(extra),
          );
          const existingFolderPath = existing.folderId
            ? existingFolders.find(
                (candidate) => candidate.id === existing.folderId,
              )?.path
            : "blog";
          if (!existingFolderPath) {
            return errorResult(
              "The original item's saved location is no longer accessible.",
            );
          }
          const item = await mcpItemEntry(extra, blog, existing);
          return jsonResult({
            item,
            ...(captured
              ? {
                  receipt: {
                    item_id: existing.id,
                    kind: item.kind,
                    saved_to: existingFolderPath,
                    title: item.title,
                  },
                }
              : {}),
            replayed: true,
          });
        }
      }
      let created: Post;
      let grounding:
        { sources: number; claims: number; writingRules: number } | undefined;
      const createAudit = mcpAuditEntry(
        extra,
        "mcp.create_item",
        "item",
        undefined,
        parsed.fields.title ?? "New item",
      );
      try {
        let document = selectedTemplate
          ? validateDocumentSnapshot({
              ...emptyDocumentSnapshot({
                id: selectedTemplate.id,
                version: selectedTemplate.version,
              }),
              content: {
                title: parsed.fields.title ?? "",
                subtitle: parsed.fields.excerpt ?? undefined,
                body: parsed.body,
                fields: input.fields ?? {},
                tags: normalizeTags(parsed.fields.tags),
                assets: [],
              },
            })
          : undefined;
        if (document && isLivingBrief(document)) {
          document = validateLivingBriefDocument(document);
          const brief = parseLivingBrief(document);
          for (const source of brief.sources) {
            if (!source.itemId) {
              if (source.status !== "unverified") {
                return errorResult(
                  `External source ${source.sourceId} must stay unverified until a person or connected research tool verifies it.`,
                );
              }
              continue;
            }
            if (!UUID_RE.test(source.itemId)) {
              return errorResult(
                `Workspace source ${source.sourceId} has an invalid item id. Read the source item and use its exact id.`,
              );
            }
            const sourcePost = await getPostById(blog.handle, source.itemId);
            const sourceAccess = sourcePost
              ? await resolveItemAccess({
                  handle: blog.handle,
                  postId: source.itemId,
                  user: accessUser(extra),
                })
              : null;
            if (!sourcePost || !sourceAccess?.canView) {
              return errorResult(
                `Workspace source ${source.sourceId} is unavailable. Read an accessible source before creating the brief.`,
              );
            }
            const currentHash = renderItemFile(blog, sourcePost).hash;
            if (source.capturedHash !== currentHash) {
              return errorResult(
                `Workspace source ${source.sourceId} changed or was not read exactly. Read it again and use content hash ${currentHash}.`,
              );
            }
            if (source.status !== "current") {
              return errorResult(
                `Workspace source ${source.sourceId} matches its captured version and must start with status current.`,
              );
            }
          }
          grounding = {
            sources: brief.sources.length,
            claims: brief.claims.length,
            writingRules: brief.writingRules.length,
          };
        }
        created = await createDraftInFolder(blog.handle, folder.id, {
          audit: createAudit,
          idempotencyKey: retryKey ?? undefined,
          template: selectedTemplate
            ? { id: selectedTemplate.id, version: selectedTemplate.version }
            : undefined,
          document,
          initial: {
            ...parsed.fields,
            type,
            slug: slugForNewFile(
              parsed.fields,
              `untitled-${Date.now().toString(36)}`,
            ),
            body: parsed.body,
          },
        });
      } catch (error) {
        if (retryKey) {
          await releaseIdempotencyKey(blog.handle, retryKey).catch(() => {});
        }
        return saveErrorResult(error);
      }
      revalidateBlogPaths(blog, [created.slug]);
      const item = await mcpItemEntry(extra, blog, created);
      return jsonResult({
        item,
        ...(captured
          ? {
              receipt: {
                item_id: created.id,
                kind: item.kind,
                saved_to: folder.path,
                title: item.title,
              },
            }
          : {}),
        grounding,
        replayed: false,
      });
    }

    case "update_item": {
      const input = args as WorkspaceToolInput<"update_item">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      const { blog, post, access } = resolved;
      if (!access.canEditContent)
        return errorResult("You cannot edit this item.");
      const stale = hashConflict(blog, post, input.if_match_hash);
      if (stale) return stale;
      const revision = mutationRevision(post);
      if (typeof revision !== "number") return revision;

      let sectionBody: string | undefined;
      if (input.section !== undefined) {
        if (
          input.body === undefined ||
          input.expected_section_body === undefined
        ) {
          return errorResult(
            "A section update requires body and expected_section_body.",
          );
        }
        const replaced = replaceMarkdownSectionBodyIfUnchanged(
          post.body,
          input.section,
          input.expected_section_body,
          input.body,
        );
        if (replaced === null) {
          return conflictResult(post, "that section could be updated");
        }
        sectionBody = replaced;
      }

      let textEditValue: string | undefined;
      if (input.text_edit !== undefined) {
        const current =
          input.text_edit.field === "title"
            ? post.title
            : input.text_edit.field === "excerpt"
              ? (post.excerpt ?? "")
              : post.body;
        const replaced = replaceTextRangeIfUnchanged(current, input.text_edit);
        if (replaced === null) {
          return conflictResult(post, "the selected text could be updated");
        }
        textEditValue = replaced;
      }

      const content = input.markdown
        ? markdownContentUpdate(post, input.markdown)
        : {
            title:
              input.text_edit?.field === "title"
                ? textEditValue!
                : (input.title ?? post.title),
            excerpt:
              input.text_edit?.field === "excerpt"
                ? textEditValue!
                : input.excerpt === null
                  ? undefined
                  : (input.excerpt ?? post.excerpt),
            body:
              input.text_edit?.field === "body"
                ? textEditValue!
                : (sectionBody ?? input.body ?? post.body),
            tags:
              input.tags !== undefined
                ? normalizeTags(input.tags)
                : normalizeTags(post.tags),
            slug: input.slug ?? post.slug,
            accent:
              input.accent === null ? undefined : (input.accent ?? post.accent),
            cover:
              input.cover === null ? undefined : (input.cover ?? post.cover),
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
        return errorResult(
          "Publication date can only be set on a published item.",
        );
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
          input.text_edit?.field === "excerpt" ||
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
        !listItemAssetReferences(post).some(
          (asset) => asset.url === content.cover,
        )
      ) {
        return errorResult(
          "Import or attach that asset before using it as the cover.",
        );
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
      if (
        contentFields.length === 0 &&
        metadataFields.length === 0 &&
        !pinChanged
      ) {
        return jsonResult({ item: await mcpItemEntry(extra, blog, post) });
      }
      const summary = [
        contentFields.length > 0
          ? `content (${contentFields.join(", ")})`
          : null,
        metadataFields.length > 0
          ? `metadata (${metadataFields.join(", ")})`
          : null,
        pinChanged ? `pin (${content.pinned ? "pinned" : "unpinned"})` : null,
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
      const ownerMetadataChangedInRequest =
        metadataFields.length > 0 || pinChanged;
      if (contentFields.length > 0 && ownerMetadataChangedInRequest) {
        return errorResult(
          "Change document content and owner metadata in separate update_item calls so each change can commit atomically.",
        );
      }
      if (contentFields.length === 0) {
        try {
          const saved = await savePost(
            blog.handle,
            {
              ...post,
              slug: content.slug,
              accent: content.accent,
              cover: content.cover,
              coverCaption: content.coverCaption,
              coverHeight: content.coverHeight,
              date: content.date,
              pinned: content.pinned,
            },
            { expectedRevision: revision, audit },
          );
          revalidateBlogPaths(blog, [post.slug, saved.slug]);
          return jsonResult({
            item: await mcpItemEntry(extra, blog, saved),
          });
        } catch (error) {
          if (error instanceof PostConflictError) {
            return conflictResult(post, "the metadata update could be saved");
          }
          return saveErrorResult(error);
        }
      }
      const hasCoEditors = Boolean(
        post.id &&
        (await hasActiveCoEditors(post.id, agentPresence(extra)?.clientId)),
      );
      // A whole-body write is an intentional overwrite only while the item is
      // closed. Against a live Y.Text it could erase characters the persisted
      // Post hash cannot see yet. Append and the guarded section mutation are
      // the two merge-safe body operations while another editor is present.
      if (
        hasCoEditors &&
        content.body !== post.body &&
        input.section === undefined &&
        input.text_edit === undefined
      ) {
        return conflictResult(
          post,
          "a whole-document overwrite could be saved while it is open",
        );
      }
      // Closed documents can use the store's revision-guarded content+audit
      // CTE directly. Open documents and targeted range/section edits must use
      // the live Yjs command path so current editor text is never overwritten.
      if (
        !hasCoEditors &&
        input.section === undefined &&
        input.text_edit === undefined
      ) {
        try {
          const saved = await savePost(
            blog.handle,
            {
              ...post,
              title: content.title,
              excerpt: content.excerpt,
              body: content.body,
              tags: content.tags,
            },
            {
              expectedRevision: revision,
              audit,
              fieldsPatch: fieldsChanged
                ? (requestedFields ?? undefined)
                : undefined,
            },
          );
          revalidateBlogPaths(blog, [post.slug, saved.slug]);
          return jsonResult({ item: await mcpItemEntry(extra, blog, saved) });
        } catch (error) {
          if (error instanceof PostConflictError) {
            return conflictResult(post, "the update could be saved");
          }
          return saveErrorResult(error);
        }
      }
      try {
        const saved = await saveLiveContentMutation({
          blog,
          post,
          access,
          mutation: {
            title:
              input.text_edit?.field !== "title" && content.title !== post.title
                ? content.title
                : undefined,
            subtitle:
              input.text_edit?.field !== "excerpt" &&
              content.excerpt !== post.excerpt
                ? (content.excerpt ?? null)
                : undefined,
            body:
              input.text_edit?.field !== "body" &&
              input.section === undefined &&
              content.body !== post.body
                ? content.body
                : undefined,
            bodySection:
              input.section !== undefined
                ? {
                    heading: input.section,
                    expectedBody: input.expected_section_body!,
                    replacementBody: input.body!,
                  }
                : undefined,
            ...(input.text_edit !== undefined
              ? {
                  textRange: {
                    field:
                      input.text_edit.field === "excerpt"
                        ? "subtitle"
                        : input.text_edit.field,
                    start: input.text_edit.start,
                    end: input.text_edit.end,
                    expectedText: input.text_edit.expected_text,
                    replacementText: input.text_edit.replacement_text,
                  },
                }
              : {}),
            tags: !sameValue(content.tags, normalizeTags(post.tags))
              ? content.tags
              : undefined,
            fields:
              fieldsChanged && requestedFields ? requestedFields : undefined,
            operationId: crypto.randomUUID(),
          },
          audit,
          extra,
        });
        revalidateBlogPaths(blog, [post.slug, saved.slug]);
        return jsonResult({ item: await mcpItemEntry(extra, blog, saved) });
      } catch (error) {
        if (error instanceof DocumentSectionConflictError) {
          return conflictResult(post, "that section could be updated");
        }
        if (error instanceof DocumentTextRangeConflictError) {
          return conflictResult(post, "the selected text could be updated");
        }
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
      if (!access.canEditContent)
        return errorResult("You cannot edit this item.");
      const retryKey = input.idempotency_key
        ? automationKey("append", input.idempotency_key)
        : null;
      if (retryKey) {
        const claim = await claimIdempotencyKey(blog.handle, retryKey);
        if (claim.status === "inflight") return idempotencyInflightResult();
        if (claim.status === "done") {
          if (claim.kind !== "post" || claim.id !== post.id) {
            return errorResult(
              "The idempotency key belongs to a different item.",
            );
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
      // Either spelling. `markdown` is the sibling-consistent one; the tool
      // shipped with `markdown_fragment` and clients exist that send it.
      const fragment = (input.markdown ?? input.markdown_fragment ?? "").trim();
      if (!fragment) {
        if (retryKey) {
          await releaseIdempotencyKey(blog.handle, retryKey).catch(() => {});
        }
        return errorResult("Pass the text to append as `markdown`.");
      }
      const audit = mcpAuditEntry(
        extra,
        "mcp.append_to_item",
        "item",
        post.id,
        post.title,
      );
      try {
        const hasCoEditors = Boolean(
          post.id &&
          (await hasActiveCoEditors(post.id, agentPresence(extra)?.clientId)),
        );
        if (!hasCoEditors && !retryKey) {
          const saved = await savePost(
            blog.handle,
            {
              ...post,
              body: [post.body.trimEnd(), fragment]
                .filter(Boolean)
                .join("\n\n"),
            },
            { expectedRevision: revision, audit },
          );
          revalidateBlogPaths(blog, [saved.slug]);
          return jsonResult({
            item: await mcpItemEntry(extra, blog, saved),
            replayed: false,
          });
        }
        const saved = await saveLiveContentMutation({
          blog,
          post,
          access,
          mutation: {
            appendBody: fragment,
            operationId: retryKey ?? undefined,
          },
          audit,
          extra,
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
      const folder = await accessibleFolder(
        resolved.blog,
        extra,
        input.folder_path,
      );
      if (isToolResult(folder)) return folder;
      const targetAccess = await resolveFolderAccess({
        handle: resolved.blog.handle,
        folderId: folder.id,
        user: accessUser(extra),
      });
      if (!targetAccess.canEditContent) {
        return errorResult("You cannot move items into this folder.");
      }
      const stale = hashConflict(
        resolved.blog,
        resolved.post,
        input.if_match_hash,
      );
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
        return errorResult(
          error instanceof Error ? error.message : "Could not move item.",
        );
      }
    }

    case "delete_item": {
      const input = args as WorkspaceToolInput<"delete_item">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.isOwner) {
        return errorResult("Only the owner can move this item to Trash.");
      }
      const stale = hashConflict(
        resolved.blog,
        resolved.post,
        input.if_match_hash,
      );
      if (stale) return stale;
      const revision = mutationRevision(resolved.post);
      if (typeof revision !== "number") return revision;
      try {
        await deletePostAtomic(
          resolved.blog.handle,
          input.id,
          revision,
          mcpAuditEntry(
            extra,
            "mcp.delete_item",
            "item",
            input.id,
            resolved.post.title,
          ),
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
        const restored = await restorePost(
          resolved.blog.handle,
          input.id,
          mcpAuditEntry(
            extra,
            "mcp.restore_item",
            "item",
            input.id,
            post.title,
          ),
        );
        revalidateBlogPaths(resolved.blog, [restored.slug]);
        return jsonResult({
          item: await mcpItemEntry(extra, resolved.blog, restored),
          restored: true,
        });
      } catch (error) {
        return errorResult(
          error instanceof Error
            ? error.message
            : "The item could not be restored.",
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
      if (
        isAlwaysDraftType(resolved.post.type) &&
        input.status === "published"
      ) {
        return errorResult("Notes and bookmarks are always unlisted.");
      }
      const stale = hashConflict(
        resolved.blog,
        resolved.post,
        input.if_match_hash,
      );
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
            status: isAlwaysDraftType(resolved.post.type)
              ? "draft"
              : input.status,
            visibility: input.status === "published" ? "public" : "private",
            date: input.status === "published" ? resolved.post.date : undefined,
          },
          {
            expectedRevision: revision,
            audit: mcpAuditEntry(
              extra,
              input.status === "published"
                ? "mcp.publish_item"
                : "mcp.unpublish_item",
              "item",
              resolved.post.id,
              resolved.post.title,
            ),
          },
        );
        revalidateBlogPaths(resolved.blog, [resolved.post.slug, saved.slug]);
        return jsonResult({
          item: await mcpItemEntry(extra, resolved.blog, saved),
        });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(
            resolved.post,
            "the status change could be saved",
          );
        }
        return saveErrorResult(error);
      }
    }

    case "list_access": {
      const input = args as WorkspaceToolInput<"list_access">;
      const target = await accessTarget(
        extra,
        input.scope_type,
        input.scope_id,
      );
      if (isToolResult(target)) return target;
      if (!target.access.canManage)
        return errorResult("You cannot manage this access list.");
      return jsonResult({
        scope: { type: target.scopeType, id: target.scopeId },
        access: await listScopeShares(target.scopeType, target.scopeId),
      });
    }

    case "set_access": {
      const input = args as WorkspaceToolInput<"set_access">;
      const target = await accessTarget(
        extra,
        input.scope_type,
        input.scope_id,
      );
      if (isToolResult(target)) return target;
      if (!target.access.canManage)
        return errorResult("You cannot manage this access list.");
      const sub = requiredSub(extra);
      if (typeof sub !== "string") return sub;
      try {
        const audit = mcpAuditEntry(
          extra,
          "mcp.set_access",
          target.scopeType,
          target.scopeId,
          `${input.email} as ${input.role}`,
        );
        const share = await inviteScopeShare({
          scopeType: target.scopeType,
          scopeId: target.scopeId,
          email: input.email,
          role: input.role as ScopeShareRole,
          invitedBySub: sub,
          actorType: mcpActorType(extra),
          actorUserId: accessUser(extra).userId,
          auditActionName: audit.actionName,
          auditInputSummary: audit.inputSummary,
        });
        return jsonResult({ share });
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : "Access could not be set.",
        );
      }
    }

    case "revoke_access": {
      const input = args as WorkspaceToolInput<"revoke_access">;
      const target = await accessTarget(
        extra,
        input.scope_type,
        input.scope_id,
      );
      if (isToolResult(target)) return target;
      if (!target.access.canManage)
        return errorResult("You cannot manage this access list.");
      const sub = requiredSub(extra);
      if (typeof sub !== "string") return sub;
      const current = await listScopeShares(target.scopeType, target.scopeId);
      if (!current.some((share) => share.id === input.access_id)) {
        return jsonResult({ changed: false, access: current });
      }
      try {
        const audit = mcpAuditEntry(
          extra,
          "mcp.revoke_access",
          target.scopeType,
          target.scopeId,
          `Access: ${input.access_id}`,
        );
        await revokeScopeShare(
          target.scopeType,
          target.scopeId,
          input.access_id,
          sub,
          {
            actorType: mcpActorType(extra),
            actorUserId: accessUser(extra).userId,
            auditActionName: audit.actionName,
            auditInputSummary: audit.inputSummary,
          },
        );
        return jsonResult({
          changed: true,
          access: await listScopeShares(target.scopeType, target.scopeId),
        });
      } catch (error) {
        return errorResult(
          error instanceof Error
            ? error.message
            : "Access could not be revoked.",
        );
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
        comments: await listItemComments(input.id, {
          resolved: resolvedFilter,
        }),
      });
    }

    case "add_comment": {
      const input = args as WorkspaceToolInput<"add_comment">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      // This was the only comment handler that checked nothing. Reaching an
      // item is not permission to write on it: canComment is false by default
      // and true from the commenter role up (permissions.ts:155), and
      // set_comment_resolved next door has always checked. Someone with read
      // access alone could leave comments on another person's item.
      if (!resolved.access.canComment) {
        return errorResult("You cannot comment on this item.");
      }
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
                  ...(input.anchor_start === undefined
                    ? {}
                    : { start: input.anchor_start }),
                  ...(input.anchor_end === undefined
                    ? {}
                    : { end: input.anchor_end }),
                }
              : null,
        },
        {
          actorUserId: resolved.access.userId,
          actorType: mcpActorType(extra),
          actorName: mcpActorDisplayName(extra),
        },
        {
          audit: mcpAuditEntry(
            extra,
            "mcp.add_comment",
            "item",
            input.id,
            input.body,
          ),
        },
      );
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
      const comment = await setItemCommentResolved(
        input.id,
        input.comment_id,
        input.resolved,
        {
          actorUserId: resolved.access.userId,
          actorType: mcpActorType(extra),
          actorName: mcpActorDisplayName(extra),
        },
        {
          audit: mcpAuditEntry(
            extra,
            input.resolved ? "mcp.resolve_comment" : "mcp.reopen_comment",
            "item",
            input.id,
            input.comment_id,
          ),
        },
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
      const stale = hashConflict(
        resolved.blog,
        resolved.post,
        input.if_match_hash,
      );
      if (stale) return stale;
      const source =
        resolved.post.links?.[0]?.href ?? resolved.post.capture?.url;
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
        {
          audit: mcpAuditEntry(
            extra,
            "mcp.recapture_bookmark",
            "item",
            input.id,
            sourceUrl.toString(),
          ),
        },
      );
      if (!pending) return errorResult("Bookmark not found.");
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
      if (!resolved.access.isOwner)
        return errorResult("Only the owner can attach item assets.");
      const stale = hashConflict(
        resolved.blog,
        resolved.post,
        input.if_match_hash,
      );
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
            date:
              resolved.post.status === "published"
                ? resolved.post.date
                : undefined,
          },
          {
            expectedRevision: revision,
            audit: mcpAuditEntry(
              extra,
              "mcp.add_item_asset",
              "item",
              input.id,
              `${input.placement}: ${asset.filename} (${asset.bytes} bytes)`,
            ),
          },
        );
        revalidateBlogPaths(resolved.blog, [saved.slug]);
        return jsonResult({
          item: await mcpItemEntry(extra, resolved.blog, saved),
        });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return conflictResult(resolved.post, "the asset could be attached");
        }
        return errorResult(
          error instanceof Error
            ? error.message
            : "Asset could not be attached.",
        );
      }
    }

    case "remove_item_asset": {
      const input = args as WorkspaceToolInput<"remove_item_asset">;
      const resolved = await requirePost(extra, input.id);
      if (isToolResult(resolved)) return resolved;
      if (!resolved.access.isOwner)
        return errorResult("Only the owner can remove item assets.");
      const stale = hashConflict(
        resolved.blog,
        resolved.post,
        input.if_match_hash,
      );
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
          audit: mcpAuditEntry(
            extra,
            "mcp.remove_item_asset",
            "item",
            input.id,
            input.asset_url,
          ),
        });
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
        // The name the assistant renders under in the presence row. It is the
        // workspace's own assistant, not a connected outside client, so it is
        // deliberately not named after whichever provider is configured.
        connectionName: ASSISTANT_CONNECTION_NAME,
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
