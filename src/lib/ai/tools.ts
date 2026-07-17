import { z } from "zod";

export type WorkspaceToolMutability = "read" | "write";
export type WorkspaceToolConfirmation = "none" | "destructive" | "audience";
export type WorkspaceToolRequiredScope = "read" | "sync";

export type WorkspaceToolAnnotations = {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export const WORKSPACE_FOLDER_MODES = ["blog", "notes", "bookmarks"] as const;
export const WORKSPACE_SCOPE_CAPABILITIES = Object.freeze({
  fullAccess: "sync",
  readOnly: ["read"] as const,
});

type WorkspaceToolDefinition<Schema extends z.ZodType = z.ZodType> = {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  jsonSchema: Record<string, unknown>;
  mutability: WorkspaceToolMutability;
  requiredScope: WorkspaceToolRequiredScope;
  confirmation: WorkspaceToolConfirmation;
  audienceChanging: boolean;
  annotations: WorkspaceToolAnnotations;
};

type DefinitionOptions<Schema extends z.ZodType> = {
  title: string;
  description: string;
  inputSchema: Schema;
  mutability?: WorkspaceToolMutability;
  confirmation?: WorkspaceToolConfirmation;
  destructive?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
  requiredScope?: WorkspaceToolRequiredScope;
};

const CONFIRMATION_COPY: Record<Exclude<WorkspaceToolConfirmation, "none">, string> = {
  destructive:
    "This changes or removes existing workspace state. Obtain explicit human confirmation immediately before calling it.",
  audience:
    "This can change what readers can see. Obtain explicit human confirmation immediately before calling it.",
};

function defineTool<Name extends string, Schema extends z.ZodType>(
  name: Name,
  options: DefinitionOptions<Schema>,
): WorkspaceToolDefinition<Schema> & { name: Name } {
  const mutability = options.mutability ?? "read";
  const requiredScope = options.requiredScope ?? (mutability === "write" ? "sync" : "read");
  const confirmation = options.confirmation ?? "none";
  const destructive = options.destructive ?? confirmation === "destructive";
  const audienceChanging = confirmation === "audience";
  const description =
    confirmation === "none"
      ? options.description
      : `${options.description} ${CONFIRMATION_COPY[confirmation]}`;

  return {
    name,
    title: options.title,
    description,
    inputSchema: options.inputSchema,
    jsonSchema: z.toJSONSchema(options.inputSchema, { target: "draft-7" }) as Record<
      string,
      unknown
    >,
    mutability,
    requiredScope,
    confirmation,
    audienceChanging,
    annotations: {
      title: options.title,
      readOnlyHint: mutability === "read",
      destructiveHint: destructive,
      idempotentHint: options.idempotent ?? mutability === "read",
      openWorldHint: options.openWorld ?? false,
    },
  };
}

const emptyInput = () => z.object({}).strict();
const id = z.string().trim().min(1).max(128).describe("The workspace item id.");
const folderId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .describe("The stable workspace folder id.");
const folderPath = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .describe('A full folder path from list_folders, such as "blog/ideas".');
const ifMatchHash = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .optional()
  .describe(
    "The hash returned by list_items, search, or the previous mutation. A stale hash rejects the write.",
  );
const itemKind = z.enum([
  "article",
  "media_post",
  "video_post",
  "note",
  "bookmark",
]);

const scopeType = z.enum(["workspace", "folder", "item"]);
const accessRole = z.enum(["member", "guest", "editor", "viewer"]);
const accessTargetInput = {
  scope_type: scopeType,
  scope_id: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .optional()
    .describe("Required for folder and item scopes. Omit for the current workspace."),
} as const;

function validateAccessTarget(
  value: { scope_type: z.infer<typeof scopeType>; scope_id?: string; role?: z.infer<typeof accessRole> },
  context: z.RefinementCtx,
) {
  if (value.scope_type !== "workspace" && !value.scope_id) {
    context.addIssue({
      code: "custom",
      path: ["scope_id"],
      message: "Folder and item access require a scope_id.",
    });
  }
  if (value.scope_type === "workspace" && value.scope_id) {
    context.addIssue({
      code: "custom",
      path: ["scope_id"],
      message: "Workspace access uses the current workspace and does not accept scope_id.",
    });
  }
  if (!value.role) return;
  const valid =
    value.scope_type === "workspace"
      ? ["member", "guest"].includes(value.role)
      : ["editor", "viewer"].includes(value.role);
  if (!valid) {
    context.addIssue({
      code: "custom",
      path: ["role"],
      message:
        value.scope_type === "workspace"
          ? "Workspace roles are member or guest."
          : "Folder and item roles are editor or viewer.",
    });
  }
}

const createItemInput = z
  .object({
    folder_path: folderPath
      .optional()
      .describe('The destination folder path. Defaults to the Blog folder at "blog".'),
    title: z.string().trim().min(1).max(300).optional(),
    body: z.string().max(1_000_000).optional(),
    excerpt: z.string().max(2_000).nullable().optional(),
    kind: itemKind.optional(),
    markdown: z
      .string()
      .min(1)
      .max(1_000_000)
      .optional()
      .describe(
        "A complete Write markdown file. Use this instead of title, body, excerpt, and kind.",
      ),
  })
  .strict()
  .superRefine((value, context) => {
    const structured =
      value.title !== undefined ||
      value.body !== undefined ||
      value.excerpt !== undefined ||
      value.kind !== undefined;
    if (!value.markdown && !value.title) {
      context.addIssue({
        code: "custom",
        message: "Pass either markdown or a title for the new item.",
      });
    }
    if (value.markdown && structured) {
      context.addIssue({
        code: "custom",
        message: "Pass markdown or structured item fields, not both.",
      });
    }
  });

const updateItemInput = z
  .object({
    id,
    title: z.string().trim().min(1).max(300).optional(),
    excerpt: z.string().max(2_000).nullable().optional(),
    body: z.string().max(1_000_000).optional(),
    markdown: z
      .string()
      .min(1)
      .max(1_000_000)
      .optional()
      .describe(
        "A complete Write markdown file. Metadata, status, kind, and pin changes in it are rejected; use their dedicated tools.",
      ),
    if_match_hash: ifMatchHash,
  })
  .strict()
  .superRefine((value, context) => {
    const structured =
      value.title !== undefined || value.excerpt !== undefined || value.body !== undefined;
    if (!value.markdown && !structured) {
      context.addIssue({ code: "custom", message: "Pass content to update." });
    }
    if (value.markdown && structured) {
      context.addIssue({
        code: "custom",
        message: "Pass markdown or structured content fields, not both.",
      });
    }
  });

const setMetadataInput = z
  .object({
    id,
    title: z.string().trim().min(1).max(300).optional(),
    slug: z.string().trim().min(1).max(120).optional(),
    excerpt: z.string().max(2_000).nullable().optional(),
    accent: z
      .union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.literal(""), z.null()])
      .optional(),
    cover: z.string().max(2_048).nullable().optional(),
    cover_caption: z.string().max(2_000).nullable().optional(),
    cover_height: z.number().int().min(180).max(860).nullable().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Publication date for an already-published item, as YYYY-MM-DD."),
    if_match_hash: ifMatchHash,
  })
  .strict()
  .superRefine((value, context) => {
    const keys = [
      "title",
      "slug",
      "excerpt",
      "accent",
      "cover",
      "cover_caption",
      "cover_height",
      "date",
    ] as const;
    if (!keys.some((key) => value[key] !== undefined)) {
      context.addIssue({ code: "custom", message: "Pass metadata to update." });
    }
  });

export const WORKSPACE_TOOL_DEFINITIONS = {
  get_workspace: defineTool("get_workspace", {
    title: "Get workspace",
    description:
      "Return the current workspace identity, public handle, display name, supported folder modes, scope capabilities, and the caller's effective access.",
    inputSchema: emptyInput(),
  }),
  list_folders: defineTool("list_folders", {
    title: "List folders",
    description:
      "List accessible folders with ids, full paths, modes, parents, and item counts. Notes and bookmarks folders are private and always unlisted.",
    inputSchema: emptyInput(),
  }),
  create_folder: defineTool("create_folder", {
    title: "Create folder",
    description:
      "Create a subfolder under an existing full folder path. It inherits the parent's mode and privacy rules.",
    inputSchema: z
      .object({
        parent_path: folderPath.describe("The existing parent folder path."),
        name: z.string().trim().min(1).max(80).describe("The new display name."),
      })
      .strict(),
    mutability: "write",
  }),
  rename_folder: defineTool("rename_folder", {
    title: "Rename folder",
    description:
      "Change a folder's display name. The stable folder id and path do not change.",
    inputSchema: z
      .object({
        folder_id: z.string().trim().min(1).max(128),
        name: z.string().trim().min(1).max(80),
      })
      .strict(),
    mutability: "write",
    destructive: true,
  }),
  delete_folder: defineTool("delete_folder", {
    title: "Move folder to Trash",
    description:
      "Soft-delete one folder subtree and its live items. The folder remains restorable and permanent deletion is not available to agents.",
    inputSchema: z.object({ folder_id: folderId }).strict(),
    mutability: "write",
    confirmation: "destructive",
    idempotent: true,
  }),
  restore_folder: defineTool("restore_folder", {
    title: "Restore folder",
    description:
      "Restore one folder subtree from Trash. Restored published items can become public again.",
    inputSchema: z.object({ folder_id: folderId }).strict(),
    mutability: "write",
    confirmation: "audience",
    idempotent: true,
  }),
  list_items: defineTool("list_items", {
    title: "List items",
    description:
      "List live items in one folder with ids, titles, kinds, status, metadata, revision, and content hash.",
    inputSchema: z
      .object({
        folder_path: folderPath.optional().describe('Defaults to "blog".'),
        limit: z.number().int().min(1).max(100).optional().describe("Defaults to 50."),
      })
      .strict(),
  }),
  list_trash: defineTool("list_trash", {
    title: "List Trash",
    description:
      "List soft-deleted folder restoration units and individual items. This never exposes permanent-delete operations.",
    inputSchema: emptyInput(),
  }),
  read_item: defineTool("read_item", {
    title: "Read item",
    description:
      "Read one live item's markdown content and metadata. Server clients can use its current hash from list_items or search before a later write.",
    inputSchema: z.object({ id }).strict(),
  }),
  search: defineTool("search", {
    title: "Search items",
    description:
      "Search accessible live item titles, excerpts, and bodies. Drafts and private folders are included only when the caller can view them.",
    inputSchema: z
      .object({
        query: z.string().trim().min(1).max(500),
        limit: z.number().int().min(1).max(50).optional().describe("Defaults to 25."),
      })
      .strict(),
  }),
  create_item: defineTool("create_item", {
    title: "Create item",
    description:
      "Create one draft in a target folder from structured fields or a complete Write markdown file. If no folder is supplied, create it in the Blog folder. New items are never published or pinned; use the dedicated confirmed tools afterward.",
    inputSchema: createItemInput,
    mutability: "write",
  }),
  update_item: defineTool("update_item", {
    title: "Update item",
    description:
      "Update title, excerpt, and/or body without changing folder, kind, publication status, pin, or other metadata. A supplied hash prevents stale overwrites.",
    inputSchema: updateItemInput,
    mutability: "write",
    destructive: true,
  }),
  append_to_item: defineTool("append_to_item", {
    title: "Append to item",
    description:
      "Append markdown to the end of an item's body, separated by a blank line, without changing metadata.",
    inputSchema: z
      .object({
        id,
        markdown_fragment: z.string().min(1).max(1_000_000),
        if_match_hash: ifMatchHash,
      })
      .strict(),
    mutability: "write",
  }),
  move_item: defineTool("move_item", {
    title: "Move item",
    description:
      "Move an item to another folder of the same mode. Public kinds cannot cross into private folders, and notes or bookmarks cannot cross into public folders.",
    inputSchema: z.object({ id, folder_path: folderPath, if_match_hash: ifMatchHash }).strict(),
    mutability: "write",
    destructive: true,
    idempotent: true,
  }),
  delete_item: defineTool("delete_item", {
    title: "Move item to Trash",
    description:
      "Soft-delete one live item by moving it to Trash. It remains restorable; this tool never permanently deletes content.",
    inputSchema: z.object({ id, if_match_hash: ifMatchHash }).strict(),
    mutability: "write",
    confirmation: "destructive",
    idempotent: true,
  }),
  restore_item: defineTool("restore_item", {
    title: "Restore item",
    description:
      "Restore one item from Trash with its previous status. Restoring a previously published item can make it public again.",
    inputSchema: z.object({ id }).strict(),
    mutability: "write",
    confirmation: "audience",
    idempotent: true,
  }),
  set_item_status: defineTool("set_item_status", {
    title: "Set item status",
    description:
      "Publish or unpublish one public item. Notes and bookmarks reject publication and remain unlisted forever.",
    inputSchema: z
      .object({
        id,
        status: z.enum(["draft", "published"]),
        if_match_hash: ifMatchHash,
      })
      .strict(),
    mutability: "write",
    confirmation: "audience",
    destructive: true,
    idempotent: true,
  }),
  set_item_metadata: defineTool("set_item_metadata", {
    title: "Set item metadata",
    description:
      "Update supported item metadata while preserving content, kind, folder, publication status, and pin state.",
    inputSchema: setMetadataInput,
    mutability: "write",
    destructive: true,
    idempotent: true,
  }),
  set_item_pinned: defineTool("set_item_pinned", {
    title: "Pin or unpin item",
    description:
      "Set whether an item is pinned at the top of its workspace and public listings.",
    inputSchema: z
      .object({ id, pinned: z.boolean(), if_match_hash: ifMatchHash })
      .strict(),
    mutability: "write",
    destructive: true,
    idempotent: true,
  }),
  list_access: defineTool("list_access", {
    title: "List access",
    description:
      "List the people and roles with direct access to the current workspace, one folder, or one item.",
    inputSchema: z
      .object(accessTargetInput)
      .strict()
      .superRefine(validateAccessTarget),
    requiredScope: "sync",
  }),
  grant_access: defineTool("grant_access", {
    title: "Grant access",
    description:
      "Invite one email address to the current workspace, one folder, or one item with an explicit role.",
    inputSchema: z
      .object({
        ...accessTargetInput,
        email: z.string().trim().email().max(320),
        role: accessRole,
      })
      .strict()
      .superRefine(validateAccessTarget),
    mutability: "write",
    confirmation: "audience",
  }),
  set_access_role: defineTool("set_access_role", {
    title: "Change access role",
    description:
      "Change one existing direct access grant on the current workspace, one folder, or one item.",
    inputSchema: z
      .object({
        ...accessTargetInput,
        access_id: z.string().trim().min(1).max(128),
        role: accessRole,
      })
      .strict()
      .superRefine(validateAccessTarget),
    mutability: "write",
    confirmation: "audience",
    destructive: true,
    idempotent: true,
  }),
  revoke_access: defineTool("revoke_access", {
    title: "Revoke access",
    description:
      "Revoke one direct access grant from the current workspace, one folder, or one item.",
    inputSchema: z
      .object({
        ...accessTargetInput,
        access_id: z.string().trim().min(1).max(128),
      })
      .strict()
      .superRefine(validateAccessTarget),
    mutability: "write",
    confirmation: "audience",
    destructive: true,
    idempotent: true,
  }),
  list_comments: defineTool("list_comments", {
    title: "List comments",
    description:
      "List collaboration comments and replies on one item, including anchored text context and resolution state.",
    inputSchema: z
      .object({ id, state: z.enum(["open", "resolved", "all"]).optional() })
      .strict(),
  }),
  add_comment: defineTool("add_comment", {
    title: "Add comment",
    description:
      "Add a collaboration comment or reply on one item. Anchors retain the quoted context even if the document later changes.",
    inputSchema: z
      .object({
        id,
        body: z.string().trim().min(1).max(20_000),
        parent_comment_id: z.string().trim().min(1).max(128).optional(),
        anchor_field: z.enum(["title", "excerpt", "body"]).optional(),
        anchor_exact: z.string().min(1).max(4_000).optional(),
        anchor_start: z.number().int().min(0).optional(),
        anchor_end: z.number().int().min(0).optional(),
      })
      .strict()
      .superRefine((value, context) => {
        const anchorValues = [
          value.anchor_field,
          value.anchor_exact,
          value.anchor_start,
          value.anchor_end,
        ];
        const hasAnchor = anchorValues.some((entry) => entry !== undefined);
        if (hasAnchor && (!value.anchor_field || !value.anchor_exact)) {
          context.addIssue({
            code: "custom",
            path: ["anchor_field"],
            message: "Anchored comments require anchor_field and anchor_exact.",
          });
        }
        if ((value.anchor_start === undefined) !== (value.anchor_end === undefined)) {
          context.addIssue({
            code: "custom",
            path: ["anchor_start"],
            message: "Pass both anchor_start and anchor_end, or neither.",
          });
        }
        if (
          value.anchor_start !== undefined &&
          value.anchor_end !== undefined &&
          value.anchor_end < value.anchor_start
        ) {
          context.addIssue({
            code: "custom",
            path: ["anchor_end"],
            message: "Anchor end must not precede start.",
          });
        }
      }),
    mutability: "write",
  }),
  set_comment_resolved: defineTool("set_comment_resolved", {
    title: "Resolve or reopen comment",
    description:
      "Set whether one collaboration comment thread is resolved.",
    inputSchema: z
      .object({
        id,
        comment_id: z.string().trim().min(1).max(128),
        resolved: z.boolean(),
      })
      .strict(),
    mutability: "write",
    destructive: true,
    idempotent: true,
  }),
  recapture_bookmark: defineTool("recapture_bookmark", {
    title: "Recapture bookmark",
    description:
      "Queue a fresh full capture of an existing bookmark using its saved original URL. The current completed capture remains visible until the replacement is complete.",
    inputSchema: z.object({ id, if_match_hash: ifMatchHash }).strict(),
    mutability: "write",
    destructive: true,
    openWorld: true,
  }),
  list_item_assets: defineTool("list_item_assets", {
    title: "List item assets",
    description:
      "List cover, body, gallery, video, capture, and screenshot assets referenced by one item.",
    inputSchema: z.object({ id }).strict(),
  }),
  add_item_asset: defineTool("add_item_asset", {
    title: "Add item asset",
    description:
      "Import one public image or video URL into Write storage and attach it as the cover, at the end of the body, or in the gallery.",
    inputSchema: z
      .object({
        id,
        source_url: z.string().url().max(2_048),
        placement: z.enum(["cover", "body_end", "gallery"]),
        alt_text: z.string().max(500).optional(),
        caption: z.string().max(2_000).optional(),
        if_match_hash: ifMatchHash,
      })
      .strict(),
    mutability: "write",
    openWorld: true,
  }),
  remove_item_asset: defineTool("remove_item_asset", {
    title: "Remove item asset",
    description:
      "Remove references to one asset URL from an item's cover, body, and gallery without physically deleting shared storage.",
    inputSchema: z
      .object({ id, asset_url: z.string().url().max(2_048), if_match_hash: ifMatchHash })
      .strict(),
    mutability: "write",
    confirmation: "destructive",
    idempotent: true,
  }),
  set_item_cover: defineTool("set_item_cover", {
    title: "Set item cover",
    description:
      "Use a referenced asset URL as the item cover, restore automatic cover selection, or explicitly show no cover.",
    inputSchema: z
      .object({
        id,
        source: z.enum(["url", "auto", "none"]),
        url: z.string().url().max(2_048).optional(),
        caption: z.string().max(2_000).nullable().optional(),
        height: z.number().int().min(180).max(860).nullable().optional(),
        if_match_hash: ifMatchHash,
      })
      .strict()
      .superRefine((value, context) => {
        if (value.source === "url" && !value.url) {
          context.addIssue({ code: "custom", path: ["url"], message: "A URL cover requires url." });
        }
        if (value.source !== "url" && value.url) {
          context.addIssue({
            code: "custom",
            path: ["url"],
            message: "Only a URL cover accepts url.",
          });
        }
      }),
    mutability: "write",
    destructive: true,
    idempotent: true,
  }),
} as const;

export type WorkspaceToolName = keyof typeof WORKSPACE_TOOL_DEFINITIONS;
export type WorkspaceToolInput<Name extends WorkspaceToolName> = z.output<
  (typeof WORKSPACE_TOOL_DEFINITIONS)[Name]["inputSchema"]
>;

export const WORKSPACE_TOOL_NAMES = Object.freeze(
  Object.keys(WORKSPACE_TOOL_DEFINITIONS) as WorkspaceToolName[],
);

export function isWorkspaceToolName(value: string): value is WorkspaceToolName {
  return Object.prototype.hasOwnProperty.call(WORKSPACE_TOOL_DEFINITIONS, value);
}

export function parseWorkspaceToolInput<Name extends WorkspaceToolName>(
  name: Name,
  input: unknown,
): WorkspaceToolInput<Name> {
  return WORKSPACE_TOOL_DEFINITIONS[name].inputSchema.parse(
    input,
  ) as WorkspaceToolInput<Name>;
}
