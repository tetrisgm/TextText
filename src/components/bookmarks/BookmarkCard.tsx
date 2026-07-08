import Link from "next/link";
import type { Post } from "@/lib/content";
import { isVideoFile } from "@/lib/content";
import {
  isNoCoverValue,
  resolveCover,
  usesBookmarkCaptureCover,
} from "@/lib/cover";
import styles from "./BookmarkCard.module.css";

function classNames(...names: Array<string | false | undefined>): string {
  return names.filter(Boolean).join(" ");
}

function itemTitle(post: Post): string {
  return (post.capture?.title ?? post.title).trim() || "Untitled";
}

function originalHref(post: Post): string | undefined {
  return post.links?.[0]?.href;
}

function bookmarkHost(post: Post): string {
  const href = originalHref(post);
  if (!href) return "";
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return post.links?.[0]?.label ?? "";
  }
}

function firstTextLine(value: string | undefined): string {
  const line = (value ?? "")
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  return line ?? "";
}

function stripLeadingMarkdown(value: string): string {
  return value.replace(/^[\s#*>`-]+/, "").trim();
}

function previewLine(value: string | undefined): string {
  const line = stripLeadingMarkdown(firstTextLine(value));
  if (line.length <= 150) return line;
  const sliced = line.slice(0, 147).trimEnd();
  const wordBreak = sliced.lastIndexOf(" ");
  return `${wordBreak > 60 ? sliced.slice(0, wordBreak) : sliced}...`;
}

function faviconUrl(host: string): string {
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`;
}

function bookmarkThumbnail(post: Post): string {
  const cover = post.cover?.trim();
  if (cover && !isNoCoverValue(cover)) return resolveCover(post);
  if (usesBookmarkCaptureCover(post)) return resolveCover(post);
  return "";
}

function StatusChip({ status }: { status: Post["captureStatus"] }) {
  if (status === "pending") {
    return (
      <span className={classNames(styles.status, styles.pending)}>
        capturing
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className={classNames(styles.status, styles.failed)}>
        capture failed
      </span>
    );
  }
  return null;
}

export function BookmarkCard({
  post,
  editPath,
}: {
  post: Post;
  editPath: string;
}) {
  const title = itemTitle(post);
  const href = originalHref(post);
  const host = bookmarkHost(post);
  const description =
    previewLine(post.capture?.description) || previewLine(post.body);
  const screenshotUrl = post.capture?.screenshotUrl?.trim();
  const htmlUrl = post.capture?.htmlUrl?.trim();
  const hasActions = Boolean(href || htmlUrl || screenshotUrl);
  const thumbnailUrl = bookmarkThumbnail(post);
  const thumbnailIsCapture = usesBookmarkCaptureCover(post);
  const thumbnailMedia = isVideoFile(thumbnailUrl) ? (
    <video
      className={styles.thumbnail}
      src={thumbnailUrl}
      muted
      playsInline
      preload="metadata"
    />
  ) : (
    // User media can be remote, so plain img avoids next/image config.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={classNames(
        styles.thumbnail,
        thumbnailIsCapture && styles.captureThumbnail,
      )}
      src={thumbnailUrl}
      alt=""
      decoding="async"
      loading="lazy"
    />
  );

  return (
    <article className={styles.card}>
      <div className={styles.body}>
        <Link className={styles.main} href={editPath}>
          <span className={styles.favicon} aria-hidden="true">
            {host && (
              <img
                className={styles.faviconImage}
                src={faviconUrl(host)}
                alt=""
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
            )}
          </span>
          <span className={styles.content}>
            <span className={styles.titleRow}>
              <span className={styles.title}>{title}</span>
              <StatusChip status={post.captureStatus} />
            </span>
            {host && <span className={styles.host}>{host}</span>}
            {description && (
              <span className={styles.description}>{description}</span>
            )}
          </span>
        </Link>
        {hasActions && (
          <div className={styles.actions}>
            {href && (
              <a
                className={styles.action}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open original
              </a>
            )}
            {htmlUrl && (
              <a
                className={styles.action}
                href={htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View saved original
              </a>
            )}
            {screenshotUrl && (
              <a
                className={styles.action}
                href={screenshotUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View full capture
              </a>
            )}
          </div>
        )}
      </div>
      {thumbnailUrl && thumbnailIsCapture && screenshotUrl && (
        <a
          className={styles.thumbnailLink}
          href={screenshotUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open screenshot for ${title}`}
        >
          {thumbnailMedia}
        </a>
      )}
      {thumbnailUrl && !thumbnailIsCapture && (
        <Link
          className={styles.thumbnailLink}
          href={editPath}
          aria-label={`Open ${title}`}
        >
          {thumbnailMedia}
        </Link>
      )}
    </article>
  );
}
