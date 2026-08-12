import type { CSSProperties } from "react";
import Link from "next/link";
import { PostCard } from "@/components/PostCard";
import styles from "@/components/CategoryListing.module.css";
import type { Blog, Post } from "@/lib/content";
import {
  blogHomePath,
  blogPostPath,
  workspacePublicPostPath,
} from "@/lib/public-paths";

type TagLocation = { folderPath: string; post: Post };

export function TagListing({
  blog,
  handle,
  locations,
  publicOrigin = false,
  tag,
}: {
  blog: Blog;
  handle: string;
  locations: TagLocation[];
  publicOrigin?: boolean;
  tag: string;
}) {
  const style = blog.accent
    ? ({ "--post-accent": blog.accent } as CSSProperties)
    : undefined;
  return (
    <main className={`blog-home ${styles.root}`} style={style}>
      <header className={`blog-home-header ${styles.header}`}>
        <nav className={styles.breadcrumbs} aria-label="Tag breadcrumb">
          <Link
            className={styles.breadcrumbLink}
            href={publicOrigin ? "/" : blogHomePath(blog)}
          >
            {blog.name}
          </Link>
          <span className={styles.separator}>/</span>
          <span className={styles.current}>Tags</span>
        </nav>
        <div className="blog-home-heading">
          <div className="blog-home-copy">
            <h1 className={`blog-home-name ${styles.title}`}>#{tag}</h1>
          </div>
        </div>
      </header>
      {locations.length === 0 ? (
        <p className={`blog-home-empty ${styles.empty}`}>Nothing here yet</p>
      ) : (
        <div className="tv-grid">
          {locations.map(({ folderPath, post }) => (
            <PostCard
              key={post.id ?? `${folderPath}/${post.slug}`}
              blog={blog}
              handle={handle}
              href={
                publicOrigin
                  ? workspacePublicPostPath(folderPath, post.slug) ?? "/"
                  : blogPostPath(blog, post)
              }
              post={post}
              owner={false}
              tagBasePath={publicOrigin ? "/tags" : undefined}
            />
          ))}
        </div>
      )}
    </main>
  );
}
