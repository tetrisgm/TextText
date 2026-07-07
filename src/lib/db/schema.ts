// Drizzle schema for the hosted platform (Neon Postgres). All content access
// goes through src/lib/store.ts, which serves the demo seed when DATABASE_URL
// is unset and reads/writes these tables when it is set.

import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import type { BookmarkCapture, GalleryItem, LinkRef } from "../content";

export const postStatus = pgEnum("post_status", ["draft", "published"]);
// article/project/talk live in the Blog folder; note and bookmark are the
// item kinds of the Notes and Bookmarks folders (always unlisted).
export const postType = pgEnum("post_type", [
  "article",
  "project",
  "talk",
  "note",
  "bookmark",
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
     * Bound on first access: invites are created by email before the person
     * has ever signed in, so userId starts null and is filled the first time
     * a signed-in session whose (provider-verified) email matches opens the
     * share. After binding, userId wins over the email match.
     */
    userId: uuid("user_id").references(() => users.id),
    /** normalized (lowercased, trimmed) invite address */
    invitedEmail: text("invited_email"),
    /** "editor" | "reviewer" | "viewer" (the owner is blogs.owner_id) */
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
    position: integer("position").notNull().default(0),
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
    type: postType("type").notNull().default("article"),
    slug: text("slug").notNull(),
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
    publishedAt: timestamp("published_at"),
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
