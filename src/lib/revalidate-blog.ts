// The ONE place that knows which public paths a blog mutation invalidates:
// the /t handle mirror plus the /u/{username} tree when the blog is claimed.
// Server actions and the sync API both call this.

import { revalidatePath } from "next/cache";
import type { Blog } from "@/lib/content";
import { tenantHomePath } from "@/lib/public-paths";

const BLOG_FEED_PATHS = [
  "posts.json",
  "feed.json",
  "feed.xml",
  "atom.xml",
  "sitemap.xml",
  "llms.txt",
  "folder.json",
];

/**
 * Cache invalidation is a side effect of a mutation, never its point.
 *
 * `revalidatePath` throws outside a Next request scope ("static generation
 * store missing"), and the workspace tools are reachable from places that have
 * no request: a CLI, a harness, any background caller. Letting that throw
 * turned a mutation that had already committed into "The item could not be
 * saved", which is a lie about what happened. Nothing is stale that the next
 * request will not refetch.
 */
function revalidateQuietly(path: string): void {
  try {
    revalidatePath(path);
  } catch {
    // No request scope. The write stands.
  }
}

export function revalidateBlogPaths(
  blog: Pick<Blog, "handle" | "username">,
  slugs: string[] = [],
): void {
  const uniqueSlugs = [...new Set(slugs.filter(Boolean))];
  const roots = [tenantHomePath(blog.handle)];
  if (blog.username) roots.push(`/u/${encodeURIComponent(blog.username)}`);

  for (const root of roots) {
    revalidateQuietly(root);
    for (const feedPath of BLOG_FEED_PATHS) {
      revalidateQuietly(`${root}/${feedPath}`);
    }
    for (const slug of uniqueSlugs) {
      revalidateQuietly(`${root}/${encodeURIComponent(slug)}`);
      revalidateQuietly(`${root}/${encodeURIComponent(slug)}/index.md`);
    }
  }
}
