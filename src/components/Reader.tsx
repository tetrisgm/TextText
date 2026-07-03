import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Blog, Post } from "@/lib/content";
import {
  formatArticleDate,
  readingTimeMin,
  postAccent,
  monogram,
} from "@/lib/content";

// The Broadsheet reader: masthead (eyebrow, serif title, byline, framed cover),
// prose, and the author end card. Server component; markdown renders on the
// server. The post's accent rides in as --post-accent and may be absent, in
// which case every accent use in broadsheet.css degrades to neutral ink.

type ReaderSlots = {
  title?: ReactNode;
  kicker?: ReactNode;
  body?: ReactNode;
};

function Byline({ blog, post }: { blog: Blog; post: Post }) {
  const meta = [
    formatArticleDate(post.date),
    post.body ? `${readingTimeMin(post.body)} min read` : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
  return (
    <div className="reader-byline">
      <span className="reader-avatar" aria-hidden="true">
        {monogram(blog.author)}
      </span>
      <span className="reader-byline-text">
        <span className="reader-author">{blog.author}</span>
        {meta && <span className="reader-byline-meta">{meta}</span>}
      </span>
    </div>
  );
}

function EndCard({ blog, post }: { blog: Blog; post: Post }) {
  const date = formatArticleDate(post.date);
  return (
    <aside className="reader-endcard">
      <span className="reader-endcard-avatar" aria-hidden="true">
        {monogram(blog.author)}
      </span>
      <div className="reader-endcard-text">
        <span className="reader-endcard-name">Written by {blog.author}</span>
        {blog.bioLine && (
          <span className="reader-endcard-line">{blog.bioLine}</span>
        )}
        {date && <span className="reader-endcard-date">{date}</span>}
      </div>
    </aside>
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
  return (
    <article className="reader" style={style}>
      <header className="reader-masthead">
        {slots?.kicker ?? (
          post.kicker && <div className="reader-eyebrow">{post.kicker}</div>
        )}
        {slots?.title ?? <h1 className="reader-title">{title}</h1>}
        <Byline blog={blog} post={post} />
        {post.cover && (
          <figure className="reader-cover">
            {/* Covers are user-provided remote URLs; plain img keeps the demo
                free of next/image remote-domain config. Revisit with media. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.cover} alt={title} />
            {post.coverCaption && (
              <figcaption className="reader-figcaption">
                {post.coverCaption}
              </figcaption>
            )}
          </figure>
        )}
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
      <EndCard blog={blog} post={post} />
    </article>
  );
}
