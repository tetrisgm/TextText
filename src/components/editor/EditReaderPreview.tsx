"use client";

import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PostByline } from "@/components/PostByline";
import { ProjectGallery } from "@/components/ProjectGallery";
import type { Blog, LinkRef, Post } from "@/lib/content";
import {
  formatArticleDate,
  isSafeLinkHref,
  isVideoFile,
  isYouTube,
  postAccent,
  readingTimeMin,
  youtubeEmbedUrl,
} from "@/lib/content";
import { resolveCover, resolveCoverSource } from "@/lib/cover";

type EditReaderSlots = {
  toolbar?: ReactNode;
  title?: ReactNode;
  excerpt?: ReactNode;
  cover?: ReactNode;
  body?: ReactNode;
  gallery?: ReactNode;
  stage?: ReactNode;
  talkMeta?: ReactNode;
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

function MarkdownBody({
  body,
  upgradeImages = false,
}: {
  body: string;
  upgradeImages?: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: "h2",
        img: ({ src, alt }) => (
          <span className="reader-figure">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={
                upgradeImages
                  ? upgradeHttpImageSrc(
                      typeof src === "string" ? src : undefined,
                    )
                  : typeof src === "string"
                    ? src
                    : ""
              }
              alt={alt ?? ""}
              decoding={upgradeImages ? "async" : undefined}
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
  );
}

export function EditReaderPreview({
  blog,
  post,
  slots,
}: {
  blog: Blog;
  post: Post;
  slots?: EditReaderSlots;
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
        {slots?.body ?? <MarkdownBody body={post.body} upgradeImages />}
      </div>
    </article>
  );
}

export function EditProjectReaderPreview({
  blog,
  post,
  slots,
}: {
  blog: Blog;
  post: Post;
  slots?: EditReaderSlots;
}) {
  const accent = postAccent(blog, post);
  const style = accent
    ? ({ "--post-accent": accent } as CSSProperties)
    : undefined;
  const title = post.title.trim() || "Untitled";
  const titleId = "project-title";
  const excerpt = post.excerpt?.trim();
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
          {slots?.title ?? (
            <h1 className="project-title" id={titleId}>
              {title}
            </h1>
          )}
          {slots?.excerpt ?? (
            excerpt && <p className="reader-dek project-dek">{excerpt}</p>
          )}
          <PostByline
            blog={blog}
            post={post}
            className="project-byline"
          />
          {(slots?.body || post.body) && (
            <div className="reader-prose project-prose">
              {slots?.body ?? <MarkdownBody body={post.body} />}
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
            rel={external ? "noopener noreferrer" : undefined}
          >
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}

export function EditTalkReaderPreview({
  blog,
  post,
  slots,
}: {
  blog: Blog;
  post: Post;
  slots?: EditReaderSlots;
}) {
  const accent = postAccent(blog, post);
  const style = accent
    ? ({ "--post-accent": accent } as CSSProperties)
    : undefined;
  const title = post.title.trim() || "Untitled";
  const titleId = "talk-title";
  const cover = resolveCover(post);
  const videoUrl = post.videoUrl?.trim();
  const embedSrc = videoUrl && isYouTube(videoUrl) ? youtubeEmbedUrl(videoUrl) : undefined;
  const fileVideoSrc =
    videoUrl && !embedSrc && isVideoFile(videoUrl) ? videoUrl : undefined;
  const bylineMetaItems = [
    post.body ? `${readingTimeMin(post.body)} min read` : "",
    post.venue,
    formatArticleDate(post.date, { style: "short" }),
    post.duration,
  ]
    .filter(Boolean);
  const links = [
    ...(videoUrl && embedSrc
      ? [{ label: "Watch on YouTube", href: videoUrl }]
      : []),
    ...(post.links ?? []),
  ];

  const className = `reader talk-detail${
    slots?.toolbar ? " has-editor-toolbar" : ""
  }`;

  return (
    <article
      className={className}
      style={style}
      aria-labelledby={slots?.title ? undefined : titleId}
    >
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
        {slots?.title ?? (
          <h1 className="talk-detail-title" id={titleId}>
            {title}
          </h1>
        )}
        {slots?.excerpt}
        {slots?.talkMeta ?? (
          <PostByline
            blog={blog}
            post={post}
            className="talk-detail-byline"
            metaItems={bylineMetaItems}
          />
        )}
        {(slots?.body || post.body) && (
          <div className="talk-detail-desc reader-prose">
            {slots?.body ?? <MarkdownBody body={post.body} />}
          </div>
        )}
        <LinksRow links={links} />
      </div>
    </article>
  );
}
