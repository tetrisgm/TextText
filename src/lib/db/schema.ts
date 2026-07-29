// Drizzle schema for the hosted platform (Neon Postgres). All content access
// goes through src/lib/store.ts, which serves the demo seed when DATABASE_URL
// is unset and reads/writes these tables when it is set.

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  pgEnum,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { BookmarkCapture, GalleryItem, LinkRef } from "../content";
import type { DocumentSnapshot, DocumentVisibility } from "../documents/model";
import type { TemplateDefinition } from "../presentation/schema";

export const writeChangeSequence = pgSequence("write_change_seq");

export const postStatus = pgEnum("post_status", ["draft", "published"]);
export const fileRepresentation = pgEnum("file_representation", [
  "textbundle",
  "markdown",
  "text",
  "textpack",
]);
// article/project/talk live in the Blog folder; note and bookmark are the
// item kinds of the Notes and Bookmarks folders (always unlisted).
export const postType = pgEnum("post_type", [
  "article",
  "project",
  "talk",
  "note",
  "bookmark",
]);
export const itemCommentAnchorField = pgEnum("item_comment_anchor_field", [
  "title",
  "excerpt",
  "body",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Apple `sub` claim; the primary identity (Sign in with Apple) */
  appleSub: text("apple_sub").unique(),
  /** public route segment, served as /@{username} */
  username: text("username"),
  email: text("email"),
  name: text("name"),
  /** pricing tier: "free" | "paid" (guests have no user row at all) */
  plan: text("plan").notNull().default("free"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("users_username_idx").on(t.username)]);

// Collaboration seed: a person granted a role on a workspace, folder, or a
// single item. Realtime editing arrives later; the permission shape lands
// now so no new surface hardcodes owner-only access.
export const collaborators = pgTable(
  "collaborators",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** "workspace" | "folder" | "item" */
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id").notNull(),
    /**
     * Invites are created by email before the person has ever signed in, so
     * userId can start null and later be bound by an explicit accept/auth
     * action. Permission reads must still honor the email match.
     */
    userId: uuid("user_id").references(() => users.id),
    /** normalized (lowercased, trimmed) invite address */
    invitedEmail: text("invited_email"),
    /** workspace: "admin" | "member" | "guest"; folder/item: "editor" | "viewer" */
    role: text("role").notNull().default("viewer"),
    invitedById: uuid("invited_by_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [
    uniqueIndex("collaborators_scope_user_idx")
      .on(t.scopeType, t.scopeId, t.userId)
      .where(sql`${t.revokedAt} is null and ${t.userId} is not null`),
    uniqueIndex("collaborators_scope_email_idx")
      .on(t.scopeType, t.scopeId, t.invitedEmail)
      .where(sql`${t.revokedAt} is null and ${t.invitedEmail} is not null`),
    index("collaborators_user_id_active_idx")
      .on(t.userId)
      .where(sql`${t.revokedAt} is null and ${t.userId} is not null`),
    index("collaborators_invited_email_active_idx")
      .on(t.invitedEmail)
      .where(
        sql`${t.revokedAt} is null and ${t.invitedEmail} is not null and ${t.userId} is null`,
      ),
  ],
);

export const blogs = pgTable(
  "blogs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** subdomain, e.g. "acme" -> acme.{ROOT_DOMAIN} */
    handle: text("handle").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline"),
    /** hex accent, e.g. "#065ec6" */
    accent: text("accent"),
    /** one-line standing bio for the reader end card */
    bioLine: text("bio_line"),
    cardStyle: text("card_style").notNull().default("cover"),
    homeLayout: text("home_layout").notNull().default("grid"),
    ownerId: uuid("owner_id").references(() => users.id),
    /** SHA-256 hash of the anonymous editor token; null after claim */
    editTokenHash: text("edit_token_hash"),
    /**
     * Durable workspace change high-water-mark: the largest `revision` ever
     * assigned to any of this blog's posts or folders, bumped by an AFTER trigger
     * on every insert/update. It is the sync change cursor. Unlike `max(revision)`
     * over surviving rows, it never falls when a trashed row is hard-deleted, so a
     * soft-delete the client has not yet seen can never be erased from the cursor
     * (which would otherwise leave a permanent client ghost). See
     * scripts/migrate-add-revision.mjs.
     */
    changeSeq: bigint("change_seq", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    uniqueIndex("blogs_handle_idx").on(t.handle),
    // One blog per owner (today): the editor provisions and resolves exactly
    // one, and this lets ensureOwnerBlog rely on the DB to settle the race on a
    // first sign-in rather than a read-then-write.
    uniqueIndex("blogs_owner_idx").on(t.ownerId),
  ],
);

// Workspace-scoped cloud AI credentials. The raw key never enters this table:
// workspace-ai-config.server.ts encrypts it with a server secret before storage
// and is the only module that decrypts it for a provider request.
export const workspaceAiConfigs = pgTable(
  "workspace_ai_config",
  {
    blogId: uuid("blog_id")
      .primaryKey()
      .references(() => blogs.id, { onDelete: "cascade" }),
    /** "anthropic" | "openai" */
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    check(
      "workspace_ai_config_provider_valid",
      sql`${t.provider} in ('anthropic', 'openai')`,
    ),
  ],
);

// Every mutation through the action layer records who did what to what,
// so AI/agent edits stay auditable and reversible-by-inspection. actorType
// distinguishes a human in the UI from the AI sidecar from an external agent.
export const actionAudit = pgTable("action_audit", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  /** "human" | "ai" | "external_agent" */
  actorType: text("actor_type").notNull().default("human"),
  actionName: text("action_name").notNull(),
  /** "workspace" | "folder" | "item" | "mode" */
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  inputSummary: text("input_summary"),
  outputSummary: text("output_summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Content-blind health reports emitted by the installed app. The report JSON
// schema accepts stable check IDs and numeric metrics only, so document text,
// filenames, paths, and credentials cannot enter this diagnostics channel.
export const appHealthReports = pgTable(
  "app_health_reports",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    installationId: uuid("installation_id").notNull(),
    appIdentifier: text("app_identifier").notNull(),
    appVersion: text("app_version").notNull(),
    buildNumber: text("build_number").notNull(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull(),
    report: jsonb("report").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("app_health_reports_user_received_idx").on(t.userId, t.receivedAt),
    index("app_health_reports_installation_received_idx").on(
      t.installationId,
      t.receivedAt,
    ),
    index("app_health_reports_release_received_idx").on(
      t.appVersion,
      t.buildNumber,
      t.receivedAt,
    ),
    index("app_health_reports_app_received_idx").on(
      t.appIdentifier,
      t.receivedAt,
    ),
    index("app_health_reports_received_idx").on(t.receivedAt),
  ],
);

// Device-link handshake: an app shows a short code and opens the browser;
// the signed-in owner approves; the app's poll then mints its api_token.
// The row is the handshake state only: the raw token is never stored (it is
// minted at claim time), and rows are single-use and short-lived.
export const deviceLinks = pgTable(
  "device_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** short human-checkable code shown by the app and in the approve page */
    code: text("code").notNull(),
    /** SHA-256 of the app-held poll secret; the actual credential */
    pollTokenHash: text("poll_token_hash").notNull(),
    /** the requesting app's self-reported name, shown at approval */
    appName: text("app_name").notNull(),
    status: text("status").notNull().default("pending"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    claimedAt: timestamp("claimed_at"),
  },
  (t) => [
    uniqueIndex("device_links_code_idx")
      .on(t.code)
      .where(sql`${t.claimedAt} is null`),
    uniqueIndex("device_links_poll_idx").on(t.pollTokenHash),
  ],
);

// Scoped bearer tokens for the machine surface (sync API today, MCP next).
// Only the SHA-256 hash is stored; the raw token is shown once at creation.
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    /** space-separated scopes; "sync" grants read/write on owned content */
    scopes: text("scopes").notNull().default("sync"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    /** null for manually-created tokens; OAuth access tokens expire */
    expiresAt: timestamp("expires_at"),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [uniqueIndex("api_tokens_hash_idx").on(t.tokenHash)],
);

// A workspace (blogs row) holds folders; folders hold items (posts rows). The
// folder's mode decides how its items are rendered and edited: "blog" today,
// "notes" and "bookmarks" as they land. Every blog has at least the default
// "blog" folder (ensured lazily and by backfill).
export const folders = pgTable(
  "folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    blogId: uuid("blog_id")
      .notNull()
      .references(() => blogs.id),
    name: text("name").notNull(),
    /**
     * Full URL-safe relative path inside the workspace, e.g. "blog",
     * "blog/ideas". Subfolders carry their whole ancestry here so the sync
     * tree, manifests, and the unique index all keep working unchanged;
     * parentId is the structural link (renames rewrite descendant paths).
     */
    path: text("path").notNull(),
    /** null for the three system roots; a folders.id for subfolders */
    parentId: uuid("parent_id"),
    mode: text("mode").notNull().default("blog"),
    /**
     * Presentation applied to new documents in this folder. Folder mode remains
     * a compatibility projection for older clients; this immutable template
     * reference is the canonical default.
     */
    defaultTemplateId: text("default_template_id")
      .notNull()
      .default("texttext.article"),
    defaultTemplateVersion: integer("default_template_version")
      .notNull()
      .default(1),
    position: integer("position").notNull().default(0),
    /**
     * Monotonic per-mutation version from the shared `write_change_seq`
     * sequence: the compare-and-swap token for optimistic locking and the source
     * of the workspace change cursor (max revision). Globally unique and strictly
     * increasing, so same-millisecond writes get distinct revisions and a value
     * is never reused (a cursor string can never alias a different state). The
     * column default assigns it on insert; a BEFORE UPDATE trigger bumps it on
     * every update, so no mutation path can forget to advance it. DDL and trigger
     * live in scripts/migrate-add-revision.mjs.
     */
    revision: bigint("revision", { mode: "number" })
      .notNull()
      .default(sql`nextval('write_change_seq')`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    uniqueIndex("folders_blog_path_idx")
      .on(t.blogId, t.path)
      .where(sql`${t.deletedAt} is null`),
  ],
);

// Auth.js email magic-link verification tokens (the only auth state the
// database holds; sessions stay JWT). `token` is stored pre-hashed: @auth/core
// SHA-256-hashes `${token}${secret}` before it ever reaches the adapter, both
// when creating and when consuming, so a leaked row cannot forge a link.
// Rows are single-use (consumed via delete ... returning) and short-lived.
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    /** the normalized (lowercased, trimmed) email address */
    identifier: text("identifier").notNull(),
    /** SHA-256 hash of the raw link token + auth secret */
    token: text("token").notNull(),
    expires: timestamp("expires").notNull(),
  },
  (t) => [
    primaryKey({
      name: "verification_tokens_identifier_token_pk",
      columns: [t.identifier, t.token],
    }),
  ],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    blogId: uuid("blog_id")
      .notNull()
      .references(() => blogs.id),
    /** owning folder; null only until the backfill/lazy-ensure touches it */
    folderId: uuid("folder_id").references(() => folders.id),
    /**
     * Local file representation selected when the post is created. Defaults to a
     * `.textpack` (a single zipped textbundle) - one inode, so name and content
     * cannot drift (phantom-free) while still bundling assets and importing into
     * Bear/Ulysses. See DEFAULT_FILE_REPRESENTATION in content.ts. Immutable per
     * post, so files we did not create keep their own format.
     */
    representation: fileRepresentation("file_representation")
      .notNull()
      .default("textpack"),
    /**
     * Canonical portable document state. Legacy content columns below are
     * maintained as search, listing, and old-client projections while clients
     * migrate to this snapshot.
     */
    document: jsonb("document").$type<DocumentSnapshot>().notNull(),
    /** Explicit, fail-closed reader visibility. */
    visibility: text("visibility")
      .$type<DocumentVisibility>()
      .notNull()
      .default("private"),
    templateId: text("template_id").notNull().default("texttext.article"),
    templateVersion: integer("template_version").notNull().default(1),
    type: postType("type").notNull().default("article"),
    slug: text("slug").notNull(),
    /** previous public slugs, newest first; maintained atomically by a trigger */
    slugHistory: text("slug_history")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    title: text("title").notNull(),
    /** short dek/standfirst */
    excerpt: text("excerpt"),
    /** legacy unused eyebrow label */
    kicker: text("kicker"),
    /** hex accent override; falls back to the blog accent */
    accent: text("accent"),
    cover: text("cover"),
    coverCaption: text("cover_caption"),
    coverHeight: integer("cover_height"),
    gallery: jsonb("gallery").$type<GalleryItem[]>(),
    links: jsonb("links").$type<LinkRef[]>(),
    videoUrl: text("video_url"),
    venue: text("venue"),
    duration: text("duration"),
    /** markdown */
    body: text("body").notNull().default(""),
    /** cached count of body tokens for list reading-time metadata */
    wordCount: integer("word_count"),
    /**
     * Bookmark capture pipeline: null (not a capturable item or nothing
     * requested) | "pending" (waiting for a capture agent, normally the Mac
     * app) | "captured" | "failed". The web sets pending at bookmark
     * creation; the agent claims it via the sync captures API.
     */
    captureStatus: text("capture_status"),
    /** artifacts of a completed capture; see BookmarkCapture in this file */
    capture: jsonb("capture").$type<BookmarkCapture>(),
    status: postStatus("status").notNull().default("draft"),
    pinned: boolean("pinned").notNull().default(false),
    /** Personal workspace favorite. Deliberately independent from public pinning. */
    starred: boolean("starred").notNull().default(false),
    publishedAt: timestamp("published_at"),
    /**
     * Monotonic per-mutation version from the shared `write_change_seq`
     * sequence; the optimistic-lock (compare-and-swap) token and the source of
     * the workspace change cursor. See the folders.revision note and
     * scripts/migrate-add-revision.mjs.
     */
    revision: bigint("revision", { mode: "number" })
      .notNull()
      .default(sql`nextval('write_change_seq')`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    // Partial: a soft-deleted (trashed) post releases its slug, so writing a
    // new post with the same URL never collides with, or resurrects, a
    // trashed row.
    uniqueIndex("posts_blog_slug_idx")
      .on(t.blogId, t.slug)
      .where(sql`${t.deletedAt} is null`),
    index("posts_folder_id_idx")
      .on(t.folderId)
      .where(sql`${t.deletedAt} is null`),
    index("posts_slug_history_gin_full_idx").using("gin", t.slugHistory),
    index("posts_tags_gin_full_idx").using("gin", t.tags),
    index("posts_blog_visibility_order_idx")
      .on(t.blogId, t.visibility, t.status, t.pinned.desc(), t.publishedAt.desc(), t.createdAt.desc())
      .where(sql`${t.deletedAt} is null`),
    index("posts_blog_workspace_order_idx")
      .on(t.blogId, t.pinned.desc(), t.updatedAt.desc(), t.createdAt.desc())
      .where(sql`${t.deletedAt} is null`),
    index("posts_blog_starred_order_idx")
      .on(t.blogId, t.starred.desc(), t.updatedAt.desc(), t.createdAt.desc())
      .where(sql`${t.deletedAt} is null`),
    check(
      "posts_visibility_valid",
      sql`${t.visibility} in ('private', 'link', 'public')`,
    ),
    check(
      "posts_document_schema_v1_valid",
      sql`coalesce((
        jsonb_typeof(${t.document}) = 'object'
        and ${t.document} ->> 'schemaVersion' = '1'
        and jsonb_typeof(${t.document} -> 'content') = 'object'
        and jsonb_typeof(${t.document} -> 'content' -> 'title') = 'string'
        and jsonb_typeof(${t.document} -> 'content' -> 'body') = 'string'
        and jsonb_typeof(${t.document} -> 'content' -> 'fields') = 'object'
        and jsonb_typeof(${t.document} -> 'content' -> 'tags') = 'array'
        and jsonb_typeof(${t.document} -> 'content' -> 'assets') = 'array'
        and jsonb_typeof(${t.document} -> 'presentation') = 'object'
        and jsonb_typeof(${t.document} -> 'presentation' -> 'template') = 'object'
        and jsonb_typeof(${t.document} -> 'presentation' -> 'theme') = 'object'
        and ${t.document} -> 'presentation' -> 'template' ->> 'id' = ${t.templateId}
        and case
          when ${t.document} -> 'presentation' -> 'template' ->> 'version'
            ~ '^[1-9][0-9]*$'
          then (${t.document} -> 'presentation' -> 'template' ->> 'version')::integer
            = ${t.templateVersion}
          else false
        end
      ), false)`,
    ),
  ],
);

// Immutable workspace template versions. Built-ins ship in code; only
// forked/AI-authored definitions need rows. A published document pins an exact
// version so a later edit never changes old pages by accident.
export const documentTemplates = pgTable(
  "document_templates",
  {
    blogId: uuid("blog_id")
      .notNull()
      .references(() => blogs.id, { onDelete: "cascade" }),
    templateId: text("template_id").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    definition: jsonb("definition").$type<TemplateDefinition>().notNull(),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({
      name: "document_templates_blog_template_version_pk",
      columns: [t.blogId, t.templateId, t.version],
    }),
    check("document_templates_version_positive", sql`${t.version} > 0`),
  ],
);

// Bearer capability links make collaboration possible without an account. The
// raw secret appears only in the URL fragment/client; the database stores its
// SHA-256 digest. A grant is scoped to one document and can be revoked.
export const documentCapabilityLinks = pgTable(
  "document_capability_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    role: text("role").notNull().default("viewer"),
    label: text("label"),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [
    uniqueIndex("document_capability_links_token_hash_idx").on(t.tokenHash),
    index("document_capability_links_post_active_idx")
      .on(t.postId, t.createdAt)
      .where(sql`${t.revokedAt} is null`),
    check(
      "document_capability_links_role_valid",
      sql`${t.role} in ('viewer', 'commenter', 'editor')`,
    ),
  ],
);

// Durable discussion belongs to an item but is deliberately not part of the
// post row: it never enters Markdown, sync files, or public reader payloads.
// Deleting a post permanently removes its comments in the database, while a
// soft-deleted post keeps its discussion intact for restore.
export const itemComments = pgTable(
  "item_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => itemComments.id,
      { onDelete: "cascade" },
    ),
    body: text("body").notNull(),
    anchorField: itemCommentAnchorField("anchor_field"),
    anchorQuote: text("anchor_quote"),
    anchorStart: integer("anchor_start"),
    anchorEnd: integer("anchor_end"),
    /** Base64 Y.RelativePosition anchors; quote/offsets remain fallbacks. */
    anchorStartRelative: text("anchor_start_relative"),
    anchorEndRelative: text("anchor_end_relative"),
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** display-name snapshot supplied by the authorized caller */
    authorName: text("author_name"),
    /** "human" | "ai" | "external_agent" */
    authorActorType: text("author_actor_type").notNull(),
    editedByUserId: uuid("edited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    editedByActorType: text("edited_by_actor_type"),
    resolvedAt: timestamp("resolved_at"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedByActorType: text("resolved_by_actor_type"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("item_comments_post_created_idx").on(t.postId, t.createdAt, t.id),
    index("item_comments_parent_created_idx").on(t.parentId, t.createdAt, t.id),
    index("item_comments_post_resolved_created_idx").on(
      t.postId,
      t.resolvedAt,
      t.createdAt,
    ),
    check("item_comments_body_not_blank", sql`length(btrim(${t.body})) > 0`),
    check(
      "item_comments_anchor_complete",
      sql`(
        (${t.anchorField} is null and ${t.anchorQuote} is null and
          ${t.anchorStart} is null and ${t.anchorEnd} is null)
        or
        (${t.anchorField} is not null and ${t.anchorQuote} is not null and
          length(btrim(${t.anchorQuote})) > 0)
      )`,
    ),
    check(
      "item_comments_anchor_offsets_valid",
      sql`(${t.anchorStart} is null or ${t.anchorStart} >= 0) and
        (${t.anchorEnd} is null or ${t.anchorEnd} >= 0) and
        (${t.anchorStart} is null or ${t.anchorEnd} is null or
          ${t.anchorEnd} >= ${t.anchorStart})`,
    ),
    check(
      "item_comments_actor_types_valid",
      sql`${t.authorActorType} in ('human', 'ai', 'external_agent') and
        (${t.editedByActorType} is null or
          ${t.editedByActorType} in ('human', 'ai', 'external_agent')) and
        (${t.resolvedByActorType} is null or
          ${t.resolvedByActorType} in ('human', 'ai', 'external_agent'))`,
    ),
    check(
      "item_comments_edit_actor_complete",
      sql`${t.editedByUserId} is null or ${t.editedByActorType} is not null`,
    ),
    check(
      "item_comments_resolution_complete",
      sql`(
        ${t.resolvedAt} is null and ${t.resolvedByUserId} is null and
          ${t.resolvedByActorType} is null
      ) or (
        ${t.resolvedAt} is not null and ${t.resolvedByActorType} is not null
      )`,
    ),
  ],
);

// Reader responses to poll nodes. One row per (post, poll field, responder);
// re-voting updates the row. The responder key is the signed-in user id or an
// anonymous cookie value, so results stay one-per-reader without requiring an
// account. Values are the selected option labels from the document's own
// options rows. Responses are reader data, deliberately outside the document
// snapshot: editing the poll never rewrites history, and deleting the post
// cascades the votes away.
export const documentResponses = pgTable(
  "document_responses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    fieldId: text("field_id").notNull(),
    responderKey: text("responder_key").notNull(),
    /** display-name snapshot for signed-in responders; null for anonymous */
    responderName: text("responder_name"),
    values: jsonb("values").$type<string[]>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("document_responses_one_per_responder_idx").on(
      t.postId,
      t.fieldId,
      t.responderKey,
    ),
    index("document_responses_post_field_idx").on(t.postId, t.fieldId),
    check(
      "document_responses_responder_not_blank",
      sql`length(btrim(${t.responderKey})) > 0`,
    ),
  ],
);

// Idempotency for sync creates: a create carries a client-generated
// Idempotency-Key so an ambiguous response (the POST committed but the reply was
// lost) can be retried without duplicating the post or folder. The row is
// claimed first (resultId null) and updated with the created id, so even
// concurrent retries with the same key produce exactly one item. Keyed per
// workspace so keys never collide across tenants.
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    blogId: uuid("blog_id")
      .notNull()
      .references(() => blogs.id),
    key: text("key").notNull(),
    /** "post" | "folder" once known */
    resultKind: text("result_kind"),
    /** the created item's id; null while the create is still in flight */
    resultId: uuid("result_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({
      name: "idempotency_keys_pk",
      columns: [t.blogId, t.key],
    }),
  ],
);

// Realtime co-editing: the append log of Yjs document updates for a post.
// Clients POST their local CRDT updates here and long-poll for others' by
// sequence, so two people editing the same post converge without a websocket
// server (the same serverless long-poll shape as the sync change cursor). The
// `seq` is a global monotonic cursor; a reader asks for everything after the
// last seq it applied. Updates are stored base64-encoded (they are small
// binary diffs). Compaction collapses the log into one equivalent snapshot past
// a threshold (maybeCompactCollab in collab.ts), so an active post's log stays
// bounded.
export const collabUpdates = pgTable(
  "collab_updates",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id),
    /** base64 of a Yjs update (Y.encodeStateAsUpdate / update event) */
    update: text("update").notNull(),
    /**
     * The log GENERATION this row belongs to. Retiring a stale between-sessions
     * log bumps collab_state.epoch; rows from a retired epoch are ignored by the
     * relay (never deleted, so no orphaned delta), and an append fenced on an old
     * epoch is rejected. See docs/archive/2026-07-15-collab-hole2-reset-generation.md.
     */
    epoch: integer("epoch").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("collab_updates_post_seq_idx").on(t.postId, t.seq)],
);

// Per-post co-editing generation + body provenance, so a log left stale between
// sessions cannot overwrite an out-of-band body write (hole 2). `epoch` is the
// current log generation; `materializedRevision` is the posts.revision the log
// last wrote into posts.body (a collab autosave / session-end materialize). On
// the catch-up GET, when no session is live, the log has been quiescent, and
// posts.revision has moved past materializedRevision, the epoch is bumped
// (single-writer upsert CAS) and the next editor reseeds from posts.body instead
// of replaying the stale log. See the hole-2 plan for the full race analysis.
export const collabState = pgTable("collab_state", {
  postId: uuid("post_id")
    .primaryKey()
    .references(() => posts.id),
  epoch: integer("epoch").notNull().default(0),
  /** Complete Yjs update generated from the canonical document at epoch start. */
  baselineUpdate: text("baseline_update"),
  /** posts.revision used to generate baselineUpdate. */
  baselineRevision: bigint("baseline_revision", { mode: "number" }),
  materializedRevision: bigint("materialized_revision", { mode: "number" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Ephemeral presence for co-editing: who is in a post right now and where
// their cursor is. Rows are upserted on a heartbeat and treated as stale
// after a short window; nothing here is durable state.
export const collabPresence = pgTable(
  "collab_presence",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id),
    /** the editor client's random per-tab id */
    clientId: text("client_id").notNull(),
    userName: text("user_name").notNull(),
    /** display color for the cursor caret */
    color: text("color").notNull(),
    /** Base64 y-protocols Awareness update for cursor and selection state. */
    awareness: text("awareness"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.clientId] }),
    index("collab_presence_post_idx").on(t.postId, t.updatedAt),
  ],
);

// OAuth 2.1 authorization-code + PKCE grants for public connector clients.
// The raw authorization code is shown only in the redirect response; only its
// SHA-256 hash is stored here. Rows are single-use and short-lived.
export const oauthAuthorizationCodes = pgTable(
  "oauth_authorization_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    codeHash: text("code_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    clientId: text("client_id").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    scope: text("scope").notNull().default("sync"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
  },
  (t) => [uniqueIndex("oauth_authorization_codes_hash_idx").on(t.codeHash)],
);

export type OAuthAuthorizationCode =
  typeof oauthAuthorizationCodes.$inferSelect;
export type NewOAuthAuthorizationCode =
  typeof oauthAuthorizationCodes.$inferInsert;

// OAuth Dynamic Client Registration records for public connector clients.
// Each row is a client_id plus the exact redirect_uri allowlist registered by
// that client. The token endpoint still issues bearer tokens through api_tokens.
export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: text("client_id").notNull(),
    clientName: text("client_name").notNull().default("OAuth client"),
    redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
    scope: text("scope").notNull().default("sync"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [uniqueIndex("oauth_clients_client_id_idx").on(t.clientId)],
);

export type OAuthClientRecord = typeof oauthClients.$inferSelect;
export type NewOAuthClientRecord = typeof oauthClients.$inferInsert;

// A refresh-token family is one OAuth authorization grant. Rotations retain the
// original absolute deadline, slide the inactivity deadline, and revoke the
// whole family if any consumed refresh token is presented again.
export const oauthRefreshTokenFamilies = pgTable(
  "oauth_refresh_token_families",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    clientId: text("client_id").notNull(),
    scope: text("scope").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at").notNull(),
    inactivityExpiresAt: timestamp("inactivity_expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    replayDetectedAt: timestamp("replay_detected_at"),
  },
  (t) => [
    index("oauth_refresh_families_user_idx").on(t.userId),
    index("oauth_refresh_families_client_idx").on(t.clientId),
  ],
);

// OAuth access-token metadata is separate from api_tokens so existing manual
// tokens preserve their current lifecycle. The api_tokens row remains the
// single bearer identity consumed by sync and MCP authentication.
export const oauthAccessTokens = pgTable(
  "oauth_access_tokens",
  {
    apiTokenId: uuid("api_token_id")
      .primaryKey()
      .references(() => apiTokens.id, { onDelete: "cascade" }),
    refreshTokenFamilyId: uuid("refresh_token_family_id")
      .notNull()
      .references(() => oauthRefreshTokenFamilies.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("oauth_access_tokens_family_idx").on(t.refreshTokenFamilyId),
  ],
);

// Raw refresh tokens are returned once and never persisted. Only their SHA-256
// hashes live here; consumed_at makes rotation/replay detection atomic.
export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    refreshTokenFamilyId: uuid("refresh_token_family_id")
      .notNull()
      .references(() => oauthRefreshTokenFamilies.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    accessTokenId: uuid("access_token_id").references(() => apiTokens.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    consumedAt: timestamp("consumed_at"),
  },
  (t) => [
    uniqueIndex("oauth_refresh_tokens_hash_idx").on(t.tokenHash),
    index("oauth_refresh_tokens_family_idx").on(t.refreshTokenFamilyId),
  ],
);

export type OAuthRefreshTokenFamily =
  typeof oauthRefreshTokenFamilies.$inferSelect;
export type NewOAuthRefreshTokenFamily =
  typeof oauthRefreshTokenFamilies.$inferInsert;
export type OAuthAccessToken = typeof oauthAccessTokens.$inferSelect;
export type NewOAuthAccessToken = typeof oauthAccessTokens.$inferInsert;
export type OAuthRefreshToken = typeof oauthRefreshTokens.$inferSelect;
export type NewOAuthRefreshToken = typeof oauthRefreshTokens.$inferInsert;
