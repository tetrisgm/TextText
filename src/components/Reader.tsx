import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PostByline } from "@/components/PostByline";
import type { Blog, Post } from "@/lib/content";
import {
  isVideoFile,
  isSafeLinkHref,
  postAccent,
} from "@/lib/content";
import { resolveCoverSource } from "@/lib/cover";

// The public reader: top cover hero, centered masthead, byline, and prose.
// Server component; markdown renders on the server. The post's accent rides in
// as --post-accent and may be absent, in which case every accent use in the
// public CSS degrades to neutral ink.

type ReaderSlots = {
  toolbar?: ReactNode;
  title?: ReactNode;
  excerpt?: ReactNode;
  cover?: ReactNode;
  body?: ReactNode;
};

function safeHref(value: string | undefined): string {
  const href = value?.trim() ?? "";
  return href && isSafeLinkHref(href) ? href : "";
}

function upgradeHttpImageSrc(src: string | undefined): string {
  const value = src ?? "";
  return value.startsWith("http://") ? `https://${value.slice(7)}` : value;
}

function bookmarkOriginalHref(post: Post): string {
  return safeHref(post.capture?.url) || safeHref(post.links?.[0]?.href);
}

function BookmarkCapture({ post, title }: { post: Post; title: string }) {
  if (post.type !== "bookmark") return null;

  const screenshotUrl = safeHref(post.capture?.screenshotUrl);
  const htmlUrl = safeHref(post.capture?.htmlUrl);
  const originalUrl = bookmarkOriginalHref(post);

  if (!screenshotUrl && !htmlUrl && !originalUrl) return null;

  return (
    <section className="reader-bookmark-capture" aria-label="Bookmark capture">
      {originalUrl && (
        <div className="reader-bookmark-original">
          <span className="reader-bookmark-original-label">
            Original link
          </span>
          <a href={originalUrl} target="_blank" rel="noopener noreferrer">
            {originalUrl}
          </a>
        </div>
      )}
      {screenshotUrl && (
        <div className="reader-bookmark-capture-frame" tabIndex={0}>
          {/* User media can be remote, so plain img avoids next/image config. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshotUrl}
            alt={`Full-page screenshot of ${title}`}
            decoding="async"
            loading="lazy"
          />
        </div>
      )}
      {(htmlUrl || screenshotUrl) && (
        <div className="reader-bookmark-links" aria-label="Bookmark links">
          {htmlUrl && (
            <a href={htmlUrl} target="_blank" rel="noopener noreferrer">
              View saved original
            </a>
          )}
          {screenshotUrl && (
            <a href={screenshotUrl} target="_blank" rel="noopener noreferrer">
              View full page capture
            </a>
          )}
        </div>
      )}
    </section>
  );
}

export function Reader({
  blog,
  post,
  slots,
}: {
  blog: Blog;
  post: Post;
  slots?: ReaderSlots;
}) {
  const accent = postAccent(blog, post);
  const style = accent
    ? ({ "--post-accent": accent } as CSSProperties)
    : undefined;
  const title = post.title.trim() || "Untitled";
  const titleId = "reader-title";
  const excerpt = post.excerpt?.trim();
  const coverSource = resolveCoverSource(post);
  const resolvedCover = coverSource.src;
  const coverCaption = post.coverCaption?.trim();
  const coverImageSrc = upgradeHttpImageSrc(resolvedCover);
  const coverStyle = post.coverHeight
    ? ({ "--reader-cover-height": `${post.coverHeight}px` } as CSSProperties)
    : undefined;
  const coverClassName = [
    "reader-cover",
    coverSource.kind === "bookmark-screenshot" ? "is-capture-cover" : "",
    coverSource.kind === "bookmark-favicon" ? "is-favicon-cover" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const defaultCover = resolvedCover ? (
    <figure className={coverClassName} style={coverStyle}>
      {isVideoFile(resolvedCover) ? (
        <video src={resolvedCover} controls playsInline preload="metadata" />
      ) : (
        <>
          {/* Covers can be remote uploads or local curated fallbacks. Plain img
              avoids next/image remote-domain config. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverImageSrc}
            alt={title}
            decoding="async"
            loading={
              coverSource.kind === "bookmark-screenshot" ? "lazy" : undefined
            }
          />
        </>
      )}
      {coverCaption && (
        <figcaption className="reader-figcaption">{coverCaption}</figcaption>
      )}
    </figure>
  ) : null;
  const cover =
    slots && Object.prototype.hasOwnProperty.call(slots, "cover")
      ? slots.cover
      : defaultCover;
  const className = `reader${slots?.toolbar ? " has-editor-toolbar" : ""}`;

  return (
    <article
      className={className}
      style={style}
      aria-labelledby={slots?.title ? undefined : titleId}
    >
      {cover}
      {slots?.toolbar}
      <header className="reader-masthead">
        {slots?.title ?? (
          <h1 className="reader-title" id={titleId}>
            {title}
          </h1>
        )}
        {slots?.excerpt ?? (
          excerpt && <p className="reader-dek">{excerpt}</p>
        )}
        <PostByline blog={blog} post={post} />
      </header>
      <BookmarkCapture post={post} title={title} />
      <div className="reader-prose">
        {slots?.body ?? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: "h2",
              // Inline figures: ![caption](src); the alt doubles as the caption.
              img: ({ src, alt }) => (
                <span className="reader-figure">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={upgradeHttpImageSrc(
                      typeof src === "string" ? src : undefined,
                    )}
                    alt={alt ?? ""}
                    decoding="async"
                    loading="lazy"
                  />
                  {alt && (
                    <span className="reader-figcaption" aria-hidden="true">
                      {alt}
                    </span>
                  )}
                </span>
              ),
            }}
          >
            {post.body}
          </ReactMarkdown>
        )}
      </div>
    </article>
  );
}
