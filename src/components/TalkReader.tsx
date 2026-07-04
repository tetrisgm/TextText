import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Blog, LinkRef, Post } from "@/lib/content";
import {
  formatArticleDate,
  isVideoFile,
  isYouTube,
  postAccent,
  youtubeEmbedUrl,
} from "@/lib/content";
import { resolveCover } from "@/lib/cover";

type ReaderSlots = {
  toolbar?: ReactNode;
  stage?: ReactNode;
  title?: ReactNode;
  excerpt?: ReactNode;
  talkMeta?: ReactNode;
  body?: ReactNode;
};

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function LinksRow({ links }: { links: LinkRef[] }) {
  if (links.length === 0) return null;

  return (
    <nav className="talk-detail-links" aria-label="Talk links">
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

export function TalkReader({
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
  const cover = resolveCover(post);
  const videoUrl = post.videoUrl?.trim();
  const embedSrc = videoUrl && isYouTube(videoUrl) ? youtubeEmbedUrl(videoUrl) : undefined;
  const fileVideoSrc =
    videoUrl && !embedSrc && isVideoFile(videoUrl) ? videoUrl : undefined;
  const dateLine = [
    post.venue,
    formatArticleDate(post.date),
    post.duration,
  ]
    .filter(Boolean)
    .join(" · ");
  const links = [
    ...(videoUrl && embedSrc
      ? [{ label: "Watch on YouTube", href: videoUrl }]
      : []),
    ...(post.links ?? []),
  ];

  return (
    <article className="reader talk-detail" style={style}>
      {slots?.toolbar}
      {slots?.stage ??
        ((embedSrc || fileVideoSrc || cover) && (
          <div className="talk-detail-stage">
            {embedSrc ? (
              <iframe
                className="talk-detail-iframe"
                src={embedSrc}
                title={title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : fileVideoSrc ? (
              <video
                className="talk-detail-iframe"
                src={fileVideoSrc}
                poster={cover}
                controls
                playsInline
                preload="metadata"
              />
            ) : (
              // Covers can be remote uploads or local curated fallbacks.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="talk-detail-cover"
                src={cover}
                alt={title}
                loading="lazy"
              />
            )}
          </div>
        ))}

      <div className="talk-detail-meta">
        {slots?.title ?? <h1 className="talk-detail-title">{title}</h1>}
        {slots?.excerpt ?? (
          excerpt && <p className="reader-dek talk-detail-dek">{excerpt}</p>
        )}
        {slots?.talkMeta ?? (
          dateLine && <div className="talk-detail-date">{dateLine}</div>
        )}
        {(slots?.body || post.body) && (
          <div className="talk-detail-desc reader-prose">
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
                      {alt && <span className="reader-figcaption">{alt}</span>}
                    </span>
                  ),
                }}
              >
                {post.body}
              </ReactMarkdown>
            )}
          </div>
        )}
        <LinksRow links={links} />
      </div>
    </article>
  );
}
