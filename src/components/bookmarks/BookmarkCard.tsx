"use client";

import {
  type MouseEvent,
  type SyntheticEvent,
  useEffect,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  WorkspaceItemActions,
  WorkspaceItemStar,
} from "@/components/workspace/WorkspaceItemActions";
import type { WorkspaceViewMode } from "@/components/workspace/WorkspaceViewModeControl";
import { TagChips } from "@/components/TagChips";
import type { Post } from "@/lib/content";
import { isSafeLinkHref, isVideoFile, postBodyPreview } from "@/lib/content";
import { bookmarkFaviconUrl, resolveCoverSource } from "@/lib/cover";
import { useCaptureStatus } from "./useCaptureStatus";
import { workspaceMouseMoved } from "@/lib/workspace-hover";
import { postSubtitle } from "@/lib/markdown-subtitle";
import { shouldSuppressNativeItemSelection } from "@/lib/workspace-selection";
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

function expandedPreview(value: string | undefined): string {
  const text = (value ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^[\s#*>`-]+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 900) return text;
  const sliced = text.slice(0, 897).trimEnd();
  const wordBreak = sliced.lastIndexOf(" ");
  return `${wordBreak > 600 ? sliced.slice(0, wordBreak) : sliced}...`;
}

function thumbnailInitial(host: string, title: string): string {
  const match = `${host} ${title}`.match(/[a-z0-9]/i);
  return match ? match[0].toUpperCase() : "W";
}

function ThumbnailFallback({ host, title }: { host: string; title: string }) {
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
  onOpenTag,
  onItemClick,
  onSelect,
  onCaptureResolved,
  onDeletePost,
  optionId,
  optionTabIndex,
  owner = false,
  selected = false,
  handle,
  viewMode = "list",
}: {
  post: Post;
  editPath: string;
  onOpenPost?: (post: Post) => void;
  onOpenTag?: (tag: string) => void;
  onItemClick?: (event: MouseEvent<HTMLElement>) => boolean;
  onSelect?: () => void;
  onCaptureResolved?: (post: Post) => void;
  onDeletePost?: (post: Post) => Promise<void> | void;
  optionId?: string;
  optionTabIndex?: number;
  owner?: boolean;
  selected?: boolean;
  handle?: string;
  viewMode?: WorkspaceViewMode;
}) {
  const router = useRouter();
  const captureStatus = useCaptureStatus(post.id, post.captureStatus, {
    onResolved: (status, snapshot) => {
      const resolvedPost: Post = {
        ...post,
        captureStatus: status,
        capture: snapshot.capture ?? post.capture,
        cover: snapshot.cover ?? post.cover,
        updatedAt: snapshot.updatedAt ?? post.updatedAt,
        wordCount: snapshot.wordCount ?? post.wordCount,
      };
      if (onCaptureResolved) onCaptureResolved(resolvedPost);
      else router.refresh();
    },
  });
  const title = itemTitle(post);
  const host = bookmarkHost(post);
  const faviconSrc = bookmarkFaviconUrl(post);
  const description =
    viewMode === "column"
      ? expandedPreview(postBodyPreview(post)) ||
        expandedPreview(postSubtitle(post)) ||
        expandedPreview(post.capture?.description)
      : previewLine(postSubtitle(post)) ||
        previewLine(post.capture?.description) ||
        previewLine(postBodyPreview(post));
  const isFailed = captureStatus === "failed";
  const thumbnailSource = resolveCoverSource(post);
  const thumbnailUrl = thumbnailSource.src;
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setThumbnailFailed(false);
    });
    return () => window.cancelAnimationFrame(frame);
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
    <span className={styles.content}>
      <span className={styles.titleRow}>
        <span className={styles.title}>{title}</span>
        <StatusChip status={captureStatus} />
      </span>
      {host && (
        <span className={styles.metaRow}>
          <span className={styles.favicon} aria-hidden="true">
            {faviconSrc && (
              // Bookmark favicons can come from any source host, so they
              // intentionally bypass Next's configured image allowlist.
              // eslint-disable-next-line @next/next/no-img-element
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
          <span className={styles.host}>{host}</span>
        </span>
      )}
      {description && <span className={styles.description}>{description}</span>}
    </span>
  );
  const openItem = (event: MouseEvent<HTMLAnchorElement>) => {
    if (onItemClick && !onItemClick(event)) {
      event.preventDefault();
      return;
    }
    if (!onOpenPost || !shouldOpenLocally(event)) return;
    event.preventDefault();
    onOpenPost(post);
  };

  return (
    <article
      id={optionId}
      className={classNames(
        "bookmark-folder-card",
        styles.card,
        viewMode === "grid" && !thumbnailUrl && styles.noThumbnail,
        selected && styles.selected,
      )}
      role={optionId ? "option" : undefined}
      aria-selected={optionId ? selected : undefined}
      tabIndex={optionTabIndex}
      data-workspace-post-id={post.id}
      onFocus={onSelect}
      onMouseMove={(event) => {
        if (
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          workspaceMouseMoved(event.clientX, event.clientY)
        ) {
          onSelect?.();
        }
      }}
    >
      <WorkspaceItemStar
        handle={handle ?? ""}
        owner={owner && Boolean(handle)}
        post={post}
      />
      <div className={styles.body}>
        <Link
          className={styles.main}
          href={editPath}
          prefetch={onOpenPost ? false : undefined}
          onMouseDown={(event) => {
            if (shouldSuppressNativeItemSelection(event)) {
              event.preventDefault();
            }
          }}
          onClick={openItem}
        >
          {mainContent}
        </Link>
        <TagChips onOpenTag={onOpenTag} tags={post.tags} />
      </div>
      {isFailed && (
        <div
          className={classNames(
            styles.thumbnailLink,
            styles.failedThumbnailTile,
          )}
          aria-hidden="true"
        >
          {thumbnailFallback}
        </div>
      )}
      {!isFailed && thumbnailUrl && thumbnailIsCapture && (
        <Link
          className={thumbnailLinkClass}
          href={editPath}
          prefetch={onOpenPost ? false : undefined}
          onClick={openItem}
          aria-label={`Open ${title}`}
        >
          {thumbnailMedia}
        </Link>
      )}
      {!isFailed && thumbnailUrl && !thumbnailIsCapture && (
        <Link
          className={thumbnailLinkClass}
          href={editPath}
          prefetch={onOpenPost ? false : undefined}
          onClick={openItem}
          aria-label={`Open ${title}`}
        >
          {thumbnailMedia}
        </Link>
      )}
      {!isFailed && !thumbnailUrl && viewMode !== "grid" && (
        <Link
          className={thumbnailLinkClass}
          href={editPath}
          prefetch={onOpenPost ? false : undefined}
          onClick={openItem}
          aria-label={`Open ${title}`}
        >
          {thumbnailFallback}
        </Link>
      )}
      <WorkspaceItemActions
        className="is-bookmark"
        handle={handle ?? ""}
        href={editPath}
        onDeletePost={onDeletePost}
        owner={owner && Boolean(handle)}
        post={post}
      />
    </article>
  );
}
