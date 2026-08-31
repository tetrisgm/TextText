import { z } from "zod";
import { itemTypeBlueprintSchema } from "@/lib/presentation/item-type-blueprint";

type WorkspaceToolMutability = "read" | "write";
type WorkspaceToolConfirmation = "none" | "destructive" | "audience";
type WorkspaceToolRequiredScope = "read" | "sync";

type WorkspaceToolAnnotations = {
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

const CONFIRMATION_COPY: Record<
  Exclude<WorkspaceToolConfirmation, "none">,
  string
> = {
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
  const requiredScope =
    options.requiredScope ?? (mutability === "write" ? "sync" : "read");
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
    .describe(
      "Required for folder and item scopes. Omit for the current workspace.",
    ),
} as const;

function validateAccessTarget(
  value: {
    scope_type: z.infer<typeof scopeType>;
    scope_id?: string;
    role?: z.infer<typeof accessRole>;
  },
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
      message:
        "Workspace access uses the current workspace and does not accept scope_id.",
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
      .describe(
        "The destination folder path. Omit it and the item goes to the folder its kind belongs in: a note to Notes, a bookmark to Bookmarks, anything else to Blog. Quick capture routes the same way.",
      ),
    capture: z
      .string()
      .trim()
      .min(1)
      .max(1_000_000)
      .optional()
      .describe(
        "The raw thought, passage, transcript, or URL to save quickly. Pass this by itself and TextText derives the title, routes text to Notes or a URL to Bookmarks, and returns a save receipt.",
      ),
    title: z.string().trim().min(1).max(300).optional(),
    body: z.string().max(1_000_000).optional(),
    excerpt: z.string().max(2_000).nullable().optional(),
    kind: itemKind.optional(),
    template_id: templateId
      .optional()
      .describe(
        "Create the item with this document template. Omit to inherit the folder look.",
      ),
    template_version: templateVersion.optional(),
    fields: z
      .lazy(() => fieldValues)
      .optional()
      .describe(
        "Structured values for the selected template, including rows such as sources and claims.",
      ),
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
      value.kind !== undefined ||
      value.template_id !== undefined ||
      value.template_version !== undefined ||
      value.fields !== undefined;
    if (
      !value.capture &&
      !value.markdown &&
      !value.title &&
      !value.body?.trim()
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Pass capture text, markdown, a title, or body text for the new item.",
      });
    }
    if (value.capture && (value.markdown || structured)) {
      context.addIssue({
        code: "custom",
        path: ["capture"],
        message:
          "Pass capture by itself. Use structured fields or markdown when you need to control the item shape.",
      });
    }
    if (value.markdown && structured) {
      context.addIssue({
        code: "custom",
        message: "Pass markdown or structured item fields, not both.",
      });
    }
    if (
      value.template_version !== undefined &&
      value.template_id === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["template_version"],
        message: "template_version requires template_id.",
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
            z.union([
              z.string().max(20_000),
              z.number().finite(),
              z.boolean(),
              z.null(),
            ]),
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
    section: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Replace only this Markdown heading's body. Pass body and expected_section_body with it.",
      ),
    expected_section_body: z
      .string()
      .max(1_000_000)
      .optional()
      .describe(
        "The section body returned by read_item. A different live value rejects the surgical edit.",
      ),
    text_edit: z
      .object({
        field: z.enum(["title", "excerpt", "body"]),
        start: z.number().int().min(0).max(1_000_000),
        end: z.number().int().min(0).max(1_000_000),
        expected_text: z.string().max(1_000_000),
        replacement_text: z.string().max(1_000_000),
      })
      .strict()
      .optional()
      .describe(
        "Replace one exact text range. The current text at start..end must equal expected_text, so unrelated live edits merge and a changed selection is rejected.",
      ),
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
      .describe(
        "Publication date for an already-published item, as YYYY-MM-DD.",
      ),
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
    const replacesWholeItem =
      value.markdown !== undefined ||
      (value.body !== undefined && value.section === undefined);
    if (replacesWholeItem && !value.if_match_hash) {
      context.addIssue({
        code: "custom",
        path: ["if_match_hash"],
        message:
          "Whole-item replacement requires if_match_hash from read_item. Targeted text_edit and section edits use their own live-content guards.",
      });
    }
    if (value.text_edit !== undefined) {
      if (value.text_edit.end < value.text_edit.start) {
        context.addIssue({
          code: "custom",
          path: ["text_edit", "end"],
          message: "text_edit end must be at or after start.",
        });
      }
      if (
        value.text_edit.end - value.text_edit.start !==
        value.text_edit.expected_text.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["text_edit", "expected_text"],
          message: "text_edit range length must match expected_text.",
        });
      }
      const incompatible = [
        value.title,
        value.excerpt,
        value.body,
        value.section,
        value.expected_section_body,
        value.tags,
        value.slug,
        value.accent,
        value.cover,
        value.cover_caption,
        value.cover_height,
        value.date,
        value.pinned,
        value.fields,
        value.markdown,
      ].some((entry) => entry !== undefined);
      if (incompatible) {
        context.addIssue({
          code: "custom",
          message: "A text_edit cannot change other content or metadata.",
        });
      }
    }
    if (value.section !== undefined) {
      if (
        value.body === undefined ||
        value.expected_section_body === undefined
      ) {
        context.addIssue({
          code: "custom",
          message: "A section update requires body and expected_section_body.",
        });
      }
      const incompatible = [
        value.title,
        value.excerpt,
        value.tags,
        value.slug,
        value.accent,
        value.cover,
        value.cover_caption,
        value.cover_height,
        value.date,
        value.pinned,
        value.fields,
        value.markdown,
      ].some((entry) => entry !== undefined);
      if (incompatible) {
        context.addIssue({
          code: "custom",
          message: "A section update cannot change other content or metadata.",
        });
      }
    } else if (value.expected_section_body !== undefined) {
      context.addIssue({
        code: "custom",
        message: "expected_section_body requires section.",
      });
    }
    const structured =
      value.text_edit !== undefined ||
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
      context.addIssue({
        code: "custom",
        message: "Pass content or metadata to update.",
      });
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
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Defaults to 50."),
      })
      .strict(),
  }),
  read_item: defineTool("read_item", {
    title: "Read item",
    description:
      "Read one item's markdown, metadata, tags, outbound links, backlinks, and assets by id.",
    inputSchema: z.object({ id }).strict(),
  }),
  review_brief_sources: defineTool("review_brief_sources", {
    title: "Review brief sources",
    description:
      "Compare a Living brief's captured workspace-source versions with the current documents. Return changed or missing sources and the exact claim ids that need review. Read-only.",
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
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Defaults to 25."),
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
    title: "List item types",
    description:
      "List the kinds of item this workspace has: the built-in ones and any designed here. Each entry says what it is for, what fields it holds, and how a folder of them is laid out.\n\n" +
      // The description said only "templates available for shaping documents",
      // so a model asked to change an existing type listed them five times
      // and never worked out that changing one was possible.
      "Types under `editable` were designed from a blueprint and can be CHANGED with update_item_type: send that blueprint back with your edit, and the version shown. `needsMigration` and `unreadable` were designed here too but cannot be reopened by this build. Anything in none of those lists was assembled rather than designed - built-ins, imports, duplicates, and looks saved from a document - and has no blueprint to edit.\n\n" +
      "Call this first whenever someone wants a kind of item to be different.",
    inputSchema: emptyInput(),
  }),
  create_item_type: defineTool("create_item_type", {
    title: "Create item type",
    description:
      "Create one reusable item type from a complete blueprint. The blueprint defines the fields, the item page, the folder layout, example content, and safe theme tokens together. Use this when someone asks for a new kind of thing, such as a Medium-like blog, a Notion-like task board, or Apple Notes-like notes. If folder_path is supplied, the new type becomes that folder's look and existing items are restyled by default.\n\n" +
      // Worked example rather than more rules. A type designed with no fields
      // at all was the most common failure, and a request for a year grid of
      // runs produced exactly that: the model reached for a layout and forgot
      // that a layout needs data underneath it.
      "Every type needs fields a person will actually fill in. This is the shape to aim for, from the built-in Tasks type:\n" +
      '{"name":"Tasks","description":"A focused list of things to finish.","fields":[{"id":"area","label":"Area","type":"enum","options":[{"value":"work"},{"value":"personal"}]},{"id":"items","label":"Items","type":"rows","fields":[{"id":"task","type":"text"},{"id":"done","type":"boolean"},{"id":"when","type":"date"},{"id":"priority","type":"enum"}]}],"collection":{"layout":"list"}}\n' +
      "Three to seven fields. A board needs a single-select enum to group by, and a calendar or heatmap needs a date field to place items on: declare that field, or choose a layout the fields you have can support. Never return a type with no fields.",
    inputSchema: z
      .object({
        blueprint: itemTypeBlueprintSchema,
        folder_path: folderPath.optional(),
        apply_to_existing: z
          .boolean()
          .default(true)
          .describe(
            "When folder_path is supplied, restyle the items already in that folder. Content is never changed.",
          ),
      })
      .strict(),
    mutability: "write",
  }),
  update_item_type: defineTool("update_item_type", {
    title: "Change an item type",
    description:
      "Change an item type that already exists, by editing the blueprint it was built from. Use this when someone wants their existing kind of thing to be different: another field, a different folder view, a bigger title, a new accent. list_document_templates returns the blueprint and the version for every type that can be changed this way.\n\n" +
      "Send the WHOLE blueprint, not only the part you changed: it replaces the old one. Send base_version exactly as list_document_templates reported it, so an edit made against a stale copy is refused instead of quietly overwriting someone else's.\n\n" +
      "The old version is kept and the items already using it keep rendering as they were. By default the new version is applied to every folder using this type and the items in them are restyled, which is what someone asking for their look to change means.\n\n" +
      "Built-in types cannot be changed. Neither can a look that was saved from a document, imported, or duplicated: those were assembled rather than designed, so they have no blueprint to edit and list_document_templates will not list them as changeable.",
    inputSchema: z
      .object({
        template_id: z
          .string()
          .trim()
          .min(1)
          .max(160)
          .describe(
            "The id of the type to change, as list_document_templates reported it.",
          ),
        base_version: z
          .number()
          .int()
          .positive()
          .describe(
            "The version you read before editing. If the type has moved on since, the change is refused rather than applied on top.",
          ),
        blueprint: itemTypeBlueprintSchema,
        apply: z
          .boolean()
          .default(true)
          .describe(
            "Apply the new version to the folders already using this type. False creates the version and changes nothing anyone can see.",
          ),
        apply_to_existing: z
          .boolean()
          .default(true)
          .describe(
            "Restyle the items already in those folders. Content is never changed.",
          ),
      })
      .strict(),
    mutability: "write",
  }),
  save_item_as_look: defineTool("save_item_as_look", {
    title: "Save this item's look",
    description:
      "Take the way one item currently renders and save it as a reusable look, under a name. The look then appears in the look pickers and can be applied to other items or given to a folder with set_folder_template. This replaced an operations-based authoring API: shape a document the ordinary way, with update_item and the item's own theme, then save what you made. It never changes the item.",
    inputSchema: z
      .object({
        id,
        name: z
          .string()
          .trim()
          .min(1)
          .max(160)
          .describe("What to call the look."),
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
          .describe(
            'Folder path inside the workspace, e.g. "blog" or "blog/ideas".',
          ),
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
      "Save something to TextText. For quick capture, pass capture alone: text becomes a private Note and a URL becomes a Bookmark, with a receipt in the result. For precise creation, pass fields or a full markdown file and choose a folder. New items are never published or pinned. Automated clients should pass a stable idempotency_key so retries cannot create duplicates.",
    inputSchema: createItemInput,
    mutability: "write",
  }),
  update_item: defineTool("update_item", {
    title: "Update item",
    description:
      "Update one item's content or metadata: title, body, excerpt, tags, slug, cover, pin, publication date, and custom template fields via the fields map. A full body or markdown replacement requires if_match_hash from read_item. Targeted text_edit and section edits use their own expected-content guards. Cannot publish, unpublish, or move an item.\n\n" +
      // Highlighting was asked for and had no syntax, so the model bolded
      // things instead, which means something else on the page.
      "To highlight a passage, wrap it in double equals signs: ==like this==. It renders as a real highlight. Bold and italic still mean bold and italic. Use a highlight when someone asks for the important parts to stand out, and mark the few that matter rather than most of the paragraph.",
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
    inputSchema: z
      .object({ id, folder_path: folderPath, if_match_hash: ifMatchHash })
      .strict(),
    mutability: "write",
    destructive: true,
    idempotent: true,
  }),
  organize_items: defineTool("organize_items", {
    title: "Organise several items",
    description:
      "Tag or move several items in one go. Say what to do once and name the items it applies to.\n\n" +
      "Use this instead of repeating update_item when the same change goes to more than one thing: 'tag all of these review', 'move these into Ideas'. A turn has a limited number of steps, so doing twenty items one at a time runs out before it finishes and leaves the job half done.\n\n" +
      "This changes how items are filed and labelled. It never touches what they say, so it needs no content hash. For a change that differs per item - a different sentence in each - read and update them one at a time.\n\n" +
      "Each item is handled on its own and the answer says what happened to each.",
    inputSchema: z
      .object({
        ids: z.array(id).min(1).max(50).describe("The items to change."),
        add_tags: z
          .array(z.string().trim().min(1).max(60))
          .max(20)
          .optional()
          .describe("Tags to add. Ones already there are left as they are."),
        remove_tags: z
          .array(z.string().trim().min(1).max(60))
          .max(20)
          .optional()
          .describe("Tags to take off. Ones not there are ignored."),
        folder_path: folderPath
          .optional()
          .describe(
            "Move them all into this folder. It must accept their kind.",
          ),
      })
      .strict()
      .refine(
        (value) =>
          Boolean(value.add_tags?.length) ||
          Boolean(value.remove_tags?.length) ||
          Boolean(value.folder_path),
        {
          message:
            "Say what to change: tags to add or remove, or a folder to move into.",
        },
      ),
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
  delete_items: defineTool("delete_items", {
    title: "Move items to Trash",
    description:
      "Move several items to Trash in one go. They stay restorable; this never permanently deletes.\n\n" +
      'Use this when someone asks to get rid of more than one thing. Name every item explicitly by id: there is no "everything matching" form, because a request to delete has to say what it is deleting.\n\n' +
      "Each item is handled on its own. One that has changed since you read it, or that has already gone, is reported and the rest still go. The answer says what happened to each.",
    inputSchema: z
      .object({
        ids: z
          .array(id)
          .min(1)
          .max(50)
          .describe("The items to move to Trash, named one by one."),
        expected_revisions: z
          .record(z.string(), z.number().int().nonnegative())
          .optional()
          .describe(
            "Only delete an item if it is still exactly as it was, keyed by id. The approval flow fills this in from what the owner was shown; you do not need to.",
          ),
      })
      .strict(),
    mutability: "write",
    confirmation: "destructive",
    idempotent: true,
  }),
  empty_trash: defineTool("empty_trash", {
    title: "Empty Trash",
    description:
      "Permanently delete every item and folder currently in Trash. This cannot be undone and always requires owner approval.",
    inputSchema: z.object({}).strict(),
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
      .object({
        id,
        asset_url: z.string().url().max(2_048),
        if_match_hash: ifMatchHash,
      })
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
        if (
          (value.anchor_start === undefined) !==
          (value.anchor_end === undefined)
        ) {
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
        name: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .describe("The new display name."),
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

/**
 * The canonical parser permits hashless targeted metadata edits, but a model
 * cannot express that conditional requirement faithfully in JSON Schema. Make
 * the concurrency guard structurally required on append. Whole-body replacement
 * is omitted from the model's update schema: models use exact text/section edits
 * or append instead. Non-model clients keep the canonical compatibility surface.
 */
export function workspaceToolModelSchema(
  name: WorkspaceToolName,
): Record<string, unknown> {
  const schema = WORKSPACE_TOOL_DEFINITIONS[name].jsonSchema;
  if (name === "update_item") {
    const properties =
      schema.properties &&
      typeof schema.properties === "object" &&
      !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, unknown>)
        : {};
    const safeProperties = { ...properties };
    delete safeProperties.body;
    delete safeProperties.markdown;
    return { ...schema, properties: safeProperties };
  }
  if (name !== "append_to_item") return schema;
  const required = Array.isArray(schema.required) ? schema.required : [];
  return {
    ...schema,
    required: [...new Set([...required, "if_match_hash"])],
  };
}

export function workspaceToolModelDescription(name: WorkspaceToolName): string {
  const description = WORKSPACE_TOOL_DEFINITIONS[name].description;
  if (name !== "update_item") return description;
  return (
    "Update one item's metadata or make a targeted content edit. For content, " +
    "use text_edit or section_edits with their expected-content guards. Full " +
    "body and markdown replacement are not available to models. Use " +
    "append_to_item after read_item when adding content to the end. Cannot " +
    "publish, unpublish, or move an item.\n\n" +
    "To highlight a passage, wrap it in double equals signs: ==like this==."
  );
}

export type WorkspaceToolInput<Name extends WorkspaceToolName> = z.output<
  (typeof WORKSPACE_TOOL_DEFINITIONS)[Name]["inputSchema"]
>;

export const WORKSPACE_TOOL_NAMES = Object.freeze(
  Object.keys(WORKSPACE_TOOL_DEFINITIONS) as WorkspaceToolName[],
);

export function isWorkspaceToolName(value: string): value is WorkspaceToolName {
  return Object.prototype.hasOwnProperty.call(
    WORKSPACE_TOOL_DEFINITIONS,
    value,
  );
}

export function parseWorkspaceToolInput<Name extends WorkspaceToolName>(
  name: Name,
  input: unknown,
): WorkspaceToolInput<Name> {
  return WORKSPACE_TOOL_DEFINITIONS[name].inputSchema.parse(
    input,
  ) as WorkspaceToolInput<Name>;
}
