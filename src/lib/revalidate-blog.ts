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

export function revalidateBlogPaths(
  blog: Pick<Blog, "handle" | "username">,
  slugs: string[] = [],
): void {
  const uniqueSlugs = [...new Set(slugs.filter(Boolean))];
  const roots = [tenantHomePath(blog.handle)];
  if (blog.username) roots.push(`/u/${encodeURIComponent(blog.username)}`);

  for (const root of roots) {
    revalidatePath(root);
    for (const feedPath of BLOG_FEED_PATHS) {
      revalidatePath(`${root}/${feedPath}`);
    }
    for (const slug of uniqueSlugs) {
      revalidatePath(`${root}/${encodeURIComponent(slug)}`);
      revalidatePath(`${root}/${encodeURIComponent(slug)}/index.md`);
    }
  }
}
