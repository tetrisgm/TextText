import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PostByline } from "@/components/PostByline";
import type { Blog, Post } from "@/lib/content";
import {
  isVideoFile,
  postAccent,
} from "@/lib/content";
import { resolveCover } from "@/lib/cover";

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
  const excerpt = post.excerpt?.trim();
  const resolvedCover = resolveCover(post);
  const coverCaption = post.coverCaption?.trim();
  const coverStyle = post.coverHeight
    ? ({ "--reader-cover-height": `${post.coverHeight}px` } as CSSProperties)
    : undefined;
  const defaultCover = resolvedCover ? (
    <figure className="reader-cover" style={coverStyle}>
      {isVideoFile(resolvedCover) ? (
        <video src={resolvedCover} controls playsInline preload="metadata" />
      ) : (
        <>
          {/* Covers can be remote uploads or local curated fallbacks. Plain img
              avoids next/image remote-domain config. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resolvedCover} alt={title} />
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
    <article className={className} style={style}>
      {cover}
      {slots?.toolbar}
      <header className="reader-masthead">
        {slots?.title ?? <h1 className="reader-title">{title}</h1>}
        {slots?.excerpt ?? (
          excerpt && <p className="reader-dek">{excerpt}</p>
        )}
        <PostByline blog={blog} post={post} />
      </header>
      <div className="reader-prose">
        {slots?.body ?? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Inline figures: ![caption](src); the alt doubles as the caption.
              img: ({ src, alt }) => (
                <span className="reader-figure">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={typeof src === "string" ? src : ""}
                    alt={alt ?? ""}
                    loading="lazy"
                  />
                  {alt && <span className="reader-figcaption">{alt}</span>}
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
