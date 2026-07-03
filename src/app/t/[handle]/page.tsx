import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBlog, getPosts } from "@/lib/store";
import type { Blog, Post, PostType } from "@/lib/content";
import {
  formatArticleDate,
  isVideoFile,
  isYouTube,
  postAccent,
  readingTimeMin,
  youtubeThumb,
} from "@/lib/content";

interface Props {
  params: Promise<{ handle: string }>;
}

const TYPE_LABELS: Record<PostType, string> = {
  article: "Article",
  project: "Project",
  talk: "Talk",
};

function blogStyle(blog: Blog): CSSProperties | undefined {
  return blog.accent
    ? ({ "--post-accent": blog.accent } as CSSProperties)
    : undefined;
}

function cardStyle(blog: Blog, post: Post): CSSProperties | undefined {
  const accent = postAccent(blog, post);
  if (accent) return { "--post-accent": accent } as CSSProperties;
  if (post.accent !== undefined) {
    return { "--post-accent": "var(--ink)" } as CSSProperties;
  }
  return undefined;
}

function projectThumbnail(post: Post): string | undefined {
  const first = post.gallery?.[0];
  if (!first?.src) return undefined;
  if (isVideoFile(first.src) || isYouTube(first.src)) return first.poster;
  return first.src;
}

function postThumbnail(post: Post): string | undefined {
  if (post.type === "article") return post.cover?.trim() || undefined;
  if (post.type === "project") return projectThumbnail(post);
  return post.cover?.trim() || youtubeThumb(post.videoUrl);
}

function postMeta(post: Post): string {
  return [formatArticleDate(post.date), `${readingTimeMin(post.body)} min read`]
    .filter(Boolean)
    .join(" · ");
}

function PlayBadge() {
  return (
    <span className="blog-card-play" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M5 3.5L12 8L5 12.5V3.5Z" fill="currentColor" />
      </svg>
    </span>
  );
}

function BlogPostCard({
  blog,
  handle,
  post,
}: {
  blog: Blog;
  handle: string;
  post: Post;
}) {
  const thumb = postThumbnail(post);
  const hasMedia = Boolean(thumb) || post.type !== "article";
  const className = [
    "blog-card",
    `blog-card--${post.type}`,
    hasMedia ? "" : "blog-card--text",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link
      href={`/t/${handle}/${post.slug}`}
      className={className}
      style={cardStyle(blog, post)}
    >
      {hasMedia && (
        <span className="blog-card-thumb" aria-hidden="true">
          {thumb ? (
            // User media can be remote; plain img matches the reader components.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="blog-card-media" src={thumb} alt="" loading="lazy" />
          ) : (
            <span className="blog-card-media-fill">
              <span>{post.title}</span>
            </span>
          )}
          {post.type === "talk" && <PlayBadge />}
        </span>
      )}
      <span className="blog-card-body">
        <span className="blog-card-chip">{TYPE_LABELS[post.type]}</span>
        <span className="blog-card-title">{post.title}</span>
        <span className="blog-card-meta">{postMeta(post)}</span>
      </span>
    </Link>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const blog = await getBlog(handle);
  if (!blog) return {};
  return {
    title: blog.name,
    description: blog.tagline,
  };
}

export default async function BlogHome({ params }: Props) {
  const { handle } = await params;
  const blog = await getBlog(handle);
  if (!blog) notFound();
  const posts = await getPosts(handle);

  return (
    <main className="blog-home" style={blogStyle(blog)}>
      <header className="blog-home-header">
        <h1 className="blog-home-name">{blog.name}</h1>
        {blog.tagline && <p className="blog-home-tagline">{blog.tagline}</p>}
      </header>

      {posts.length > 0 ? (
        <div className="blog-card-grid">
          {posts.map((post) => (
            <BlogPostCard
              key={post.slug}
              blog={blog}
              handle={handle}
              post={post}
            />
          ))}
        </div>
      ) : (
        <p className="blog-home-empty">No published posts yet</p>
      )}
    </main>
  );
}
