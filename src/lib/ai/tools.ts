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
    // MCP 2026-07-28 defaults to JSON Schema 2020-12 when a schema carries no
    // $schema, and recommends it. Emitting draft-7 shapes without saying so
    // would leave a conforming client validating against the wrong dialect.
    jsonSchema: z.toJSONSchema(options.inputSchema, {
      target: "draft-2020-12",
    }) as Record<string, unknown>,
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
const templateId = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9.-]{2,159}$/)
  .describe("A document template identifier.");
const customTemplateId = templateId.refine(
  (value) => !value.startsWith("texttext."),
  "Workspace templates cannot use the reserved texttext. prefix.",
);
const templateVersion = z.number().int().positive();

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
    idempotency_key: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe(
        "Stable caller key for retry-safe creation. Reuse the same key after timeouts to receive the original item instead of creating a duplicate.",
      ),
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
        "A complete TextText markdown file. Use this instead of title, body, excerpt, and kind.",
      ),
  })
  .strict()
  .superRefine((value, context) => {
    const structured =
      value.title !== undefined ||
      value.body !== undefined ||
      value.excerpt !== undefined ||
      value.kind !== undefined;
    if (!value.markdown && !value.title && !value.body?.trim()) {
      context.addIssue({
        code: "custom",
        message: "Pass markdown, a title, or body text for the new item.",
      });
    }
    if (value.markdown && structured) {
      context.addIssue({
        code: "custom",
        message: "Pass markdown or structured item fields, not both.",
      });
    }
  });

/** Custom field values, keyed by the field ids the item's template declares.
 * The same value shapes DocumentSnapshot stores: scalars, string lists, or
 * row-record lists for rows fields. Server-side validation re-checks against
 * documentFieldValueSchema; a null clears a value. */
const fieldValues = z
  .record(
    z.string().regex(/^[a-z][A-Za-z0-9_.-]{0,119}$/),
    z.union([
      z.string().max(2_000_000),
      z.number().finite(),
      z.boolean(),
      z.null(),
      z.array(z.string().max(20_000)).max(500),
      z
        .array(
          z.record(
            z.string().regex(/^[a-z][A-Za-z0-9_.-]{0,119}$/),
            z.union([z.string().max(20_000), z.number().finite(), z.boolean(), z.null()]),
          ),
        )
        .max(500),
    ]),
  )
  .describe(
    "Custom field values keyed by the template's declared field ids. Merged into the item's existing fields; null clears one.",
  );

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
    fields: fieldValues.optional(),
    markdown: z
      .string()
      .min(1)
      .max(1_000_000)
      .optional()
      .describe(
        "A complete TextText markdown file. Content and owner metadata may change, but status, kind, and folder cannot.",
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
      value.pinned !== undefined ||
      value.fields !== undefined;
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
  open_item: defineTool("open_item", {
    title: "Open item",
    description:
      "Open one exact item in TextText for the user and join its live collaboration session.",
    inputSchema: z
      .object({
        id,
        mode: z.enum(["read", "edit"]).optional().describe("Defaults to read."),
      })
      .strict(),
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
  list_responses: defineTool("list_responses", {
    title: "List responses",
    description:
      "List reader responses to one item's poll nodes: per-option tallies plus individual responses. Responder identity is a name only when the reader was signed in.",
    inputSchema: z.object({ id }).strict(),
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
  list_document_templates: defineTool("list_document_templates", {
    title: "List document templates",
    description:
      "List the immutable built-in and workspace templates available for shaping documents.",
    inputSchema: emptyInput(),
  }),
  save_item_as_look: defineTool("save_item_as_look", {
    title: "Save this item's look",
    description:
      "Take the way one item currently renders and save it as a reusable look, under a name. The look then appears in the look pickers and can be applied to other items or given to a folder with set_folder_template. This replaced an operations-based authoring API: shape a document the ordinary way, with update_item and the item's own theme, then save what you made. It never changes the item.",
    inputSchema: z
      .object({
        id,
        name: z.string().trim().min(1).max(160).describe("What to call the look."),
      })
      .strict(),
    mutability: "write",
  }),
  set_folder_template: defineTool("set_folder_template", {
    title: "Set folder look",
    description:
      "Give a folder a look, and by default restyle everything already in it. The template becomes what the folder's index page renders from, what new items are created with, and what the items already there use. This is how a request like 'make this folder a magazine' actually lands. Pass apply_to_existing false only if the person asked for the change to affect new items alone: leaving old items behind means the index changes and not one article does, which reads as nothing having happened.",
    inputSchema: z
      .object({
        folder_path: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .describe('Folder path inside the workspace, e.g. "blog" or "blog/ideas".'),
        template_id: templateId,
        template_version: templateVersion,
        apply_to_existing: z
          .boolean()
          .optional()
          .describe(
            "Restyle the items already in the folder. Defaults to true, which is what someone asking to change how a folder looks almost always means. Content is never touched.",
          ),
      })
      .strict(),
    mutability: "write",
    idempotent: true,
  }),
  retire_document_template: defineTool("retire_document_template", {
    title: "Retire a look",
    description:
      "Stop offering one workspace look. It disappears from the look pickers and from list_document_templates, and every document and folder already using it keeps rendering exactly as it does now, because template versions are immutable and nothing is deleted. Built-in looks cannot be retired. Use this when someone says a look they made is no longer wanted, rather than leaving a picker full of abandoned experiments.",
    inputSchema: z
      .object({
        template_id: templateId,
      })
      .strict(),
    mutability: "write",
    confirmation: "destructive",
    idempotent: true,
  }),
  set_item_template: defineTool("set_item_template", {
    title: "Set item template",
    description:
      "Apply one document template to an item without changing its content or audience. Omit template_version to use the look's current version, which is almost always what you want.",
    inputSchema: z
      .object({
        id,
        template_id: templateId,
        // Optional since 2026-08-15. Requiring it meant an agent had to call
        // list_document_templates purely to learn a number, and getting it
        // wrong was a failed call rather than a sensible default.
        template_version: templateVersion.optional(),
        if_match_hash: ifMatchHash,
      })
      .strict(),
    mutability: "write",
    idempotent: true,
  }),
  create_item: defineTool("create_item", {
    title: "Create item",
    description:
      "Create one draft item in a folder from fields or a full markdown file. Never published, never pinned. Automated clients should pass a stable idempotency_key so retries cannot create duplicates.",
    inputSchema: createItemInput,
    mutability: "write",
  }),
  update_item: defineTool("update_item", {
    title: "Update item",
    description:
      "Update one item's content or metadata: title, body, excerpt, tags, slug, cover, pin, publication date, and custom template fields via the fields map. Full markdown may update the same fields. Cannot publish, unpublish, or move an item.",
    inputSchema: updateItemInput,
    mutability: "write",
    destructive: true,
  }),
  append_to_item: defineTool("append_to_item", {
    title: "Append to item",
    description:
      "Append a markdown block to the end of one item's body without touching its metadata. Pass the text as `markdown`. Automated clients should pass an idempotency_key derived from the source event or commit.",
    inputSchema: z
      .object({
        id,
        // `markdown` matches create_item and update_item. This tool shipped
        // with `markdown_fragment`, which cost every agent one failed call to
        // discover, so both are accepted and the old name stays valid for the
        // clients already written against it.
        markdown: z.string().min(1).max(1_000_000).optional(),
        markdown_fragment: z.string().min(1).max(1_000_000).optional(),
        if_match_hash: ifMatchHash,
        idempotency_key: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .optional()
          .describe(
            "Stable event key for exactly-once append behavior. Reuse it when retrying the same update.",
          ),
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
      "Import one public image or video URL into TextText and attach it as cover, body, or gallery.",
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
