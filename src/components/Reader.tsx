import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PostByline } from "@/components/PostByline";
import type { Blog, Post } from "@/lib/content";
import {
  formatArticleDate,
  isVideoFile,
  postAccent,
  readingTimeMin,
} from "@/lib/content";
import { resolveCoverSource } from "@/lib/cover";
import {
  isRemoteImageUrl,
  localizeRemoteMarkdownImages,
} from "@/lib/markdown-images";

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

function upgradeHttpImageSrc(src: string | undefined): string {
  const value = src ?? "";
  return value.startsWith("http://") ? `https://${value.slice(7)}` : value;
}

function BookmarkMeta({ post }: { post: Post }) {
  const items = [
    post.body ? `${readingTimeMin(post.body)} min read` : "",
    formatArticleDate(post.date, { style: "short" }),
  ].filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className="reader-bookmark-meta" aria-label="Bookmark details">
      {items.map((item, index) => (
        <span key={`${item}:${index}`}>
          {index > 0 && <span aria-hidden="true"> · </span>}
          {item}
        </span>
      ))}
    </div>
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
  const hideRemoteBodyImages = false;
  const bodyImageReplacements = new Map(
    (post.capture?.assets ?? [])
      .filter((asset) => asset.originalUrl && asset.url)
      .map((asset) => [asset.originalUrl, asset.url] as const),
  );
  const allowedBodyImageUrls = new Set(bodyImageReplacements.values());
  const bodyMarkdown = hideRemoteBodyImages
    ? localizeRemoteMarkdownImages(post.body, bodyImageReplacements)
    : post.body;
  const coverStyle = post.coverHeight
    ? ({ "--reader-cover-height": `${post.coverHeight}px` } as CSSProperties)
    : undefined;
  const coverClassName = [
    "reader-cover",
    coverSource.kind === "bookmark-screenshot" ? "is-capture-cover" : "",
    coverSource.kind === "bookmark-body-image" ? "is-bookmark-image-cover" : "",
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
              coverSource.kind === "bookmark-screenshot" ? "eager" : undefined
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
        {post.type === "bookmark" ? (
          <BookmarkMeta post={post} />
        ) : (
          <PostByline blog={blog} post={post} />
        )}
      </header>
      <div className="reader-prose">
        {slots?.body ?? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: "h2",
              // Inline figures: ![caption](src); the alt doubles as the caption.
              img: ({ src, alt }) => {
                const imageSrc = typeof src === "string" ? src : undefined;
                if (
                  hideRemoteBodyImages &&
                  isRemoteImageUrl(imageSrc) &&
                  !allowedBodyImageUrls.has(imageSrc)
                ) {
                  return null;
                }
                return (
                  <span className="reader-figure">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={upgradeHttpImageSrc(imageSrc)}
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
                );
              },
            }}
          >
            {bodyMarkdown}
          </ReactMarkdown>
        )}
      </div>
    </article>
  );
}
