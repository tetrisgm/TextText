// Content access for the reader routes. With DATABASE_URL unset this serves
// the demo seed so the app runs with zero setup; the Postgres path fills in
// behind the same functions when the database lands.

import type { Blog, Post } from "./content";
import { DEMO_BLOG, DEMO_POSTS } from "./demo";

const hasDb = !!process.env.DATABASE_URL;

export async function getBlog(handle: string): Promise<Blog | null> {
  if (!hasDb) {
    return handle === DEMO_BLOG.handle ? DEMO_BLOG : null;
  }
  // TODO(db): select from blogs where handle = $1
  return null;
}

export async function getPosts(handle: string): Promise<Post[]> {
  if (!hasDb) {
    if (handle !== DEMO_BLOG.handle) return [];
    return DEMO_POSTS.filter((p) => p.status === "published");
  }
  // TODO(db): select published posts for the blog, newest first
  return [];
}

export async function getAllPosts(handle: string): Promise<Post[]> {
  if (!hasDb) {
    if (handle !== DEMO_BLOG.handle) return [];
    return DEMO_POSTS;
  }
  // TODO(db): select all posts for the blog, newest first
  return [];
}

export async function getPost(
  handle: string,
  slug: string,
): Promise<Post | null> {
  const posts = await getPosts(handle);
  return posts.find((p) => p.slug === slug) ?? null;
}
