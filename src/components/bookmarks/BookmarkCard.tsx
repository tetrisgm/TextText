"use client";

import {
  type MouseEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  deleteEditablePostAction,
  setEditablePostCreatedAtAction,
  toggleEditablePostPinnedAction,
} from "@/app/editor/actions";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import type { Post } from "@/lib/content";
import { isSafeLinkHref, isVideoFile, postBodyPreview } from "@/lib/content";
import {
  bookmarkFaviconUrl,
  resolveCoverSource,
} from "@/lib/cover";
import { useCaptureStatus } from "./useCaptureStatus";
import { updatePost } from "@/lib/pool/store";
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
  onSelect,
  onCaptureResolved,
  onDeletePost,
  optionId,
  optionTabIndex,
  owner = false,
  selected = false,
  handle,
}: {
  post: Post;
  editPath: string;
  onOpenPost?: (post: Post) => void;
  onSelect?: () => void;
  onCaptureResolved?: (post: Post) => void;
  onDeletePost?: (post: Post) => Promise<void> | void;
  optionId?: string;
  optionTabIndex?: number;
  owner?: boolean;
  selected?: boolean;
  handle?: string;
}) {
  const router = useRouter();
  const captureStatus = useCaptureStatus(post.id, post.captureStatus, {
    onResolved: () => {
      if (onCaptureResolved) onCaptureResolved(post);
      else router.refresh();
    },
  });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();
  const title = itemTitle(post);
  const host = bookmarkHost(post);
  const faviconSrc = bookmarkFaviconUrl(post);
  const description =
    previewLine(post.excerpt) ||
    previewLine(post.capture?.description) ||
    previewLine(postBodyPreview(post));
  const isFailed = captureStatus === "failed";
  const canDelete = owner && Boolean(post.id) && Boolean(onDeletePost || handle);
  const thumbnailSource = resolveCoverSource(post);
  const thumbnailUrl = thumbnailSource.src;
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setThumbnailFailed(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [thumbnailUrl]);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      ) {
        return;
      }
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);
  useEscapeLayer(menuOpen, "Bookmark options", () => setMenuOpen(false));
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
  const stopMenuNavigation = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const toggleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    stopMenuNavigation(event);
    setMenuError(null);
    setMenuOpen((open) => !open);
  };
  const confirmDelete = useCallback(() => {
    if (!post.id || deleting) return;
    setDeleting(true);
    startTransition(() => {
      const request = onDeletePost
        ? Promise.resolve(onDeletePost(post))
        : handle
          ? deleteEditablePostAction(handle, post.id).then(() => {
              router.refresh();
            })
          : Promise.reject(new Error("You cannot edit this blog"));
      void request
        .then(() => {
          setDeleteDialogOpen(false);
          setMenuOpen(false);
        })
        .catch((error) => {
          setMenuOpen(true);
          setMenuError(
            error instanceof Error && error.message
              ? error.message
              : "Could not delete",
          );
        })
        .finally(() => setDeleting(false));
    });
  }, [deleting, handle, onDeletePost, post, router]);
  const toggleStar = useCallback(() => {
    if (!post.id || !handle || pinning) return;
    const previous = Boolean(post.pinned);
    setPinning(true);
    setMenuError(null);
    updatePost(post.id, { pinned: !previous });
    void toggleEditablePostPinnedAction(handle, post.id)
      .then(() => setMenuOpen(false))
      .catch((error) => {
        updatePost(post.id!, { pinned: previous });
        setMenuError(
          error instanceof Error ? error.message : "Could not update star",
        );
      })
      .finally(() => setPinning(false));
  }, [handle, pinning, post.id, post.pinned]);
  const shareBookmark = useCallback(() => {
    const url = new URL(editPath, window.location.origin).toString();
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }, [editPath]);
  const changeCreatedDate = useCallback(
    (value: string) => {
      if (!post.id || !handle || !value || pinning) return;
      const previous = post.createdAt;
      setPinning(true);
      updatePost(post.id, { createdAt: `${value}T12:00:00.000Z` });
      void setEditablePostCreatedAtAction(handle, post.id, value)
        .then((saved) => {
          updatePost(post.id!, { createdAt: saved.createdAt });
          setMenuOpen(false);
        })
        .catch((error) => {
          updatePost(post.id!, { createdAt: previous });
          setMenuError(
            error instanceof Error ? error.message : "Could not change date",
          );
        })
        .finally(() => setPinning(false));
    },
    [handle, pinning, post.createdAt, post.id],
  );
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
        {description && (
          <span className={styles.description}>{description}</span>
        )}
      </span>
  );

  return (
    <article
      id={optionId}
      className={classNames("bookmark-folder-card", styles.card, selected && styles.selected)}
      role={optionId ? "option" : undefined}
      aria-selected={optionId ? selected : undefined}
      tabIndex={optionTabIndex}
      data-workspace-post-id={post.id}
      onFocus={onSelect}
      onMouseEnter={onSelect}
    >
      <div className={styles.body}>
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
        {canDelete && (
          <div
            ref={menuRef}
            className={classNames(styles.menuWrap, menuOpen && styles.menuOpen)}
            onClick={stopMenuNavigation}
          >
            <button
              type="button"
              className={styles.menuButton}
              aria-label="Bookmark options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={toggleMenu}
            >
              ...
            </button>
            {menuOpen && (
              <div
                className={styles.menu}
                role="menu"
                aria-label="Bookmark options"
              >
                <button
                  type="button"
                  className={styles.menuItem}
                  role="menuitem"
                  disabled={pinning}
                  onClick={(event) => {
                    stopMenuNavigation(event);
                    toggleStar();
                  }}
                >
                  {pinning ? "Updating" : post.pinned ? "Unstar" : "Star"}
                </button>
                <button
                  type="button"
                  className={styles.menuItem}
                  role="menuitem"
                  onClick={(event) => {
                    stopMenuNavigation(event);
                    shareBookmark();
                  }}
                >
                  {copied ? "Link copied" : "Share"}
                </button>
                <label className={styles.menuDate}>
                  <span>Created</span>
                  <input
                    type="date"
                    value={(post.createdAt ?? post.date ?? "").slice(0, 10)}
                    disabled={pinning}
                    onChange={(event) =>
                      changeCreatedDate(event.currentTarget.value)
                    }
                  />
                </label>
                <button
                  type="button"
                  className={classNames(styles.menuItem, styles.dangerItem)}
                  role="menuitem"
                  disabled={deleting}
                  onClick={(event) => {
                    stopMenuNavigation(event);
                    setMenuOpen(false);
                    setDeleteDialogOpen(true);
                  }}
                >
                  {deleting ? "Deleting" : "Delete"}
                </button>
                {menuError && (
                  <span className={styles.menuError} role="alert">
                    {menuError}
                  </span>
                )}
              </div>
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
      {!isFailed && thumbnailUrl && thumbnailIsCapture && (
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
      )}
      {!isFailed && thumbnailUrl && !thumbnailIsCapture && (
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
      )}
      {!isFailed && !thumbnailUrl && (
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
          {thumbnailFallback}
        </Link>
      )}
      <ConfirmationDialog
        open={deleteDialogOpen}
        title="Delete bookmark?"
        message="This moves the Markdown file to Trash. You can restore it later."
        confirmLabel="Delete"
        confirmingLabel="Deleting"
        confirming={deleting}
        onCancel={() => setDeleteDialogOpen(false)}
        onConfirm={confirmDelete}
      />
    </article>
  );
}
