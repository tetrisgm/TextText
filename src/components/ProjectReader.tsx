import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ProjectGallery } from "@/components/ProjectGallery";
import type { Blog, LinkRef, Post } from "@/lib/content";
import { postAccent } from "@/lib/content";

type ReaderSlots = {
  title?: ReactNode;
  excerpt?: ReactNode;
  body?: ReactNode;
};

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function ProjectLinks({ links }: { links: LinkRef[] }) {
  if (links.length === 0) return null;

  return (
    <nav className="project-links" aria-label="Project links">
      {links.map((link, index) => {
        const external = isExternalHref(link.href);
        return (
          <a
            key={`${link.href}:${index}`}
            href={link.href}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
          >
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}

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
  const excerpt = post.excerpt?.trim();

  return (
    <article className="project-split" style={style}>
      <section className="project-split-left" aria-labelledby="project-title">
        <div className="project-split-inner">
          {slots?.title ?? (
            <h1 className="project-title" id="project-title">
              {title}
            </h1>
          )}
          {slots?.excerpt ?? (
            excerpt && <p className="reader-dek project-dek">{excerpt}</p>
          )}
          {(slots?.body || post.body) && (
            <div className="reader-prose project-prose">
              {slots?.body ?? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: ({ src, alt }) => (
                      <span className="reader-figure">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={typeof src === "string" ? src : ""}
                          alt={alt ?? ""}
                          loading="lazy"
                        />
                        {alt && (
                          <span className="reader-figcaption">{alt}</span>
                        )}
                      </span>
                    ),
                  }}
                >
                  {post.body}
                </ReactMarkdown>
              )}
            </div>
          )}
          <ProjectLinks links={post.links ?? []} />
        </div>
      </section>

      <aside className="project-split-right" aria-label="Project gallery">
        <ProjectGallery post={post} />
      </aside>
    </article>
  );
}
