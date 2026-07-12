// The MCP tool surface: an authenticated agent's view of one workspace (the
// token owner's blog). Every tool speaks the markdown-file vocabulary of the
// sync API v1: read_item returns the same file bytes as sync GET, mutations
// take whole files, and listings return manifest-style entries whose hash is
// the update conflict currency.
//
// Deliberately absent in v1: a delete tool. Agents ask the owner to delete;
// the sync API DELETE and the app remain the only ways to remove an item.

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Blog, Post } from "@/lib/content";
import { recordAction } from "@/lib/audit";
import { parsePostMarkdownFile, slugForNewFile } from "@/lib/markdown-files";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import {
  createDraft,
  createSubfolder,
  deletePost,
  getAccessibleAllPostFiles,
  getAccessibleFolderPostFiles,
  getAccessibleFolders,
  getPostById,
  PostConflictError,
  savePost,
  savePostContentPatch,
} from "@/lib/store";
import {
  type AccessUser,
  type EffectiveAccess,
  resolveFolderAccess,
  resolveItemAccess,
  resolveWorkspaceAccess,
} from "@/lib/permissions";
import {
  DEFAULT_TYPE_BY_MODE,
  folderModeForType,
  isAlwaysDraftType,
  itemEntry,
  itemKindForPost,
  kindsForFolderMode,
  normalizeItemHash,
  postInFolder,
  postMatchesQuery,
  renderItemFile,
  searchSnippet,
} from "./items";
import { workspaceBlog } from "./auth";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SEARCH_RESULT_LIMIT = 25;

// The savePost failures an agent can fix by editing its file (message strings
// owned by src/lib/store.ts); anything else stays a generic internal error so
// raw driver messages never leak into a tool result.
const CLIENT_SAVE_ERRORS = new Set(["That URL is already used"]);

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
  const detail =
    error instanceof Error && error.message ? ` ${error.message}` : "";
  return errorResult(`Could not parse the markdown file.${detail}`);
}

function saveErrorResult(error: unknown): CallToolResult {
  if (error instanceof Error && CLIENT_SAVE_ERRORS.has(error.message)) {
    return errorResult(error.message);
  }
  console.error("MCP savePost failed:", error);
  return errorResult("The item could not be saved. Try again.");
}

type ToolContext = { authInfo?: AuthInfo };

function accessUser(extra: ToolContext): AccessUser {
  const sub = extra.authInfo?.extra?.sub;
  const userId = extra.authInfo?.extra?.userId;
  return {
    sub: typeof sub === "string" ? sub : null,
    userId: typeof userId === "string" ? userId : null,
  };
}

// One audit row per MCP mutation; the actor is the token's user.
async function auditMcp(
  extra: ToolContext,
  actionName: string,
  targetId: string | undefined,
  summary?: string,
) {
  const userId = extra.authInfo?.extra?.userId;
  await recordAction({
    actorUserId: typeof userId === "string" ? userId : null,
    actorType: "external_agent",
    actionName,
    targetType: "item",
    targetId,
    inputSummary: summary,
  });
}

// Auth glue shared by every tool: the token is already verified by
// withMcpAuth, so the only failure left is a user with no blog.
async function requireBlog(extra: ToolContext): Promise<Blog | CallToolResult> {
  const blog = await workspaceBlog(extra.authInfo);
  if (!blog) {
    return errorResult(
      "No blog exists for this token's user. Open the editor once to create one.",
    );
  }
  return blog;
}

function isToolResult<T extends object>(
  value: T | CallToolResult,
): value is CallToolResult {
  return "content" in value;
}

async function requirePost(
  extra: ToolContext,
  id: string,
): Promise<{ blog: Blog; post: Post; access: EffectiveAccess } | CallToolResult> {
  const blog = await requireBlog(extra);
  if (isToolResult(blog)) return blog;
  // A foreign id can never resolve inside this workspace, so "not found"
  // covers both "not yours" and "does not exist".
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

async function postsInFolder(
  handle: string,
  folder: Parameters<typeof postInFolder>[0],
  user: AccessUser,
): Promise<Post[]> {
  // The database does the folder scoping (NULL folder_id counts as blog).
  const posts = await getAccessibleFolderPostFiles(handle, folder.path, user);
  return posts.filter((post) => post.id);
}

export function registerWriteTools(server: McpServer): void {
  server.registerTool(
    "list_folders",
    {
      title: "List folders",
      description:
        "The workspace's folders (id, name, path, mode) plus the blog they " +
        "belong to. Folder modes: blog holds public writing, notes and " +
        "bookmarks hold private items that are never published. Call this " +
        "first to learn the folder_path values other tools accept.",
    },
    async (extra) => {
      const blog = await requireBlog(extra);
      if (isToolResult(blog)) return blog;
      const folders = await getAccessibleFolders(blog.handle, accessUser(extra));
      return jsonResult({
        blog: {
          handle: blog.handle,
          username: blog.username ?? null,
          name: blog.name,
        },
        folders: folders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          path: folder.path,
          mode: folder.mode,
          parentId: folder.parentId ?? null,
        })),
      });
    },
  );

  server.registerTool(
    "create_folder",
    {
      title: "Create folder",
      description:
        "Create a subfolder under an existing folder (categories). " +
        "parent_path is a full folder path from list_folders, e.g. \"blog\" " +
        "or \"blog/ideas\". The subfolder inherits the parent's mode, so " +
        "anything under notes or bookmarks stays private. Nesting caps at " +
        "four levels.",
      inputSchema: {
        parent_path: z
          .string()
          .describe("Full path of the parent folder, e.g. \"blog\""),
        name: z.string().describe("Display name for the new folder"),
      },
    },
    async ({ parent_path, name }, extra) => {
      const blog = await requireBlog(extra);
      if (isToolResult(blog)) return blog;
      const access = await resolveWorkspaceAccess({
        handle: blog.handle,
        user: accessUser(extra),
      });
      if (!access.isOwner) return errorResult("Only the owner can create folders.");
      try {
        const folder = await createSubfolder(blog.handle, parent_path, name);
        await auditMcp(extra, "mcp.create_folder", folder.id, folder.path);
        revalidateBlogPaths(blog);
        return jsonResult({ folder });
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : "Could not create folder",
        );
      }
    },
  );

  server.registerTool(
    "list_items",
    {
      title: "List items",
      description:
        "Manifest-style entries (id, slug, title, kind, status, updatedAt, " +
        "hash) for one folder, drafts included. The hash identifies the " +
        "item's current file content; pass it as if_match_hash when updating " +
        "to detect conflicts.",
      inputSchema: {
        folder_path: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Folder path from list_folders, e.g. "blog", "notes", or ' +
              '"bookmarks". Defaults to "blog".',
          ),
      },
    },
    async ({ folder_path }, extra) => {
      const blog = await requireBlog(extra);
      if (isToolResult(blog)) return blog;
      const path = folder_path ?? "blog";
      const folders = await getAccessibleFolders(blog.handle, accessUser(extra));
      const folder = folders.find((entry) => entry.path === path);
      if (!folder) {
        return errorResult(
          `No folder with path "${path}" exists. Call list_folders for the ` +
            "available paths.",
        );
      }
      const posts = await postsInFolder(blog.handle, folder, accessUser(extra));
      return jsonResult({
        folder: {
          id: folder.id,
          name: folder.name,
          path: folder.path,
          mode: folder.mode,
        },
        items: posts.map((post) => itemEntry(blog, post)),
      });
    },
  );

  server.registerTool(
    "read_item",
    {
      title: "Read item",
      description:
        "The item's markdown file: single-line key: value frontmatter, then " +
        "the body. This is the exact representation update_item expects " +
        "back. The item's current hash comes from list_items or search.",
      inputSchema: {
        id: z.string().min(1).describe("The item id from list_items or search."),
      },
    },
    async ({ id }, extra) => {
      const resolved = await requirePost(extra, id);
      if (isToolResult(resolved)) return resolved;
      return textResult(renderItemFile(resolved.blog, resolved.post).text);
    },
  );

  server.registerTool(
    "create_item",
    {
      title: "Create item",
      description:
        "Create an item in a folder from a whole markdown file (frontmatter " +
        "optional). In the blog folder the kind may be article, media_post, " +
        "or video_post (default article) and new work should stay status: " +
        "draft; ask the owner before publishing. Items created in notes or " +
        "bookmarks folders are private and always kept as drafts. There is " +
        "no delete tool: ask the owner to delete items in the app.",
      inputSchema: {
        folder_path: z
          .string()
          .min(1)
          .describe('Target folder path from list_folders, e.g. "blog" or "notes".'),
        markdown: z
          .string()
          .min(1)
          .describe("The whole markdown file, frontmatter plus body."),
      },
    },
    async ({ folder_path, markdown }, extra) => {
      const blog = await requireBlog(extra);
      if (isToolResult(blog)) return blog;
      const folders = await getAccessibleFolders(blog.handle, accessUser(extra));
      const folder = folders.find((entry) => entry.path === folder_path);
      if (!folder) {
        return errorResult(
          `No folder with path "${folder_path}" exists. Call list_folders ` +
            "for the available paths.",
        );
      }
      const folderAccess = await resolveFolderAccess({
        handle: blog.handle,
        folderId: folder.id,
        user: accessUser(extra),
      });
      if (!folderAccess.isOwner) {
        return errorResult("You cannot create items in this folder.");
      }

      let parsed: ReturnType<typeof parsePostMarkdownFile>;
      try {
        parsed = parsePostMarkdownFile(markdown);
      } catch (error) {
        return parseErrorResult(error);
      }

      const type = parsed.fields.type ?? DEFAULT_TYPE_BY_MODE[folder.mode];
      // The file's kind must belong to the target folder: otherwise a file
      // claiming "kind: article, status: published" aimed at the notes folder
      // would mint a PUBLIC post while the caller believes it created a
      // private note (and the item would not even land in the folder asked
      // for, because the store files a post by its type).
      if (folderModeForType(type) !== folder.mode) {
        return errorResult(
          `Kind "${itemKindForPost({ type })}" does not belong in the ` +
            `"${folder.path}" folder, which holds ${kindsForFolderMode(folder.mode)} ` +
            "items. Pick a matching folder_path or drop the kind from the file.",
        );
      }
      // notes and bookmarks are always unlisted, no matter what the file says.
      const status = isAlwaysDraftType(type)
        ? ("draft" as const)
        : (parsed.fields.status ?? ("draft" as const));

      // createDraft files the post in the system folder matching its type,
      // which the check above pinned to the requested folder_path. TODO: when
      // the store learns multiple folders per mode, pass folder.id through.
      const created = await createDraft(blog.handle, type);
      try {
        // date comes from the file alone: created.date is the placeholder's
        // derived createdAt, and letting it through would backdate a publish.
        const saved = await savePost(blog.handle, {
          ...created,
          ...parsed.fields,
          type,
          status,
          date: parsed.fields.date,
          slug: slugForNewFile(parsed.fields, created.slug),
          body: parsed.body,
        });
        await auditMcp(extra, "mcp.create_item", saved.id, saved.title);
        revalidateBlogPaths(blog, [saved.slug]);
        return jsonResult({ item: itemEntry(blog, saved) });
      } catch (error) {
        // Never strand the placeholder draft behind a failed save.
        if (created.id) await deletePost(blog.handle, created.id).catch(() => {});
        return saveErrorResult(error);
      }
    },
  );

  server.registerTool(
    "update_item",
    {
      title: "Update item",
      description:
        "Replace an item with a whole markdown file. Fields absent from the " +
        "frontmatter keep their stored values; the body is always taken from " +
        "the file. The kind can only change within the item's folder; a note " +
        "or bookmark never becomes a public kind. Pass if_match_hash (from " +
        "list_items or a previous mutation) so a concurrent edit fails " +
        "loudly instead of being overwritten. Ask the owner before changing " +
        "status to published.",
      inputSchema: {
        id: z.string().min(1).describe("The item id from list_items or search."),
        markdown: z
          .string()
          .min(1)
          .describe("The whole markdown file, frontmatter plus body."),
        if_match_hash: z
          .string()
          .min(1)
          .optional()
          .describe(
            "The item's hash as of the last read. If the item changed since, " +
              "the update is rejected with a conflict.",
          ),
      },
    },
    async ({ id, markdown, if_match_hash }, extra) => {
      const resolved = await requirePost(extra, id);
      if (isToolResult(resolved)) return resolved;
      const { blog, post, access } = resolved;
      if (!access.canEditContent) return errorResult("You cannot edit this item.");

      if (if_match_hash) {
        const current = renderItemFile(blog, post);
        if (normalizeItemHash(if_match_hash) !== current.hash) {
          return errorResult(
            `Conflict: "${post.title || post.slug}" changed since it was ` +
              `read (its hash is now ${current.hash}). Fetch the latest ` +
              "with read_item, merge your changes, then retry with the new hash.",
          );
        }
      }

      let parsed: ReturnType<typeof parsePostMarkdownFile>;
      try {
        parsed = parsePostMarkdownFile(markdown);
      } catch (error) {
        return parseErrorResult(error);
      }

      const type = parsed.fields.type ?? post.type;
      // A kind may only change within the item's folder: the store never
      // moves a post between folders on save, and relabeling a note or
      // bookmark as a public kind would let one update publish something the
      // owner filed as private.
      if (folderModeForType(type) !== folderModeForType(post.type)) {
        return errorResult(
          `This item is a ${itemKindForPost(post)} and its kind can only ` +
            `change to ${kindsForFolderMode(folderModeForType(post.type))}. ` +
            "Notes and bookmarks stay private; to make content public, " +
            "create a new draft in the blog folder instead.",
        );
      }
      // notes and bookmarks are always unlisted, no matter what the file says.
      const status = isAlwaysDraftType(type)
        ? ("draft" as const)
        : (parsed.fields.status ?? post.status);

      try {
        // Same rule as sync PUT: owners may author metadata, while
        // collaborators use the content-only store helper so the mapped date
        // string cannot overwrite published_at.
        const saved = access.isOwner
          ? await savePost(blog.handle, {
              ...post,
              ...parsed.fields,
              type,
              status,
              date: parsed.fields.date,
              slug: parsed.fields.slug ?? post.slug,
              body: parsed.body,
            },
            // Compare-and-swap on the version we just hashed: if another writer
            // committed between the read and here, conflict instead of clobber.
            { expectedRevision: post.revision })
          : await savePostContentPatch(
              blog.handle,
              post,
              {
                title: parsed.fields.title ?? post.title,
                cover: parsed.fields.cover ?? post.cover,
                coverCaption: parsed.fields.coverCaption ?? post.coverCaption,
                coverHeight: parsed.fields.coverHeight ?? post.coverHeight,
                body: parsed.body,
              },
              { expectedRevision: post.revision },
            );
        await auditMcp(extra, "mcp.update_item", saved.id, saved.title);
        revalidateBlogPaths(blog, [post.slug, saved.slug]);
        return jsonResult({ item: itemEntry(blog, saved) });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return errorResult(
            `Conflict: "${post.title || post.slug}" changed since it was read. ` +
              "Fetch the latest with read_item, merge, then retry.",
          );
        }
        return saveErrorResult(error);
      }
    },
  );

  server.registerTool(
    "append_to_item",
    {
      title: "Append to item",
      description:
        "Append a markdown fragment to the end of an item's body, separated " +
        "by a blank line. Frontmatter and all other fields are untouched. " +
        "Good for running logs and growing drafts.",
      inputSchema: {
        id: z.string().min(1).describe("The item id from list_items or search."),
        markdown_fragment: z
          .string()
          .min(1)
          .describe("Body markdown to append. No frontmatter."),
      },
    },
    async ({ id, markdown_fragment }, extra) => {
      const resolved = await requirePost(extra, id);
      if (isToolResult(resolved)) return resolved;
      const { blog, post, access } = resolved;
      if (!access.canEditContent) return errorResult("You cannot edit this item.");

      const fragment = markdown_fragment.trim();
      const base = post.body.replace(/\s+$/, "");
      const body = base ? `${base}\n\n${fragment}` : fragment;

      try {
        // date stays undefined: post.date is derived (publishedAt), and
        // passing it back would turn it into an authored publish date. The
        // revision guard makes this read-modify-write atomic so a concurrent
        // edit is not clobbered by the appended copy.
        const saved = await savePost(
          blog.handle,
          {
            ...post,
            date: undefined,
            body,
          },
          { expectedRevision: post.revision },
        );
        await auditMcp(extra, "mcp.append_to_item", saved.id, saved.title);
        revalidateBlogPaths(blog, [saved.slug]);
        return jsonResult({ item: itemEntry(blog, saved) });
      } catch (error) {
        if (error instanceof PostConflictError) {
          return errorResult(
            `Conflict: "${post.title || post.slug}" changed since it was read. ` +
              "Fetch the latest with read_item, then retry the append.",
          );
        }
        return saveErrorResult(error);
      }
    },
  );

  server.registerTool(
    "search",
    {
      title: "Search items",
      description:
        "Case-insensitive substring search over the title, excerpt, and body " +
        "of every item in the workspace, drafts and private folders " +
        "included. Returns id, slug, title, kind, and a snippet around the " +
        "first match.",
      inputSchema: {
        query: z.string().min(1).describe("Text to look for."),
      },
    },
    async ({ query }, extra) => {
      const blog = await requireBlog(extra);
      if (isToolResult(blog)) return blog;
      const posts = await getAccessibleAllPostFiles(
        blog.handle,
        accessUser(extra),
      );
      const results = posts
        .filter((post) => post.id && postMatchesQuery(post, query))
        .slice(0, SEARCH_RESULT_LIMIT)
        .map((post) => ({
          id: post.id,
          slug: post.slug,
          title: post.title,
          kind: itemKindForPost(post),
          snippet: searchSnippet(post, query),
        }));
      return jsonResult({ query, results });
    },
  );
}
