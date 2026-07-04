"use client";

import type { CSSProperties, MouseEvent, PointerEvent } from "react";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  deleteEditablePostAction,
  toggleEditablePostPinnedAction,
} from "@/app/editor/actions";
import type { Blog, Post, PostType } from "@/lib/content";
import {
  formatArticleDate,
  isVideoFile,
  postAccent,
  readingTimeMin,
} from "@/lib/content";
import { resolveCover } from "@/lib/cover";

const TYPE_LABELS: Record<PostType, string> = {
  article: "ARTICLE",
  project: "PROJECT",
  talk: "TALK",
};

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

function postThumbnail(post: Post): string {
  return resolveCover(post);
}

function postMeta(post: Post): string {
  return [formatArticleDate(post.date), `${readingTimeMin(post.body)} min read`]
    .filter(Boolean)
    .join(" / ");
}

function oneLine(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const sliced = value.slice(0, maxLength - 3).trimEnd();
  const wordBreak = sliced.lastIndexOf(" ");
  const base = wordBreak > 70 ? sliced.slice(0, wordBreak) : sliced;
  return `${base}...`;
}

function plainTextExcerpt(markdown: string | undefined): string {
  if (!markdown) return "";
  return truncate(oneLine(stripMarkdown(markdown)), 140);
}

function postDesc(post: Post): string {
  return post.excerpt?.trim() || plainTextExcerpt(post.body) || postMeta(post);
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
  post,
  owner,
}: {
  blog: Blog;
  handle: string;
  post: Post;
  owner: boolean;
}) {
  const router = useRouter();
  const ref = useRef<HTMLAnchorElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pinning, setPinning] = useState(false);

  const title = postTitle(post);
  const desc = postDesc(post);
  const cover = postThumbnail(post);
  const isMinimal = blog.cardStyle === "minimal";
  const isVideoCover = !isMinimal && isVideoFile(cover);
  const accent = postAccent(blog, post);
  const date = formatArticleDate(post.date);
  const showUnlisted = owner && post.status === "draft";
  const showPinned = Boolean(post.pinned);

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    if (node) {
      node.muted = true;
      node.defaultMuted = true;
    }
  }, []);

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
    tiltTarget.current = {
      rx: (0.5 - py) * 33,
      ry: (px - 0.5) * 36,
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

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: globalThis.PointerEvent) => {
      const menu = menuRef.current;
      if (!menu || !(event.target instanceof Node)) return;
      if (!menu.contains(event.target)) setMenuOpen(false);
    };

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menuOpen]);

  const endHover = () => {
    setHovered(false);
    tiltTarget.current = { ...NEUTRAL };
    wakeTilt();
  };

  const baseRectOf = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const translate = (cs as CSSStyleDeclaration & { translate?: string }).translate;
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

  const stopMenuNavigation = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const toggleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    stopMenuNavigation(event);
    setMenuOpen((open) => !open);
  };

  const onDelete = (event: MouseEvent<HTMLButtonElement>) => {
    stopMenuNavigation(event);
    const postId = post.id;
    if (!owner || !postId || deleting) return;
    if (!window.confirm("Delete this post?")) return;

    setDeleting(true);
    startTransition(() => {
      void deleteEditablePostAction(handle, postId)
        .then(() => {
          setMenuOpen(false);
          router.refresh();
        })
        .catch((error) => {
          setDeleting(false);
          window.alert(
            error instanceof Error && error.message
              ? error.message
              : "Could not delete",
          );
        });
    });
  };

  const onTogglePinned = (event: MouseEvent<HTMLButtonElement>) => {
    stopMenuNavigation(event);
    const postId = post.id;
    if (!owner || !postId || pinning) return;

    setPinning(true);
    startTransition(() => {
      void toggleEditablePostPinnedAction(handle, postId)
        .then(() => {
          setMenuOpen(false);
          setPinning(false);
          router.refresh();
        })
        .catch((error) => {
          setPinning(false);
          window.alert(
            error instanceof Error && error.message
              ? error.message
              : "Could not update pin",
          );
        });
    });
  };

  const className = [
    "tvcard",
    `tvcard--${post.type}`,
    `tvcard--style-${blog.cardStyle}`,
    cover ? "" : "tvcard--no-cover",
    hovered ? "is-hover" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={`tvcard-shell${
        isMinimal ? " tvcard-shell--minimal" : ""
      }`}
    >
      <Link
        ref={ref}
        href={`/t/${handle}/${post.slug}`}
        prefetch={true}
        className={className}
        style={cardAccentStyle(blog, post)}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        aria-label={title}
      >
        <span className="tvcard-inner">
          <span className="tvcard-tilt">
            {!isMinimal && (
              <span className="tvcard-media">
                {isVideoCover ? (
                  <video
                    ref={attachVideo}
                    className="tvcard-cover"
                    data-ready={videoReady ? "true" : undefined}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                    aria-hidden="true"
                    onCanPlay={() => setVideoReady(true)}
                  >
                    <source src={cover} type={videoMimeType(cover)} />
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
                {post.type === "talk" && <PlayBadge />}
                <span className="tvcard-sheen" aria-hidden="true" />
              </span>
            )}
            <span className="tvcard-body">
              <span className="tvcard-chip-row">
                <span
                  className="tvcard-chip"
                  style={{ background: accent ?? "var(--ink)" }}
                >
                  {TYPE_LABELS[post.type]}
                </span>
                {showPinned && <span className="tvcard-pinned">Pinned</span>}
                {showUnlisted && (
                  <span className="tvcard-unlisted">Unlisted</span>
                )}
              </span>
              <span className="tvcard-title">{title}</span>
              <span className="tvcard-desc">{desc}</span>
              {isMinimal && date && (
                <span className="tvcard-date">{date}</span>
              )}
            </span>
          </span>
        </span>
      </Link>
      {owner && (
        <div
          ref={menuRef}
          className={`tvcard-menu-wrap${menuOpen ? " is-open" : ""}`}
          onClick={stopMenuNavigation}
        >
          <button
            type="button"
            className="tvcard-menu-button"
            aria-label="Post options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={toggleMenu}
          >
            ...
          </button>
          {menuOpen && (
            <div className="tvcard-menu" role="menu" aria-label="Post options">
              <button
                type="button"
                className="tvcard-menu-item"
                role="menuitem"
                disabled={!post.id || pinning}
                onClick={onTogglePinned}
              >
                {pinning ? "Updating" : post.pinned ? "Unpin" : "Pin"}
              </button>
              <button
                type="button"
                className="tvcard-menu-item is-danger"
                role="menuitem"
                disabled={!post.id || deleting}
                onClick={onDelete}
              >
                {deleting ? "Deleting" : "Delete"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
