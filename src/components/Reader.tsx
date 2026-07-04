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

// The Broadsheet reader: top cover hero, masthead (serif title, dek, byline),
// and prose. Server component; markdown renders on the server. The post's
// accent rides in as --post-accent and may be absent, in which case every
// accent use in broadsheet.css degrades to neutral ink.

type ReaderSlots = {
  title?: ReactNode;
  excerpt?: ReactNode;
  cover?: ReactNode;
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
  const cover = slots?.cover ?? (
    post.cover ? (
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
    ) : null
  );
  return (
    <article className="reader" style={style}>
      {cover}
      <header className="reader-masthead">
        {slots?.title ?? <h1 className="reader-title">{title}</h1>}
        {slots?.excerpt ?? (
          excerpt && <p className="reader-dek">{excerpt}</p>
        )}
        <Byline blog={blog} post={post} />
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
