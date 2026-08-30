"use client";

import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  WorkspaceItemActions,
  WorkspaceItemStar,
} from "@/components/workspace/WorkspaceItemActions";
import { TagChips } from "@/components/TagChips";
import type { Blog, Post } from "@/lib/content";
import {
  formatArticleDate,
  isVideoFile,
  postBodyPreview,
  postAccent,
  plainTextExcerpt,
} from "@/lib/content";
import { resolveCoverSource } from "@/lib/cover";
import { blogPostPath } from "@/lib/public-paths";
import { WORKSPACE_ITEM_TYPE_LABELS } from "@/lib/workspace-item-presentation";
import { postSubtitle } from "@/lib/markdown-subtitle";
import { shouldActivateVideoCover } from "@/lib/video-cover-policy";

function PlayBadge() {
  return (
    <span className="tvcard-play" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M5 3.5L12 8L5 12.5V3.5Z" fill="currentColor" />
      </svg>
    </span>
  );
}

function postTitle(post: Post): string {
  return post.title.trim() || "Untitled";
}

function postDesc(post: Post, expanded: boolean): string {
  const body = plainTextExcerpt(postBodyPreview(post), expanded ? 900 : 140);
  if (expanded && body) return body;
  return postSubtitle(post) || body;
}

function videoMimeType(src: string): string {
  return /\.webm(?:[?#].*)?$/i.test(src) ? "video/webm" : "video/mp4";
}

function cardAccentStyle(blog: Blog, post: Post): CSSProperties | undefined {
  const accent = postAccent(blog, post);
  if (accent) return { "--post-accent": accent } as CSSProperties;
  if (post.accent !== undefined) {
    return { "--post-accent": "var(--ink)" } as CSSProperties;
  }
  return undefined;
}

export function PostCard({
  blog,
  handle,
  href,
  onOpen,
  onOpenTag,
  onDeletePost,
  post,
  owner,
  categoryLabel,
  tagBasePath,
  showTypeChip = false,
  variant = "card",
}: {
  blog: Blog;
  handle: string;
  href?: string;
  onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void;
  onOpenTag?: (tag: string) => void;
  onDeletePost?: (post: Post) => Promise<void> | void;
  post: Post;
  owner: boolean;
  /** name of the subfolder this post lives in, shown as a quiet chip */
  categoryLabel?: string | null;
  /** Relative tag index on a sessionless public origin. */
  tagBasePath?: string;
  showTypeChip?: boolean;
  variant?: "card" | "expanded";
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [videoNearViewport, setVideoNearViewport] = useState(false);
  const [pageVisible, setPageVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hovered, setHovered] = useState(false);

  const title = postTitle(post);
  const expanded = variant === "expanded";
  const desc = postDesc(post, expanded);
  const coverSource = resolveCoverSource(post);
  const cover = coverSource.src;
  const isVideoCover = isVideoFile(cover);
  const isCaptureCover = coverSource.kind === "bookmark-screenshot";
  const isFaviconCover = coverSource.kind === "bookmark-favicon";
  const accent = postAccent(blog, post);
  const showPinned = Boolean(post.pinned);

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node) {
      node.muted = true;
      node.defaultMuted = true;
    }
  }, []);

  useEffect(() => {
    if (!isVideoCover) return;
    const card = ref.current;
    if (!card) return;
    if (typeof IntersectionObserver === "undefined") {
      const fallback = window.setTimeout(() => setVideoNearViewport(true), 0);
      return () => window.clearTimeout(fallback);
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVideoNearViewport(Boolean(entry?.isIntersecting)),
      { rootMargin: "500px 0px" },
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, [isVideoCover]);

  useEffect(() => {
    if (!isVideoCover) return;
    const update = () => setPageVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [isVideoCover]);

  useEffect(() => {
    if (!isVideoCover) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [isVideoCover]);

  const videoActive = shouldActivateVideoCover({
    nearViewport: videoNearViewport,
    pageVisible,
    reducedMotion,
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoReady(false);
    if (!videoActive) {
      video.pause();
      video.load();
      return;
    }
    video.load();
    void video.play().catch(() => {
      // The cover remains a still media surface if autoplay is unavailable.
    });
  }, [videoActive]);

  // Desktop hover tilt: ease the tilt toward the cursor every animation frame (a
  // lerp), with no CSS transition. This tracks tightly and stays smooth between
  // irregular pointer events.
  const NEUTRAL = { rx: 0, ry: 0, mx: 50, my: 16 };
  const tiltTarget = useRef({ ...NEUTRAL });
  const tiltCurrent = useRef({ ...NEUTRAL });
  const tiltRaf = useRef(0);

  const applyTilt = () => {
    const el = ref.current;
    if (!el) return;
    const c = tiltCurrent.current;
    el.style.setProperty("--rx", `${c.rx.toFixed(2)}deg`);
    el.style.setProperty("--ry", `${c.ry.toFixed(2)}deg`);
    el.style.setProperty("--mx", `${c.mx.toFixed(1)}%`);
    el.style.setProperty("--my", `${c.my.toFixed(1)}%`);
  };

  const tiltLoop = () => {
    const c = tiltCurrent.current;
    const t = tiltTarget.current;
    const k = 0.6;
    c.rx += (t.rx - c.rx) * k;
    c.ry += (t.ry - c.ry) * k;
    c.mx += (t.mx - c.mx) * k;
    c.my += (t.my - c.my) * k;
    applyTilt();
    if (
      Math.abs(t.rx - c.rx) < 0.04 &&
      Math.abs(t.ry - c.ry) < 0.04 &&
      Math.abs(t.mx - c.mx) < 0.2 &&
      Math.abs(t.my - c.my) < 0.2
    ) {
      tiltCurrent.current = { ...t };
      applyTilt();
      tiltRaf.current = 0;
      return;
    }
    tiltRaf.current = requestAnimationFrame(tiltLoop);
  };

  const wakeTilt = () => {
    if (!tiltRaf.current) tiltRaf.current = requestAnimationFrame(tiltLoop);
  };

  const setHoverTarget = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (clientX - r.left) / r.width;
    const py = (clientY - r.top) / r.height;
    const tiltStrength = 0.5;
    tiltTarget.current = {
      rx: (0.5 - py) * 33 * tiltStrength,
      ry: (px - 0.5) * 36 * tiltStrength,
      mx: px * 100,
      my: py * 100,
    };
  };

  useEffect(
    () => () => {
      if (tiltRaf.current) cancelAnimationFrame(tiltRaf.current);
    },
    [],
  );

  const endHover = () => {
    setHovered(false);
    tiltTarget.current = { ...NEUTRAL };
    wakeTilt();
  };

  const baseRectOf = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const translate = (cs as CSSStyleDeclaration & { translate?: string })
      .translate;
    let tx = 0;
    let ty = 0;
    if (translate && translate !== "none") {
      const parts = translate.split(" ");
      tx = parseFloat(parts[0]) || 0;
      ty = parseFloat(parts[1] ?? "0") || 0;
    }
    const cx = (rect.left + rect.right) / 2 - tx;
    const cy = (rect.top + rect.bottom) / 2 - ty;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    return {
      left: cx - w / 2,
      right: cx + w / 2,
      top: cy - h / 2,
      bottom: cy + h / 2,
    };
  };

  const HOVER_INSET = 14;
  const insideHoverRegion = (
    r: { left: number; right: number; top: number; bottom: number },
    x: number,
    y: number,
  ) =>
    x >= r.left + HOVER_INSET &&
    x <= r.right - HOVER_INSET &&
    y >= r.top + HOVER_INSET &&
    y <= r.bottom - HOVER_INSET;

  const onPointerMove = (e: PointerEvent<HTMLAnchorElement>) => {
    if (e.pointerType !== "mouse") return;
    if (document.documentElement.classList.contains("hover-frozen")) return;
    const el = ref.current;
    if (!el) return;
    const base = baseRectOf(el);
    if (!hovered) {
      if (!insideHoverRegion(base, e.clientX, e.clientY)) return;
      setHovered(true);
    } else if (!insideHoverRegion(base, e.clientX, e.clientY)) {
      endHover();
      return;
    }
    setHoverTarget(e.clientX, e.clientY);
    wakeTilt();
  };

  const onPointerLeave = (e: PointerEvent<HTMLAnchorElement>) => {
    if (e.pointerType !== "mouse") return;
    endHover();
  };

  const className = [
    "tvcard",
    `tvcard--${post.type}`,
    expanded ? "tvcard--expanded" : "",
    cover ? "" : "tvcard--no-cover",
    hovered ? "is-hover" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={`tvcard-shell${expanded ? " tvcard-shell--expanded" : ""}`}
    >
      <WorkspaceItemStar handle={handle} owner={owner} post={post} />
      <Link
        ref={ref}
        href={href ?? blogPostPath(blog, post)}
        prefetch={true}
        className={className}
        style={cardAccentStyle(blog, post)}
        onClick={onOpen}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        aria-label={title}
      >
        <span className="tvcard-inner">
          <span className="tvcard-tilt">
            {cover && (
              <span
                className={`tvcard-media${
                  isCaptureCover ? " is-capture-cover" : ""
                }${isFaviconCover ? " is-favicon-cover" : ""}`}
              >
                {isVideoCover ? (
                  <video
                    ref={attachVideo}
                    className="tvcard-cover"
                    data-ready={videoReady ? "true" : undefined}
                    autoPlay={videoActive}
                    muted
                    loop
                    playsInline
                    preload={videoActive ? "metadata" : "none"}
                    aria-hidden="true"
                    onCanPlay={() => setVideoReady(true)}
                  >
                    {videoActive && (
                      <source src={cover} type={videoMimeType(cover)} />
                    )}
                  </video>
                ) : (
                  // User media can be remote, so plain img avoids next/image config.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="tvcard-cover"
                    src={cover}
                    alt={title}
                    decoding="async"
                    loading="lazy"
                  />
                )}
                {post.type === "video_post" && <PlayBadge />}
                <span className="tvcard-sheen" aria-hidden="true" />
              </span>
            )}
            <span className="tvcard-body">
              {(categoryLabel || showPinned) && (
                <span className="tvcard-chip-row">
                  {categoryLabel && (
                    <span className="tvcard-category">{categoryLabel}</span>
                  )}
                  {showPinned && <span className="tvcard-pinned">Pinned</span>}
                </span>
              )}
              <span className="tvcard-title">{title}</span>
              <span className="tvcard-detail">
                {showTypeChip && (
                  <span
                    className="tvcard-chip"
                    style={{ background: accent ?? "var(--ink)" }}
                  >
                    {WORKSPACE_ITEM_TYPE_LABELS[post.type]}
                  </span>
                )}
                <span className="tvcard-desc">{desc}</span>
              </span>
              {expanded && (
                <time
                  className="tvcard-date"
                  dateTime={post.updatedAt ?? post.date}
                >
                  {formatArticleDate(post.updatedAt ?? post.date, {
                    style: "short",
                  })}
                </time>
              )}
            </span>
          </span>
        </span>
      </Link>
      <TagChips
        blog={blog}
        className="tvcard-tags"
        hrefForTag={
          tagBasePath
            ? (tag) => `${tagBasePath}/${encodeURIComponent(tag)}`
            : undefined
        }
        onOpenTag={onOpenTag}
        tags={post.tags}
      />
      <WorkspaceItemActions
        blog={blog}
        className="is-card"
        handle={handle}
        href={href}
        onDeletePost={onDeletePost}
        owner={owner}
        post={post}
      />
    </div>
  );
}
