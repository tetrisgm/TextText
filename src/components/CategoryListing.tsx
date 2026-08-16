import type { CSSProperties } from "react";
import { Fragment } from "react";
import Link from "next/link";
import { PostCard } from "@/components/PostCard";
import styles from "@/components/CategoryListing.module.css";
import type { Blog, BlogHomeLayout, Folder, Post } from "@/lib/content";
import {
  formatArticleDate,
  isVideoFile,
  isYouTube,
  postBodyPreview,
  postAccent,
  postReadingTimeMin,
  youtubeThumb,
  plainTextExcerpt,
} from "@/lib/content";
import { resolveCover } from "@/lib/cover";
import {
  categoryBreadcrumbs,
  categoryChipForPost,
} from "@/lib/categories";
import { blogPostPath, workspacePublicPostPath } from "@/lib/public-paths";
import { postSubtitle } from "@/lib/markdown-subtitle";

function blogStyle(blog: Blog): CSSProperties | undefined {
  return blog.accent
    ? ({ "--post-accent": blog.accent } as CSSProperties)
    : undefined;
}

function postStyle(blog: Blog, post: Post): CSSProperties | undefined {
  const accent = postAccent(blog, post);
  if (accent) return { "--post-accent": accent } as CSSProperties;
  if (post.accent !== undefined) {
    return { "--post-accent": "var(--ink)" } as CSSProperties;
  }
  return undefined;
}

function postTitle(post: Post): string {
  return post.title.trim() || "Untitled";
}

function timelineExcerpt(post: Post): string {
  return postSubtitle(post) || plainTextExcerpt(postBodyPreview(post));
}

function timelineMeta(post: Post): string {
  return [formatArticleDate(post.date), `${postReadingTimeMin(post)} min read`]
    .filter(Boolean)
    .join(" / ");
}

function timelineImageSrc(src: string): string {
  if (!isYouTube(src)) return src;
  return youtubeThumb(src) ?? src;
}

function CategoryTimeline({
  blog,
  folders,
  folderPath,
  posts,
  publicOrigin,
}: {
  blog: Blog;
  folders: Folder[];
  folderPath: string;
  posts: Post[];
  publicOrigin: boolean;
}) {
  return (
    <div className="blog-timeline" aria-label="Posts">
      {posts.map((post) => {
        const title = postTitle(post);
        const cover = resolveCover(post);
        const meta = timelineMeta(post);
        const excerpt = timelineExcerpt(post);
        const thumbnail = cover ? timelineImageSrc(cover) : "";
        const category = categoryChipForPost(blog, post, folders, {
          publicOrigin,
        });

        return (
          <article
            key={post.slug}
            className={`blog-timeline-row ${styles.timelineRow}${
              thumbnail ? "" : " is-no-thumb"
            }`}
            style={postStyle(blog, post)}
          >
            <Link
              className={styles.rowLink}
              href={
                publicOrigin
                  ? workspacePublicPostPath(folderPath, post.slug) ?? "/"
                  : blogPostPath(blog, post)
              }
              prefetch={true}
              aria-label={title}
            >
              <span className={styles.hiddenLabel}>{title}</span>
            </Link>
            <span className={`blog-timeline-copy ${styles.timelineCopy}`}>
              <span className="blog-timeline-chip-row">
                {category && (
                  <Link
                    className={styles.categoryChip}
                    href={category.href}
                    prefetch={true}
                  >
                    {category.label}
                  </Link>
                )}
                {post.pinned && (
                  <span className="blog-timeline-marker">Pinned</span>
                )}
              </span>
              <span className="blog-timeline-title">{title}</span>
              <span className="blog-timeline-meta">{meta}</span>
              {excerpt && (
                <span className="blog-timeline-excerpt">{excerpt}</span>
              )}
            </span>
            {thumbnail && (
              <span
                className={`blog-timeline-thumb ${styles.timelineThumb}`}
                aria-hidden="true"
              >
                {isVideoFile(cover) ? (
                  <video
                    className="blog-timeline-thumb-media"
                    src={cover}
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  // User media can be remote, so plain img avoids next/image config.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="blog-timeline-thumb-media"
                    src={thumbnail}
                    alt=""
                    decoding="async"
                    loading="lazy"
                  />
                )}
              </span>
            )}
          </article>
        );
      })}
    </div>
  );
}

function CategoryIndex({
  blog,
  folders,
  folderPath,
  posts,
  publicOrigin,
}: {
  blog: Blog;
  folders: Folder[];
  folderPath: string;
  posts: Post[];
  publicOrigin: boolean;
}) {
  return (
    <div className="blog-index-list" aria-label="Posts">
      {posts.map((post) => {
        const title = postTitle(post);
        const category = categoryChipForPost(blog, post, folders, {
          publicOrigin,
        });
        return (
          <article
            key={post.slug}
            className={`blog-index-row ${styles.indexRow}`}
            style={postStyle(blog, post)}
          >
            <Link
              className={styles.rowLink}
              href={
                publicOrigin
                  ? workspacePublicPostPath(folderPath, post.slug) ?? "/"
                  : blogPostPath(blog, post)
              }
              prefetch={true}
              aria-label={title}
            >
              <span className={styles.hiddenLabel}>{title}</span>
            </Link>
            <span className={`blog-index-title ${styles.indexTitle}`}>
              {title}
            </span>
            <span className={`blog-index-meta ${styles.indexMeta}`}>
              {formatArticleDate(post.date)}
              {post.pinned ? " / Pinned" : ""}
              {category && (
                <Link
                  className={styles.categoryChip}
                  href={category.href}
                  prefetch={true}
                >
                  {category.label}
                </Link>
              )}
            </span>
          </article>
        );
      })}
    </div>
  );
}

function CategoryGrid({
  blog,
  folders,
  folderPath,
  handle,
  posts,
  publicOrigin,
}: {
  blog: Blog;
  folders: Folder[];
  folderPath: string;
  handle: string;
  posts: Post[];
  publicOrigin: boolean;
}) {
  // The grid reuses the shared PostCard as-is; its card is a single link, so
  // a category chip cannot nest inside without restructuring that component
  // (a whole-app change we are not making here). The chip still appears in
  // the timeline and index layouts, which own their card markup. `folders`
  // is unused in this layout for that reason.
  void folders;
  return (
    <div className="tv-grid">
      {posts.map((post) => (
        <PostCard
          key={post.slug}
          blog={blog}
          handle={handle}
          href={
            publicOrigin
              ? workspacePublicPostPath(folderPath, post.slug) ?? "/"
              : blogPostPath(blog, post)
          }
          post={post}
          owner={false}
          showTypeChip={false}
          tagBasePath={publicOrigin ? "/tags" : undefined}
        />
      ))}
    </div>
  );
}

function CategoryPosts({
  blog,
  folders,
  folderPath,
  handle,
  layout,
  posts,
  publicOrigin,
}: {
  blog: Blog;
  folders: Folder[];
  folderPath: string;
  handle: string;
  layout: BlogHomeLayout;
  posts: Post[];
  publicOrigin: boolean;
}) {
  if (layout === "timeline") {
    return (
      <CategoryTimeline
        blog={blog}
        folders={folders}
        folderPath={folderPath}
        posts={posts}
        publicOrigin={publicOrigin}
      />
    );
  }
  if (layout === "index") {
    return (
      <CategoryIndex
        blog={blog}
        folders={folders}
        folderPath={folderPath}
        posts={posts}
        publicOrigin={publicOrigin}
      />
    );
  }
  return (
    <CategoryGrid
      blog={blog}
      folders={folders}
      folderPath={folderPath}
      handle={handle}
      posts={posts}
      publicOrigin={publicOrigin}
    />
  );
}

export function CategoryListing({
  blog,
  folder,
  folders,
  handle,
  layout,
  posts,
  publicOrigin = false,
}: {
  blog: Blog;
  folder: Folder;
  folders: Folder[];
  handle: string;
  /** The folder's look decides how its index renders. */
  layout: BlogHomeLayout;
  posts: Post[];
  publicOrigin?: boolean;
}) {
  const crumbs = categoryBreadcrumbs(blog, folder, folders, { publicOrigin });

  return (
    <main className={`blog-home ${styles.root}`} style={blogStyle(blog)}>
      <header className={`blog-home-header ${styles.header}`}>
        <nav className={styles.breadcrumbs} aria-label="Category breadcrumb">
          {crumbs.map((crumb, index) => (
            <Fragment key={`${crumb.label}:${index}`}>
              {index > 0 && <span className={styles.separator}>/</span>}
              {crumb.href ? (
                <Link className={styles.breadcrumbLink} href={crumb.href}>
                  {crumb.label}
                </Link>
              ) : (
                <span className={styles.current}>{crumb.label}</span>
              )}
            </Fragment>
          ))}
        </nav>
        <div className="blog-home-heading">
          <div className="blog-home-copy">
            <h1 className={`blog-home-name ${styles.title}`}>
              {folder.name}
            </h1>
          </div>
        </div>
      </header>
      {posts.length === 0 ? (
        <p className={`blog-home-empty ${styles.empty}`}>Nothing here yet</p>
      ) : (
        <CategoryPosts
          blog={blog}
          folders={folders}
          folderPath={folder.path}
          handle={handle}
          layout={layout}
          posts={posts}
          publicOrigin={publicOrigin}
        />
      )}
    </main>
  );
}
