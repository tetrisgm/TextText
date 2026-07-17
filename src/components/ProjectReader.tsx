import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PostByline } from "@/components/PostByline";
import { ProjectGallery } from "@/components/ProjectGallery";
import type { Blog, Post } from "@/lib/content";
import { postAccent } from "@/lib/content";
import { postBodyWithSubtitle } from "@/lib/markdown-subtitle";

type ReaderSlots = {
  toolbar?: ReactNode;
  title?: ReactNode;
  body?: ReactNode;
  gallery?: ReactNode;
};

export function ProjectReader({
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
  const titleId = "project-title";
  const body = postBodyWithSubtitle(post);
  const className = `project-split${
    slots?.toolbar ? " has-editor-toolbar" : ""
  }`;

  return (
    <article className={className} style={style}>
      {slots?.toolbar}
      <section
        className="project-split-left"
        aria-labelledby={slots?.title ? undefined : titleId}
      >
        <div className="project-split-inner">
          <PostByline
            blog={blog}
            post={post}
            className="project-byline"
          />
          {slots?.title ?? (
            <h1 className="project-title" id={titleId}>
              {title}
            </h1>
          )}
          {(slots?.body || body) && (
            <div className="reader-prose project-prose">
              {slots?.body ?? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: "h2",
                    h6: ({ children }) => (
                      <p className="reader-subtitle project-subtitle">
                        {children}
                      </p>
                    ),
                    img: ({ src, alt }) => (
                      <span className="reader-figure">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={typeof src === "string" ? src : ""}
                          alt={alt ?? ""}
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
                  {body}
                </ReactMarkdown>
              )}
            </div>
          )}
        </div>
      </section>

      <aside className="project-split-right" aria-label="Project gallery">
        {slots?.gallery ?? <ProjectGallery post={post} />}
      </aside>
    </article>
  );
}
