import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  BlogHomeShell,
} from "@/components/BlogHomeEditorControls";
import { PostCard } from "@/components/PostCard";
import { isAuthConfigured } from "@/auth";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { blogFeedAlternateTypes, blogFeedHref } from "@/lib/feed-links";
import { getCurrentUser } from "@/lib/session";
import {
  DEFAULT_ANONYMOUS_BLOG_NAME,
  getAllPosts,
  getBlog,
  getPosts,
} from "@/lib/store";
import {
  formatArticleDate,
  isVideoFile,
  isYouTube,
  postAccent,
  readingTimeMin,
  youtubeThumb,
} from "@/lib/content";
import type { Blog, Post, PostType } from "@/lib/content";
import { resolveCover } from "@/lib/cover";

interface Props {
  params: Promise<{ handle: string }>;
  searchParams?: Promise<{ claim?: string | string[] }>;
}

function blogStyle(blog: Blog): CSSProperties | undefined {
  return blog.accent
    ? ({ "--post-accent": blog.accent } as CSSProperties)
    : undefined;
}

function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isDefaultBlogName(name: string): boolean {
  const normalized = name.trim().replace(/\s+/g, " ").toLowerCase();
  return (
    !normalized ||
    normalized === DEFAULT_ANONYMOUS_BLOG_NAME.toLowerCase()
  );
}

const TYPE_LABELS: Record<PostType, string> = {
  article: "ARTICLE",
  project: "PROJECT",
  talk: "TALK",
};

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

function postStyle(blog: Blog, post: Post): CSSProperties | undefined {
  const accent = postAccent(blog, post);
  if (accent) return { "--post-accent": accent } as CSSProperties;
  if (post.accent !== undefined) {
    return { "--post-accent": "var(--ink)" } as CSSProperties;
  }
  return undefined;
}

function BlogTimeline({
  blog,
  handle,
  posts,
  owner,
}: {
  blog: Blog;
  handle: string;
  posts: Post[];
  owner: boolean;
}) {
  return (
    <div className="blog-timeline" aria-label="Posts">
      {posts.map((post) => {
        const title = postTitle(post);
        const cover = resolveCover(post);
        const meta = timelineMeta(post);
        const excerpt = timelineExcerpt(post);
        const thumbnail = timelineImageSrc(cover);
        const accent = postAccent(blog, post);
        const showUnlisted = owner && post.status === "draft";

        return (
          <Link
            key={post.slug}
            className="blog-timeline-row"
            href={`/t/${handle}/${post.slug}`}
            prefetch={true}
            style={postStyle(blog, post)}
          >
            <span className="blog-timeline-copy">
              <span className="blog-timeline-chip-row">
                <span
                  className="blog-timeline-chip"
                  style={{ background: accent ?? "var(--ink)" }}
                >
                  {TYPE_LABELS[post.type]}
                </span>
                {post.pinned && (
                  <span className="blog-timeline-marker">Pinned</span>
                )}
                {showUnlisted && (
                  <span className="blog-timeline-marker">Unlisted</span>
                )}
              </span>
              <span className="blog-timeline-title">{title}</span>
              <span className="blog-timeline-meta">{meta}</span>
              {excerpt && (
                <span className="blog-timeline-excerpt">{excerpt}</span>
              )}
            </span>
            <span className="blog-timeline-thumb" aria-hidden="true">
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
          </Link>
        );
      })}
    </div>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const blog = await getBlog(handle);
  if (!blog) return {};
  return {
    title: blog.name,
    description: blog.tagline,
    alternates: {
      types: blogFeedAlternateTypes(handle, blog.name),
    },
  };
}

export default async function BlogHome({ params, searchParams }: Props) {
  const { handle } = await params;
  const queryPromise: Promise<{ claim?: string | string[] }> =
    searchParams ?? Promise.resolve({});
  const [blog, access, viewer, query] = await Promise.all([
    getBlog(handle),
    getBlogEditAccess(handle),
    getCurrentUser(),
    queryPromise,
  ]);
  if (!blog) notFound();
  const canEdit = access.canEdit;
  const posts = canEdit ? await getAllPosts(handle) : await getPosts(handle);
  const feedHref = blogFeedHref(handle);
  const encodedHandle = encodeURIComponent(handle);
  const isUnnamedBlog = isDefaultBlogName(blog.name);
  const editableBlogName = isUnnamedBlog ? "" : blog.name;
  const showNamingCeremony = canEdit && isUnnamedBlog;
  const showClaim = canEdit && access.isUnclaimed && access.isTokenEditor;
  const feedLinks = [
    { href: feedHref, label: "RSS" },
    { href: `/t/${encodedHandle}/atom.xml`, label: "Atom" },
    { href: `/t/${encodedHandle}/feed.json`, label: "JSON Feed" },
  ];

  return (
    <BlogHomeShell
      handle={handle}
      blogName={blog.name}
      initialName={editableBlogName}
      tagline={blog.tagline}
      canEdit={canEdit}
      showClaim={showClaim}
      publicPath={`/t/${encodedHandle}`}
      signedIn={Boolean(viewer)}
      authConfigured={isAuthConfigured}
      autoClaim={queryValue(query.claim) === "1"}
      initialCardStyle={blog.cardStyle}
      initialHomeLayout={blog.homeLayout}
      initialNamingCeremony={showNamingCeremony}
      style={blogStyle(blog)}
    >
      {posts.length > 0 && blog.homeLayout === "timeline" && (
        <BlogTimeline
          blog={blog}
          handle={handle}
          posts={posts}
          owner={canEdit}
        />
      )}

      {posts.length > 0 && blog.homeLayout === "cards" && (
        <div className="tv-grid">
          {posts.map((post) => (
            <PostCard
              key={post.slug}
              blog={blog}
              handle={handle}
              post={post}
              owner={canEdit}
            />
          ))}
        </div>
      )}

      {posts.length > 0 && (
        <footer className="blog-home-footer" aria-label="Feeds">
          <span className="blog-home-footer-label">Feeds</span>
          {feedLinks.map((feed) => (
            <Link
              key={feed.href}
              className="blog-home-footer-link"
              href={feed.href}
              aria-label={`${blog.name} ${feed.label} feed`}
            >
              {feed.label}
            </Link>
          ))}
        </footer>
      )}
    </BlogHomeShell>
  );
}
