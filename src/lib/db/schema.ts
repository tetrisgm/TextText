// Drizzle schema for the hosted platform (Neon Postgres). All content access
// goes through src/lib/store.ts, which serves the demo seed when DATABASE_URL
// is unset and reads/writes these tables when it is set.

import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import type { GalleryItem, LinkRef } from "../content";

export const postStatus = pgEnum("post_status", ["draft", "published"]);
export const postType = pgEnum("post_type", ["article", "project", "talk"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Apple `sub` claim; the primary identity (Sign in with Apple) */
  appleSub: text("apple_sub").unique(),
  /** public route segment, served as /@{username} */
  username: text("username"),
  email: text("email"),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("users_username_idx").on(t.username)]);

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
    /** URL-safe segment inside the workspace, e.g. "blog", "notes" */
    path: text("path").notNull(),
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
