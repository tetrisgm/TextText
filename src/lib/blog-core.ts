import { cache } from "react";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db/client";
import { blogs, users } from "./db/schema";

export type BlogCore = {
  id: string;
  handle: string;
  ownerId: string | null;
  ownerSub: string | null;
  username: string | null;
  name: string;
  tagline: string | null;
  accent: string | null;
  bioLine: string | null;
  homeLayout: string | null;
  author: string | null;
  ownerPlan: string | null;
};

const blogCoreSelection = {
  id: blogs.id,
  handle: blogs.handle,
  ownerId: blogs.ownerId,
  ownerSub: users.appleSub,
  username: users.username,
  name: blogs.name,
  tagline: blogs.tagline,
  accent: blogs.accent,
  bioLine: blogs.bioLine,
  homeLayout: blogs.homeLayout,
  author: users.name,
  ownerPlan: users.plan,
};

async function getBlogCoreUncached(handle: string): Promise<BlogCore | null> {
  if (!db) return null;
  const rows = await db
    .select(blogCoreSelection)
    .from(blogs)
    .leftJoin(users, eq(blogs.ownerId, users.id))
    .where(and(eq(blogs.handle, handle), isNull(blogs.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

async function getBlogCoreByUsernameUncached(
  username: string,
): Promise<BlogCore | null> {
  if (!db) return null;
  const rows = await db
    .select(blogCoreSelection)
    .from(blogs)
    .innerJoin(users, eq(blogs.ownerId, users.id))
    .where(and(eq(users.username, username), isNull(blogs.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export const getBlogCore = cache(getBlogCoreUncached);
export const getBlogCoreByUsername = cache(getBlogCoreByUsernameUncached);
