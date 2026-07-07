import type { CSSProperties } from "react";
import { Fragment } from "react";
import Link from "next/link";
import { PostCard } from "@/components/PostCard";
import styles from "@/components/CategoryListing.module.css";
import type { Blog, Folder, Post, PostType } from "@/lib/content";
import {
  formatArticleDate,
  isVideoFile,
  isYouTube,
  postAccent,
  readingTimeMin,
  youtubeThumb,
} from "@/lib/content";
import { resolveCover } from "@/lib/cover";
import {
  categoryBreadcrumbs,
  categoryChipForPost,
} from "@/lib/categories";
import { blogPostPath } from "@/lib/public-paths";

const TYPE_LABELS: Record<PostType, string> = {
  article: "Article",
  project: "Media",
  talk: "Video",
  note: "Note",
  bookmark: "Bookmark",
};

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

function oneLine(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const sliced = value.slice(0, maxLength - 3).trimEnd();
  const wordBreak = sliced.lastIndexOf(" ");
  const base = wordBreak > 70 ? sliced.slice(0, wordBreak) : sliced;
  return `${base}...`;
}

function plainTextExcerpt(markdown: string | undefined): string {
  if (!markdown) return "";
  return truncate(oneLine(stripMarkdown(markdown)), 180);
}

function timelineExcerpt(post: Post): string {
  return post.excerpt?.trim() || plainTextExcerpt(post.body);
}

function timelineMeta(post: Post): string {
  return [formatArticleDate(post.date), `${readingTimeMin(post.body)} min read`]
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
  posts,
}: {
  blog: Blog;
  folders: Folder[];
  posts: Post[];
}) {
  return (
    <div className="blog-timeline" aria-label="Posts">
      {posts.map((post) => {
        const title = postTitle(post);
        const cover = resolveCover(post);
        const meta = timelineMeta(post);
        const excerpt = timelineExcerpt(post);
        const thumbnail = cover ? timelineImageSrc(cover) : "";
        const category = categoryChipForPost(blog, post, folders);

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
              href={blogPostPath(blog, post)}
              prefetch={true}
              aria-label={title}
            >
              <span className={styles.hiddenLabel}>{title}</span>
            </Link>
            <span className={`blog-timeline-copy ${styles.timelineCopy}`}>
              <span className="blog-timeline-chip-row">
                <span className="blog-timeline-chip">
                  {TYPE_LABELS[post.type]}
                </span>
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
  posts,
}: {
  blog: Blog;
  folders: Folder[];
  posts: Post[];
}) {
  return (
    <div className="blog-index-list" aria-label="Posts">
      {posts.map((post) => {
        const title = postTitle(post);
        const category = categoryChipForPost(blog, post, folders);
        return (
          <article
            key={post.slug}
            className={`blog-index-row ${styles.indexRow}`}
            style={postStyle(blog, post)}
          >
            <Link
              className={styles.rowLink}
              href={blogPostPath(blog, post)}
              prefetch={true}
              aria-label={title}
            >
              <span className={styles.hiddenLabel}>{title}</span>
            </Link>
            <span className={`blog-index-title ${styles.indexTitle}`}>
              {title}
            </span>
            <span className={`blog-index-meta ${styles.indexMeta}`}>
              {[formatArticleDate(post.date), TYPE_LABELS[post.type]]
                .filter(Boolean)
                .join(" / ")}
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
  handle,
  posts,
}: {
  blog: Blog;
  folders: Folder[];
  handle: string;
  posts: Post[];
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
          post={post}
          owner={false}
        />
      ))}
    </div>
  );
}

function CategoryPosts({
  blog,
  folders,
  handle,
  posts,
}: {
  blog: Blog;
  folders: Folder[];
  handle: string;
  posts: Post[];
}) {
  if (blog.homeLayout === "timeline") {
    return <CategoryTimeline blog={blog} folders={folders} posts={posts} />;
  }
  if (blog.homeLayout === "index") {
    return <CategoryIndex blog={blog} folders={folders} posts={posts} />;
  }
  return (
    <CategoryGrid
      blog={blog}
      folders={folders}
      handle={handle}
      posts={posts}
    />
  );
}

export function CategoryListing({
  blog,
  folder,
  folders,
  handle,
  posts,
}: {
  blog: Blog;
  folder: Folder;
  folders: Folder[];
  handle: string;
  posts: Post[];
}) {
  const crumbs = categoryBreadcrumbs(blog, folder, folders);

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
          handle={handle}
          posts={posts}
        />
      )}
    </main>
  );
}
