import type { MouseEvent } from "react";
import type { Blog } from "@/lib/content";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import { blogPostPath } from "@/lib/public-paths";

export function BacklinksPanel({
  blog,
  posts,
  onNavigate,
}: {
  blog: Blog;
  posts: readonly WorkspacePoolPost[];
  onNavigate?: (href: string) => Promise<void> | void;
}) {
  if (posts.length === 0) return null;
  return (
    <aside className="backlinks-panel" aria-label="Linked from">
      <h2>Linked from</h2>
      <nav aria-label="Backlinks">
        {posts.map((post) => {
          const href = blogPostPath(blog, post);
          return (
            <a
              key={post.id}
              href={href}
              onClick={
                onNavigate
                  ? (event: MouseEvent<HTMLAnchorElement>) => {
                      event.preventDefault();
                      void onNavigate(href);
                    }
                  : undefined
              }
            >
              <span>{post.title.trim() || "Untitled"}</span>
              <small>{post.slug}</small>
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
