// Drizzle schema for the hosted platform (Neon Postgres).
// Not yet wired into the routes: until DATABASE_URL exists the app serves the
// demo seed (src/lib/demo.ts). Auth.js adapter tables land with auth wiring.

import {
  boolean,
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
  email: text("email"),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
    ownerId: uuid("owner_id").references(() => users.id),
    /** SHA-256 hash of the anonymous editor token; null after claim */
    editTokenHash: text("edit_token_hash"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("blogs_handle_idx").on(t.handle),
    // One blog per owner (today): the editor provisions and resolves exactly
    // one, and this lets ensureOwnerBlog rely on the DB to settle the race on a
    // first sign-in rather than a read-then-write.
    uniqueIndex("blogs_owner_idx").on(t.ownerId),
  ],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    blogId: uuid("blog_id")
      .notNull()
      .references(() => blogs.id),
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
  },
  (t) => [uniqueIndex("posts_blog_slug_idx").on(t.blogId, t.slug)],
);
