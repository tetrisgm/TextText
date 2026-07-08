"use client";

import {
  type MouseEvent,
  type SyntheticEvent,
  useEffect,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Post } from "@/lib/content";
import { isSafeLinkHref, isVideoFile, postBodyPreview } from "@/lib/content";
import {
  bookmarkFaviconUrl,
  resolveCoverSource,
} from "@/lib/cover";
import { useCaptureStatus } from "./useCaptureStatus";
import styles from "./BookmarkCard.module.css";

function classNames(...names: Array<string | false | undefined>): string {
  return names.filter(Boolean).join(" ");
}

function itemTitle(post: Post): string {
  return (post.capture?.title ?? post.title).trim() || "Untitled";
}

function originalHref(post: Post): string | undefined {
  const captureUrl = safeHref(post.capture?.url);
  if (captureUrl) return captureUrl;
  return safeHref(post.links?.[0]?.href);
}

function safeHref(value: string | undefined): string | undefined {
  const href = value?.trim() ?? "";
  return href && isSafeLinkHref(href) ? href : undefined;
}

function shouldOpenLocally(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
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

function thumbnailInitial(host: string, title: string): string {
  const match = `${host} ${title}`.match(/[a-z0-9]/i);
  return match ? match[0].toUpperCase() : "W";
}

function ThumbnailFallback({
  host,
  title,
}: {
  host: string;
  title: string;
}) {
  const label = host || title;
  return (
    <span className={styles.thumbnailFallback} aria-hidden="true">
      <span className={styles.thumbnailInitial}>
        {thumbnailInitial(host, title)}
      </span>
      {label && <span className={styles.thumbnailHost}>{label}</span>}
    </span>
  );
}

function StatusChip({ status }: { status: Post["captureStatus"] }) {
  if (status === "pending") {
    return (
      <span
        className={classNames(styles.status, styles.pending)}
        role="status"
        aria-live="polite"
      >
        <span className={styles.spinner} aria-hidden="true" />
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
  onOpenPost,
  optionId,
  optionTabIndex,
  selected = false,
}: {
  post: Post;
  editPath: string;
  onOpenPost?: (post: Post) => void;
  optionId?: string;
  optionTabIndex?: number;
  selected?: boolean;
}) {
  const router = useRouter();
  const captureStatus = useCaptureStatus(post.id, post.captureStatus, {
    onResolved: () => {
      router.refresh();
    },
  });
  const title = itemTitle(post);
  const href = originalHref(post);
  const host = bookmarkHost(post);
  const faviconSrc = bookmarkFaviconUrl(post);
  const description =
    previewLine(post.excerpt) ||
    previewLine(post.capture?.description) ||
    previewLine(postBodyPreview(post));
  const screenshotUrl = post.capture?.screenshotUrl?.trim();
  const htmlUrl = post.capture?.htmlUrl?.trim();
  const isPending = captureStatus === "pending";
  const isFailed = captureStatus === "failed";
  const hasActions = !isPending && Boolean(href || htmlUrl || screenshotUrl);
  const thumbnailSource = resolveCoverSource(post);
  const thumbnailUrl = thumbnailSource.src;
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  useEffect(() => {
    setThumbnailFailed(false);
  }, [thumbnailUrl]);
  const thumbnailIsCapture = thumbnailSource.kind === "bookmark-screenshot";
  const thumbnailIsFavicon = thumbnailSource.kind === "bookmark-favicon";
  const thumbnailLinkClass = classNames(
    styles.thumbnailLink,
    thumbnailIsFavicon && styles.faviconThumbnailLink,
  );
  const thumbnailFallback = <ThumbnailFallback host={host} title={title} />;
  const handleThumbnailError = (
    event: SyntheticEvent<HTMLImageElement | HTMLVideoElement>,
  ) => {
    event.currentTarget.hidden = true;
    setThumbnailFailed(true);
  };
  const thumbnailMedia = thumbnailFailed ? (
    thumbnailFallback
  ) : isVideoFile(thumbnailUrl) ? (
    <video
      key={thumbnailUrl}
      className={styles.thumbnail}
      src={thumbnailUrl}
      muted
      playsInline
      preload="metadata"
      onError={handleThumbnailError}
    />
  ) : (
    // User media can be remote, so plain img avoids next/image config.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={thumbnailUrl}
      className={classNames(
        styles.thumbnail,
        thumbnailIsCapture && styles.captureThumbnail,
        thumbnailIsFavicon && styles.faviconThumbnail,
      )}
      src={thumbnailUrl}
      alt=""
      decoding="async"
      loading="lazy"
      onError={handleThumbnailError}
    />
  );
  const mainContent = (
    <>
      <span className={styles.favicon} aria-hidden="true">
        {faviconSrc && (
          <img
            className={styles.faviconImage}
            src={faviconSrc}
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
          <StatusChip status={captureStatus} />
        </span>
        {host && <span className={styles.host}>{host}</span>}
        {description && (
          <span className={styles.description}>{description}</span>
        )}
      </span>
    </>
  );

  return (
    <article
      id={optionId}
      className={classNames(styles.card, selected && styles.selected)}
      role={optionId ? "option" : undefined}
      aria-selected={optionId ? selected : undefined}
      tabIndex={optionTabIndex}
      data-workspace-post-id={post.id}
    >
      <div className={styles.body}>
        {isPending ? (
          <div
            className={classNames(styles.main, styles.mainDisabled)}
            aria-disabled="true"
          >
            {mainContent}
          </div>
        ) : (
          <Link
            className={styles.main}
            href={editPath}
            prefetch={onOpenPost ? false : undefined}
            onClick={(event) => {
              if (!onOpenPost || !shouldOpenLocally(event)) return;
              event.preventDefault();
              onOpenPost(post);
            }}
          >
            {mainContent}
          </Link>
        )}
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
      {isFailed && (
        <div
          className={classNames(styles.thumbnailLink, styles.failedThumbnailTile)}
          aria-hidden="true"
        >
          {thumbnailFallback}
        </div>
      )}
      {!isFailed && thumbnailUrl && thumbnailIsCapture && screenshotUrl && (
        isPending ? (
          <div
            className={classNames(thumbnailLinkClass, styles.thumbnailDisabled)}
            aria-hidden="true"
          >
            {thumbnailMedia}
          </div>
        ) : (
          <a
            className={thumbnailLinkClass}
            href={screenshotUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open screenshot for ${title}`}
          >
            {thumbnailMedia}
          </a>
        )
      )}
      {!isFailed && thumbnailUrl && !thumbnailIsCapture && (
        isPending ? (
          <div
            className={classNames(thumbnailLinkClass, styles.thumbnailDisabled)}
            aria-hidden="true"
          >
            {thumbnailMedia}
          </div>
        ) : (
          <Link
            className={thumbnailLinkClass}
            href={editPath}
            prefetch={onOpenPost ? false : undefined}
            onClick={(event) => {
              if (!onOpenPost || !shouldOpenLocally(event)) return;
              event.preventDefault();
              onOpenPost(post);
            }}
            aria-label={`Open ${title}`}
          >
            {thumbnailMedia}
          </Link>
        )
      )}
    </article>
  );
}
