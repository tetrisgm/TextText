"use client";

import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PostByline } from "@/components/PostByline";
import { ProjectGallery } from "@/components/ProjectGallery";
import type { Blog, LinkRef, Post } from "@/lib/content";
import {
  formatArticleDate,
  isVideoFile,
  isYouTube,
  postAccent,
  readingTimeMin,
  youtubeEmbedUrl,
} from "@/lib/content";
import { resolveCover, resolveCoverSource } from "@/lib/cover";
import {
  isRemoteImageUrl,
  localizeRemoteMarkdownImages,
} from "@/lib/markdown-images";

type EditReaderSlots = {
  toolbar?: ReactNode;
  title?: ReactNode;
  excerpt?: ReactNode;
  cover?: ReactNode;
  body?: ReactNode;
  gallery?: ReactNode;
  stage?: ReactNode;
  talkMeta?: ReactNode;
  byline?: ReactNode;
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

function MarkdownBody({
  allowedRemoteImages,
  body,
  hideRemoteImages = false,
  upgradeImages = false,
}: {
  allowedRemoteImages?: Set<string>;
  body: string;
  hideRemoteImages?: boolean;
  upgradeImages?: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: "h2",
        img: ({ src, alt }) => {
          const imageSrc = typeof src === "string" ? src : undefined;
          if (
            hideRemoteImages &&
            isRemoteImageUrl(imageSrc) &&
            !allowedRemoteImages?.has(imageSrc)
          ) {
            return null;
          }
          if (imageSrc && isVideoFile(imageSrc)) {
            return (
              <span className="reader-figure is-video">
                <video src={imageSrc} controls playsInline preload="metadata" />
              </span>
            );
          }
          return (
            <span className="reader-figure">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={
                  upgradeImages
                    ? upgradeHttpImageSrc(imageSrc)
                    : imageSrc ?? ""
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
          );
        },
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
  const bodyImageReplacements = new Map(
    (post.capture?.assets ?? [])
      .filter((asset) => asset.originalUrl && asset.url)
      .map((asset) => [asset.originalUrl, asset.url] as const),
  );
  const bodyMarkdown =
    post.type === "bookmark"
      ? localizeRemoteMarkdownImages(post.body, bodyImageReplacements)
      : post.body;

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
        {slots?.byline ?? (post.type === "bookmark" ? (
          <BookmarkMeta post={post} />
        ) : (
          <PostByline blog={blog} post={post} />
        ))}
      </header>
      <div className="reader-prose">
        {slots?.body ?? (
          <MarkdownBody
            allowedRemoteImages={new Set(bodyImageReplacements.values())}
            body={bodyMarkdown}
            hideRemoteImages={false}
            upgradeImages
          />
        )}
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
          {slots?.byline ?? <PostByline
            blog={blog}
            post={post}
            className="project-byline"
          />}
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
        {slots?.talkMeta ?? slots?.byline ?? (
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
