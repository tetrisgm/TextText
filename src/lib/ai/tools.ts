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
const tags = z
  .array(z.string().trim().min(1).max(48))
  .max(24)
  .describe("The complete tag list; replaces existing tags.");

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
    tags: tags.optional(),
    slug: z.string().trim().min(1).max(120).optional(),
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
    pinned: z.boolean().optional(),
    markdown: z
      .string()
      .min(1)
      .max(1_000_000)
      .optional()
      .describe(
        "A complete Write markdown file. Content and owner metadata may change, but status, kind, and folder cannot.",
      ),
    if_match_hash: ifMatchHash,
  })
  .strict()
  .superRefine((value, context) => {
    const structured =
      value.title !== undefined ||
      value.excerpt !== undefined ||
      value.body !== undefined ||
      value.tags !== undefined ||
      value.slug !== undefined ||
      value.accent !== undefined ||
      value.cover !== undefined ||
      value.cover_caption !== undefined ||
      value.cover_height !== undefined ||
      value.date !== undefined ||
      value.pinned !== undefined;
    if (!value.markdown && !structured) {
      context.addIssue({ code: "custom", message: "Pass content or metadata to update." });
    }
    if (value.markdown && structured) {
      context.addIssue({
        code: "custom",
        message: "Pass markdown or structured item fields, not both.",
      });
    }
  });

export const WORKSPACE_TOOL_DEFINITIONS = {
  get_workspace: defineTool("get_workspace", {
    title: "Get workspace",
    description:
      "Return this workspace's handle, name, your effective access, and server capabilities.",
    inputSchema: emptyInput(),
  }),
  list_folders: defineTool("list_folders", {
    title: "List folders",
    description:
      "List every folder you can see with its id, path, mode, and item count.",
    inputSchema: emptyInput(),
  }),
  list_items: defineTool("list_items", {
    title: "List items",
    description:
      "List the live items in one folder with their ids, titles, tags, status, and content hash.",
    inputSchema: z
      .object({
        folder_path: folderPath.optional().describe('Defaults to "blog".'),
        limit: z.number().int().min(1).max(100).optional().describe("Defaults to 50."),
      })
      .strict(),
  }),
  read_item: defineTool("read_item", {
    title: "Read item",
    description:
      "Read one item's markdown, metadata, tags, outbound links, backlinks, and assets by id.",
    inputSchema: z.object({ id }).strict(),
  }),
  search: defineTool("search", {
    title: "Search items",
    description:
      "Search item titles, excerpts, and bodies you can access, and return matches with snippets.",
    inputSchema: z
      .object({
        query: z.string().trim().min(1).max(500),
        limit: z.number().int().min(1).max(50).optional().describe("Defaults to 25."),
      })
      .strict(),
  }),
  list_trash: defineTool("list_trash", {
    title: "List Trash",
    description:
      "List soft-deleted items and folder restore-units. Nothing here is permanently deleted.",
    inputSchema: emptyInput(),
  }),
  list_comments: defineTool("list_comments", {
    title: "List comments",
    description:
      "List comment threads on one item, with anchored quotes and resolution state.",
    inputSchema: z
      .object({ id, state: z.enum(["open", "resolved", "all"]).optional() })
      .strict(),
  }),
  list_access: defineTool("list_access", {
    title: "List access",
    description:
      "List who can access the workspace, one folder, or one item, and their role.",
    inputSchema: z
      .object(accessTargetInput)
      .strict()
      .superRefine(validateAccessTarget),
    requiredScope: "sync",
  }),
  create_item: defineTool("create_item", {
    title: "Create item",
    description:
      "Create one draft item in a folder from fields or a full markdown file. Never published, never pinned.",
    inputSchema: createItemInput,
    mutability: "write",
  }),
  update_item: defineTool("update_item", {
    title: "Update item",
    description:
      "Update one item's content or metadata: title, body, excerpt, tags, slug, cover, pin, and publication date. Full markdown may update the same fields. Cannot publish, unpublish, or move an item.",
    inputSchema: updateItemInput,
    mutability: "write",
    destructive: true,
  }),
  append_to_item: defineTool("append_to_item", {
    title: "Append to item",
    description:
      "Append a markdown block to the end of one item's body without touching its metadata.",
    inputSchema: z
      .object({
        id,
        markdown_fragment: z.string().min(1).max(1_000_000),
        if_match_hash: ifMatchHash,
      })
      .strict(),
    mutability: "write",
  }),
  set_item_status: defineTool("set_item_status", {
    title: "Set item status",
    description:
      "Publish or unpublish one blog item. Notes and bookmarks can never be published.",
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
  move_item: defineTool("move_item", {
    title: "Move item",
    description: "Move one item to another folder of the same mode.",
    inputSchema: z.object({ id, folder_path: folderPath, if_match_hash: ifMatchHash }).strict(),
    mutability: "write",
    destructive: true,
    idempotent: true,
  }),
  delete_item: defineTool("delete_item", {
    title: "Move item to Trash",
    description:
      "Move one item to Trash. It stays restorable; this never permanently deletes.",
    inputSchema: z.object({ id, if_match_hash: ifMatchHash }).strict(),
    mutability: "write",
    confirmation: "destructive",
    idempotent: true,
  }),
  restore_item: defineTool("restore_item", {
    title: "Restore item",
    description: "Restore one item from Trash with its previous status.",
    inputSchema: z.object({ id }).strict(),
    mutability: "write",
    confirmation: "audience",
    idempotent: true,
  }),
  add_item_asset: defineTool("add_item_asset", {
    title: "Add item asset",
    description:
      "Import one public image or video URL into Write and attach it as cover, body, or gallery.",
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
      "Remove references to one asset URL from an item's cover, body, and gallery.",
    inputSchema: z
      .object({ id, asset_url: z.string().url().max(2_048), if_match_hash: ifMatchHash })
      .strict(),
    mutability: "write",
    confirmation: "destructive",
    idempotent: true,
  }),
  recapture_bookmark: defineTool("recapture_bookmark", {
    title: "Recapture bookmark",
    description:
      "Re-fetch one bookmark from its saved URL. The current capture stays visible until the new one lands.",
    inputSchema: z.object({ id, if_match_hash: ifMatchHash }).strict(),
    mutability: "write",
    destructive: true,
    openWorld: true,
  }),
  add_comment: defineTool("add_comment", {
    title: "Add comment",
    description:
      "Add a comment or reply on one item, optionally anchored to an exact quote.",
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
    description: "Resolve or reopen one comment thread.",
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
  create_folder: defineTool("create_folder", {
    title: "Create folder",
    description:
      "Create a subfolder under an existing folder path; it inherits the parent's mode and privacy.",
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
    description: "Rename one folder. Its id and path do not change.",
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
      "Move one folder subtree to Trash. Restorable; never permanently deleted.",
    inputSchema: z.object({ folder_id: folderId }).strict(),
    mutability: "write",
    confirmation: "destructive",
    idempotent: true,
  }),
  restore_folder: defineTool("restore_folder", {
    title: "Restore folder",
    description: "Restore one folder subtree from Trash.",
    inputSchema: z.object({ folder_id: folderId }).strict(),
    mutability: "write",
    confirmation: "audience",
    idempotent: true,
  }),
  set_access: defineTool("set_access", {
    title: "Set access",
    description:
      "Grant or change one person's role on the workspace, a folder, or an item, by email.",
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
    idempotent: true,
  }),
  revoke_access: defineTool("revoke_access", {
    title: "Revoke access",
    description:
      "Revoke one person's access to the workspace, a folder, or an item.",
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
