import type { Blog, Post } from "@/lib/content";
import { formatArticleDate, monogram, readingTimeMin } from "@/lib/content";

type PostBylineVariant = "detail" | "card";

type PostBylineProps = {
  blog: Blog;
  post: Post;
  className?: string;
  metaItems?: Array<string | undefined | null | false>;
  variant?: PostBylineVariant;
};

function defaultMetaItems(post: Post): string[] {
  return [
    post.body ? `${readingTimeMin(post.body)} min read` : "",
    formatArticleDate(post.date, { style: "short" }),
  ].filter(Boolean);
}

export function PostByline({
  blog,
  post,
  className,
  metaItems,
  variant = "detail",
}: PostBylineProps) {
  const items = (metaItems ?? defaultMetaItems(post)).filter(Boolean) as string[];
  const rootClassName = [
    "post-byline",
    `is-${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName}>
      <span className="post-byline-avatar" aria-hidden="true">
        {monogram(blog.author)}
      </span>
      <span className="post-byline-copy">
        <span className="post-byline-main">
          <span className="post-byline-author">{blog.author}</span>
          {items.length > 0 && (
            <span className="post-byline-meta">
              {items.map((item, index) => (
                <span className="post-byline-meta-part" key={`${item}:${index}`}>
                  {index > 0 && (
                    <span className="post-byline-dot" aria-hidden="true">
                      ·
                    </span>
                  )}
                  <span>{item}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      </span>
    </div>
  );
}
