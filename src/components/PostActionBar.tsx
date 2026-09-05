"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  recaptureBookmarkAction,
  saveEditablePostAction,
} from "@/app/editor/actions";
import { CLOSE_EDIT_MENU_EVENT } from "@/components/PostShortcuts";
import { useCaptureStatus } from "@/components/bookmarks/useCaptureStatus";
import type { CaptureStatusResponse } from "@/components/bookmarks/useCaptureStatus";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import { ShortcutTooltip } from "@/components/keyboard/ShortcutTooltip";
import { shortcutLabelForCommand } from "@/lib/commands/workspace";
import { ShareDialog } from "@/components/workspace/ShareDialog";
import { WorkspaceActionSearch } from "@/components/workspace/WorkspaceActionSearch";
import { WorkspaceSearchButton } from "@/components/workspace/WorkspaceSearchButton";
import type { Blog, Folder, Post, ItemKind } from "@/lib/content";
import type { PresencePeer } from "@/lib/collab/provider";
import { CollaboratorMark } from "@/components/collab/CollaboratorMark";
import {
  initialDraft,
  payloadFor,
  postPath as postPathFor,
  slugify,
} from "@/lib/post-edit-draft";
import type { DraftState, SaveState } from "@/lib/post-edit-draft";
import type { AdjacentPublishedPosts } from "@/lib/store";

type AdjacentPosts = AdjacentPublishedPosts;

type CommonProps = {
  blog: Blog;
  post: Post;
  adjacent: AdjacentPosts;
  homePath: string;
  postPath: string;
  publishedUrl?: string;
  previousPath?: string;
  nextPath?: string;
  owner: boolean;
  canEditPost?: boolean;
  canManagePost?: boolean;
  canCommentPost?: boolean;
  onBookmarkCaptureChange?: (post: Post) => void;
  onNavigate?: (path: string) => Promise<void> | void;
  onSearch?: () => void;
  searchFocusRequestKey?: number;
  searchValue?: string;
  onSearchValueChange?: (value: string) => void;
  presencePeers?: PresencePeer[];
};

type ReadProps = CommonProps & {
  bookmarkContentMode?: BookmarkContentMode;
  mode: "read";
  onBookmarkContentModeChange?: (mode: BookmarkContentMode) => void;
};

type EditProps = CommonProps & {
  mode: "edit";
  draft: DraftState;
  deleting: boolean;
  hasHeaderImage: boolean;
  folders?: Folder[];
  onDelete: () => void;
  onDone: () => Promise<void>;
  onAddHeaderImage: () => void;
  onMoveToFolder?: (folderPath: string) => void;
  onNavigate: (path: string) => Promise<void>;
  onSlugBlur: () => void;
  onSlugInput: (value: string) => void;
  onUpdateDraft: (patch: Partial<DraftState>) => void;
  onVisibilityChange: (status: Post["status"]) => Promise<void>;
};

type Props = ReadProps | EditProps;
export type BookmarkContentMode = "readable" | "capture";

function WorkspaceActionBarPortal({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const findSlot = () => {
      const nextSlot = document.querySelector<HTMLElement>(
        ".post-editor-content > .workspace-action-bar-host .workspace-action-bar-slot.is-right",
      );
      if (!nextSlot) return false;
      setSlot(nextSlot);
      return true;
    };

    if (findSlot()) return;
    const observer = new MutationObserver(() => {
      if (findSlot()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return slot ? createPortal(children, slot) : children;
}

type ReadState = {
  sourceVersion: string;
  dirty: boolean;
  draft: DraftState;
  saveState: SaveState;
  error: string | null;
};

function postSourceVersion(post: Post): string {
  return `${post.id ?? ""}:${post.slug}:${post.updatedAt ?? ""}`;
}

const POST_TYPE_OPTIONS: Array<{
  type: ItemKind;
  label: string;
}> = [
  { type: "article", label: "Article" },
  { type: "media_post", label: "Media post" },
  { type: "video_post", label: "Video post" },
];

// Notes and bookmarks never change type and never publish; the action bar
// must not offer either control (the server refuses both anyway).
function isUnlistedPostType(type: ItemKind): boolean {
  return type === "note" || type === "bookmark";
}

function subscribeClientSnapshot() {
  return () => {};
}

function getBrowserOrigin() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

function getServerOrigin() {
  return "";
}

function postTitle(title: string): string {
  return title.trim() || "Untitled";
}

function postEditPath(postPath: string, postId?: string): string {
  const params = new URLSearchParams({ edit: "1" });
  if (postId) params.set("id", postId);
  return `${postPath}?${params.toString()}`;
}

const warmedEditPaths = new Set<string>();

function safePostUrl(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return "";
  }
  return "";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function presencePersonKey(peer: PresencePeer): string {
  return [
    peer.participantType ?? "person",
    peer.provider ?? "",
    peer.userName.trim().toLocaleLowerCase() || peer.clientId,
  ].join(":");
}

function uniquePresencePeers(peers: PresencePeer[]): PresencePeer[] {
  const people = new Map<string, PresencePeer>();
  for (const peer of peers) {
    const key = presencePersonKey(peer);
    if (!people.has(key)) {
      people.set(key, {
        ...peer,
        userName: peer.userName.trim() || "Someone",
      });
    }
  }
  return Array.from(people.values()).sort((a, b) =>
    a.userName.localeCompare(b.userName),
  );
}

function PresenceStack({ peers }: { peers: PresencePeer[] }) {
  const people = uniquePresencePeers(peers);
  if (people.length === 0) return null;

  const visible = people.slice(0, 5);
  const overflow = people.slice(5);
  const names = people.map((peer) => peer.userName).join(", ");
  const label = `Collaborators active: ${names}`;

  return (
    <div className="post-presence-stack" aria-label={label} title={names}>
      {visible.map((peer) => (
        peer.participantType === "agent" ? (
          <span
            key={presencePersonKey(peer)}
            className="post-presence-agent"
            title={`${peer.userName} is collaborating`}
            aria-label={`${peer.userName} is collaborating`}
          >
            <span
              className="post-presence-avatar is-agent"
              style={{ backgroundColor: peer.color }}
            >
              <CollaboratorMark provider={peer.provider} name={peer.userName} />
            </span>
            <span className="post-presence-agent-name">{peer.userName}</span>
          </span>
        ) : (
          <span
            key={presencePersonKey(peer)}
            className="post-presence-avatar"
            style={{ backgroundColor: peer.color }}
            title={peer.userName}
            aria-label={peer.userName}
          >
            {initials(peer.userName)}
          </span>
        )
      ))}
      {overflow.length > 0 && (
        <span
          className="post-presence-avatar post-presence-overflow"
          title={overflow.map((peer) => peer.userName).join(", ")}
          aria-label={`${overflow.length} more collaborators active`}
        >
          +{overflow.length}
        </span>
      )}
    </div>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10.25 3.25 5.5 8l4.75 4.75M6 8h7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

/* Up and down, not left and right.

   Previous and next ITEM is a move through a list, and a list runs down the
   page; left and right is what history does. The reference draws this pair
   as chevrons pointing up and down in exactly this position, and reading it
   that way is what finally separated the two ideas in our own chrome. */
function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={dir === "left" ? "M3 10L8 5L13 10" : "M3 6L8 11L13 6"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function EllipsisIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="12" cy="8" r="1.25" fill="currentColor" />
    </svg>
  );
}

function MenuCheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4 8.15 2.35 2.35L12 5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 10V2.5M5.25 5.25L8 2.5l2.75 2.75M4.25 7.25H3.5A1.5 1.5 0 0 0 2 8.75v3.75A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V8.75a1.5 1.5 0 0 0-1.5-1.5h-.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function RecaptureIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M12.6 5.1A5.2 5.2 0 1 0 13 9M12.6 5.1V2.4m0 2.7H9.9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10.9 2.35a1.55 1.55 0 0 1 2.2 2.2l-7.95 7.95-2.9.75.75-2.9 7.9-8Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
      <path
        d="M9.75 3.55 11.9 5.7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}

function bookmarkWithCaptureSnapshot(
  post: Post,
  status: Exclude<Post["captureStatus"], "pending" | undefined>,
  snapshot: CaptureStatusResponse,
): Post {
  return {
    ...post,
    captureStatus: status,
    capture: snapshot.capture ?? post.capture,
    cover: snapshot.cover ?? post.cover,
    updatedAt: snapshot.updatedAt ?? post.updatedAt,
    wordCount: snapshot.wordCount ?? post.wordCount,
  };
}

function BookmarkRecaptureControl({
  handle,
  menuItem = false,
  post,
  onCaptureChange,
}: {
  handle: string;
  menuItem?: boolean;
  post: Post;
  onCaptureChange?: (post: Post) => void;
}) {
  const [request, setRequest] = useState<{
    error: string | null;
    post: Post;
    requested: boolean;
  } | null>(null);
  const requestRef = useRef(request);
  const [starting, setStarting] = useState(false);
  const effectiveRequest = request?.post.id === post.id ? request : null;
  const effectivePost = effectiveRequest?.post ?? post;

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  const captureStatus = useCaptureStatus(
    effectivePost.id,
    effectivePost.captureStatus,
    {
      onResolved: (status, snapshot) => {
        const active = requestRef.current;
        const base = active && active.post.id === post.id ? active.post : post;
        const resolved = bookmarkWithCaptureSnapshot(base, status, snapshot);
        setRequest({
          error:
            status === "failed"
              ? snapshot.capture?.error || "Capture failed"
              : null,
          post: resolved,
          requested: false,
        });
        onCaptureChange?.(resolved);
      },
    },
  );
  const pending = captureStatus === "pending";
  const requested = Boolean(effectiveRequest?.requested);
  const error = effectiveRequest?.error ?? null;

  const recapture = useCallback(async () => {
    if (!post.id || pending || starting) return;
    const optimistic = { ...post, captureStatus: "pending" as const };
    setStarting(true);
    setRequest({ error: null, post: optimistic, requested: true });
    onCaptureChange?.(optimistic);
    try {
      const next = await recaptureBookmarkAction(handle, post.id);
      setRequest({ error: null, post: next, requested: true });
      onCaptureChange?.(next);
    } catch (captureError) {
      const message =
        captureError instanceof Error && captureError.message
          ? captureError.message
          : "Could not recapture bookmark";
      setRequest({ error: message, post, requested: false });
      onCaptureChange?.(post);
    } finally {
      setStarting(false);
    }
  }, [handle, onCaptureChange, pending, post, starting]);

  return (
    <>
      <button
        type="button"
        className={
          menuItem
            ? "post-edit-menu-item post-bookmark-recapture-menu-item"
            : "post-bookmark-recapture ac-btn ac-btn-gray"
        }
        role={menuItem ? "menuitem" : undefined}
        disabled={pending || starting}
        aria-label={
          pending ? "Bookmark capture in progress" : "Recapture bookmark"
        }
        title={error || (pending ? "Bookmark capture in progress" : "Recapture")}
        onClick={() => void recapture()}
      >
        {!menuItem && (
          <span className="post-action-button-icon">
            <RecaptureIcon />
          </span>
        )}
        <span className={menuItem ? undefined : "post-responsive-action-label"}>
          {pending ? (requested ? "Recapturing" : "Capturing") : "Recapture"}
        </span>
      </button>
      {error && (
        <span className="ac-sr-only" role="status">
          {error}
        </span>
      )}
    </>
  );
}

function useDismissPopover<T extends HTMLElement>(
  open: boolean,
  ref: RefObject<T | null>,
  onClose: () => void,
) {
  useEscapeLayer(open, "Popover", onClose);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (!node || !(event.target instanceof Node)) return;
      if (!node.contains(event.target)) onClose();
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose, open, ref]);
}

function NavControl({
  href,
  label,
  hint,
  keys,
  disabled = false,
  onNavigate,
  children,
}: {
  href?: string;
  label: string;
  hint?: string;
  keys?: string | null;
  disabled?: boolean;
  onNavigate?: (path: string) => Promise<void> | void;
  children: ReactNode;
}) {
  const control =
    disabled || !href ? (
      <button
        type="button"
        className="post-detail-nav is-disabled"
        aria-label={label}
        aria-disabled="true"
        disabled
      >
        <span className="post-detail-control-icon">{children}</span>
      </button>
    ) : onNavigate ? (
      <button
        type="button"
        className="post-detail-nav"
        aria-label={label}
        onClick={() => {
          void onNavigate(href);
        }}
      >
        <span className="post-detail-control-icon">{children}</span>
      </button>
    ) : (
      <Link className="post-detail-nav" href={href} aria-label={label}>
        <span className="post-detail-control-icon">{children}</span>
      </Link>
    );

  if (!hint || disabled) return control;
  return (
    <ShortcutTooltip label={hint} keys={keys} placement="bottom">
      {control}
    </ShortcutTooltip>
  );
}

export function PostActionBar(props: Props) {
  const router = useRouter();
  const shareWrapRef = useRef<HTMLDivElement>(null);
  const typeWrapRef = useRef<HTMLDivElement>(null);
  const settingsWrapRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const readSaveSequenceRef = useRef(0);
  const readSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const readBaseUpdatedAtRef = useRef(props.post.updatedAt);
  const [shareOpen, setShareOpen] = useState(false);
  const [collaboratorsOpen, setCollaboratorsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const origin = useSyncExternalStore(
    subscribeClientSnapshot,
    getBrowserOrigin,
    getServerOrigin,
  );
  const [copied, setCopied] = useState(false);
  const incomingSourceVersion = postSourceVersion(props.post);
  const [readState, setReadState] = useState<ReadState>(() => ({
    sourceVersion: incomingSourceVersion,
    dirty: false,
    draft: initialDraft(props.post),
    saveState: "saved",
    error: null,
  }));
  const canEditPost = props.canEditPost ?? props.owner;
  const canManagePost = props.canManagePost ?? props.owner;

  const closeShare = useCallback(() => setShareOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeType = useCallback(() => setTypeOpen(false), []);
  useDismissPopover(shareOpen, shareWrapRef, closeShare);
  useDismissPopover(typeOpen, typeWrapRef, closeType);
  useDismissPopover(settingsOpen, settingsWrapRef, closeSettings);

  useEffect(() => {
    const url = new URL(window.location.href);
    let consumed = false;
    if (url.searchParams.get("manageAccess") === "1") {
      if (canManagePost) setCollaboratorsOpen(true);
      url.searchParams.delete("manageAccess");
      consumed = true;
    }
    if (url.searchParams.get("share") === "1") {
      setShareOpen(true);
      url.searchParams.delete("share");
      consumed = true;
    }
    if (consumed) {
      window.history.replaceState(window.history.state, "", url);
    }
  }, [canManagePost]);

  const readDraft = readState.draft;
  const readSaveState = readState.saveState;
  const readError = readState.error;

  useEffect(() => {
    if (props.mode !== "read") return;
    setReadState((current) => {
      if (current.dirty || current.sourceVersion === incomingSourceVersion) {
        return current;
      }
      readBaseUpdatedAtRef.current = props.post.updatedAt;
      return {
        sourceVersion: incomingSourceVersion,
        dirty: false,
        draft: initialDraft(props.post),
        saveState: "saved",
        error: null,
      };
    });
  }, [incomingSourceVersion, props.mode, props.post, readState.dirty]);

  useEffect(() => {
    const closePopovers = () => {
      setShareOpen(false);
      setTypeOpen(false);
      setSettingsOpen(false);
    };
    window.addEventListener(CLOSE_EDIT_MENU_EVENT, closePopovers);
    return () => window.removeEventListener(CLOSE_EDIT_MENU_EVENT, closePopovers);
  }, []);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const activeDraft = props.mode === "edit" ? props.draft : readDraft;
  const unlistedItem = isUnlistedPostType(activeDraft.type);
  const activeSlug = slugify(activeDraft.slug, props.post.slug);
  const publicPath = props.postPath.replace(
    /\/[^/?]+(?=\?|$)/,
    `/${encodeURIComponent(activeSlug)}`,
  );
  const publicUrl = props.publishedUrl ?? (origin ? `${origin}${publicPath}` : publicPath);
  const publicDisplayPath = (() => {
    try {
      return new URL(publicUrl, "https://texttext.invalid").pathname;
    } catch {
      return publicPath;
    }
  })();
  const visibility =
    activeDraft.status === "published"
      ? {
          label: "Everyone (published)",
          detail: `Visible at ${publicDisplayPath}`,
          next: "draft" as const,
        }
      : {
          label: "Only people with the link (unlisted)",
          detail: `Publish at ${publicDisplayPath}`,
          next: "published" as const,
        };

  const readSave = useCallback(
    async (nextDraft: DraftState) => {
      const sequence = readSaveSequenceRef.current + 1;
      readSaveSequenceRef.current = sequence;
      if (!props.post.id) {
        setReadState((current) => ({
          ...current,
          dirty: true,
          saveState: "error",
          error: "Post cannot be edited",
        }));
        return;
      }

      setReadState((current) => ({
        ...current,
        dirty: true,
        draft: nextDraft,
        saveState: "saving",
        error: null,
      }));

      const queued = readSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (readSaveSequenceRef.current !== sequence) return null;
          const payload = payloadFor(
            props.post.id!,
            nextDraft,
            props.post.slug,
            readBaseUpdatedAtRef.current,
          );
          const saved = await saveEditablePostAction(props.blog.handle, payload);
          readBaseUpdatedAtRef.current = saved.updatedAt;
          return saved;
        });
      readSaveQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );

      try {
        const saved = await queued;
        if (!saved || readSaveSequenceRef.current !== sequence) return;
        setReadState({
          sourceVersion: incomingSourceVersion,
          dirty: false,
          draft: initialDraft(saved),
          saveState: "saved",
          error: null,
        });

        if (saved.slug !== props.post.slug) {
          router.replace(
            props.postPath.replace(
              /\/[^/?]+(?=\?|$)/,
              `/${encodeURIComponent(saved.slug)}`,
            ), {
            scroll: false,
            },
          );
        }
      } catch (saveError) {
        if (readSaveSequenceRef.current !== sequence) return;
        setReadState((current) => ({
          ...current,
          dirty: true,
          saveState: "error",
          error:
            saveError instanceof Error && saveError.message
              ? saveError.message
              : "Could not save",
        }));
      }
    },
    [incomingSourceVersion, props.blog.handle, props.post, props.postPath, router],
  );

  const updateSlugInput = useCallback(
    (value: string) => {
      if (props.mode === "edit") {
        props.onSlugInput(value);
        return;
      }

      setReadState((current) => ({
        ...current,
        dirty: true,
        draft: { ...current.draft, slug: slugify(value, "") },
      }));
    },
    [props],
  );

  const commitSlug = useCallback(() => {
    if (props.mode === "edit") {
      props.onSlugBlur();
      return;
    }

    const nextDraft = {
      ...readDraft,
      slug: slugify(readDraft.slug, props.post.slug),
    };
    void readSave(nextDraft);
  }, [props, readDraft, readSave]);

  const changeVisibility = useCallback(() => {
    if (props.mode === "edit") {
      void props.onVisibilityChange(visibility.next);
      return;
    }

    void readSave({ ...readDraft, status: visibility.next });
  }, [props, readDraft, readSave, visibility.next]);

  const changeType = useCallback(
    (type: ItemKind) => {
      if (props.mode !== "edit" || type === activeDraft.type) return;
      // Unlisted kinds are type-locked; the menu never offers this, but keep
      // the guard so no code path can send a doomed request.
      if (isUnlistedPostType(activeDraft.type) || isUnlistedPostType(type)) {
        return;
      }
      setShareOpen(false);
      setTypeOpen(false);
      setSettingsOpen(false);
      props.onUpdateDraft({ type });
    },
    [activeDraft.type, props],
  );

  const copyLink = useCallback(() => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1400);
    });
  }, [publicUrl]);

  const openShare = useCallback(() => {
    setTypeOpen(false);
    setSettingsOpen(false);
    setShareOpen((open) => !open);
  }, []);

  const openSettings = useCallback(() => {
    setShareOpen(false);
    setTypeOpen(false);
    setSettingsOpen((open) => !open);
  }, []);

  const openType = useCallback(() => {
    setShareOpen(false);
    setSettingsOpen(false);
    setTypeOpen((open) => !open);
  }, []);

  const editHref = postEditPath(props.postPath, props.post.id);
  const warmEditPath = useCallback(() => {
    if (props.mode !== "read" || !canEditPost) return;
    // A supplied navigation handler owns an already-mounted local surface.
    // Warming the route would add server work to a local read/edit toggle.
    if (props.onNavigate) return;
    if (warmedEditPaths.has(editHref)) return;
    warmedEditPaths.add(editHref);
    router.prefetch(editHref);
  }, [canEditPost, editHref, props.mode, props.onNavigate, router]);

  useEffect(() => {
    if (props.mode !== "read" || !canEditPost) return;
    warmEditPath();
  }, [canEditPost, props.mode, warmEditPath]);

  const doneControl =
    props.mode === "edit" ? (
      <ShortcutTooltip
        label="Stop editing"
        keys={shortcutLabelForCommand("post.stop-editing")}
        placement="bottom"
      >
        <button
          type="button"
          className="post-owner-edit ac-btn ac-btn-filled"
          onClick={() => {
            void props.onDone();
          }}
        >
          <span className="post-stop-edit-label-full">Stop editing</span>
          <span className="post-stop-edit-label-compact">Done</span>
        </button>
      </ShortcutTooltip>
    ) : (
      <ShortcutTooltip
        label="Edit"
        keys={shortcutLabelForCommand("post.edit")}
        placement="bottom"
      >
        {props.onNavigate ? (
          <button
            type="button"
            className="post-owner-edit ac-btn ac-btn-filled"
            onClick={() => {
              warmEditPath();
              void props.onNavigate?.(editHref);
            }}
            onFocus={warmEditPath}
            onMouseEnter={warmEditPath}
            onTouchStart={warmEditPath}
          >
            <span className="post-action-button-icon">
              <PencilIcon />
            </span>
            <span className="shortcut-label">
              <span className="shortcut-letter">E</span>dit
            </span>
          </button>
        ) : (
          <Link
            className="post-owner-edit ac-btn ac-btn-filled"
            href={editHref}
            onFocus={warmEditPath}
            onMouseEnter={warmEditPath}
            onTouchStart={warmEditPath}
          >
            <span className="post-action-button-icon">
              <PencilIcon />
            </span>
            <span className="shortcut-label">
              <span className="shortcut-letter">E</span>dit
            </span>
          </Link>
        )}
      </ShortcutTooltip>
    );

  const readStatus =
    props.mode === "read" && readSaveState !== "saved" ? (
      <span className={`post-share-status is-${readSaveState}`} role="status">
        {readSaveState === "saving" ? "Saving" : readError}
      </span>
    ) : null;

  const previousPath =
    props.previousPath ??
    (props.adjacent.previous
      ? postPathFor(props.blog.handle, props.adjacent.previous.slug)
      : undefined);
  const nextPath =
    props.nextPath ??
    (props.adjacent.next
      ? postPathFor(props.blog.handle, props.adjacent.next.slug)
      : undefined);
  const showPostNav = props.mode === "read" && Boolean(previousPath || nextPath);
  const bookmarkMode =
    props.mode === "read" ? (props.bookmarkContentMode ?? "readable") : "readable";
  const bookmarkCaptureUrl =
    props.mode === "read" && props.post.type === "bookmark"
      ? safePostUrl(props.post.capture?.screenshotTiles?.[0]?.url) ||
        safePostUrl(props.post.capture?.screenshotUrl)
      : "";
  const bookmarkControls =
    props.mode === "read" &&
    props.post.type === "bookmark" &&
    props.onBookmarkContentModeChange &&
    bookmarkCaptureUrl ? (
      <div
        className="post-bookmark-action-group"
        role="group"
        aria-label="Bookmark view"
      >
        <span className="post-bookmark-view-label">View as:</span>
        <div className="post-bookmark-view-segmented">
          <button
            type="button"
            className={`post-bookmark-view-button ac-btn ac-btn-gray${
              bookmarkMode === "readable" ? " is-active" : ""
            }`}
            aria-pressed={bookmarkMode === "readable"}
            onClick={() => props.onBookmarkContentModeChange?.("readable")}
          >
            Reader
          </button>
          <button
            type="button"
            className={`post-bookmark-view-button ac-btn ac-btn-gray${
              bookmarkMode === "capture" ? " is-active" : ""
            }`}
            aria-pressed={bookmarkMode === "capture"}
            onClick={() => props.onBookmarkContentModeChange?.("capture")}
          >
            Full
          </button>
        </div>
      </div>
    ) : null;
  const showTopActionBar =
    Boolean(props.onSearch || props.onSearchValueChange) ||
    canEditPost ||
    showPostNav ||
    Boolean(bookmarkControls);
  const showAddHeaderItem =
    props.mode === "edit" &&
    activeDraft.type === "article" &&
    !props.hasHeaderImage;
  const presenceControl = <PresenceStack peers={props.presencePeers ?? []} />;
  const shareControl = (
    <div className="post-action-popover-wrap" ref={shareWrapRef}>
      <button
        type="button"
        className="post-action-share ac-btn ac-btn-gray"
        aria-expanded={shareOpen}
        aria-label="Share post"
        onClick={openShare}
      >
        <span className="post-action-button-icon">
          <ShareIcon />
        </span>
        <span className="post-responsive-action-label">Share</span>
      </button>
      {shareOpen && (
        <div
          className="post-share-popover"
          data-post-edit-menu-open="true"
          role="dialog"
          aria-label="Share"
        >
          <div className="post-popover-heading">Share</div>
          <section className="post-share-section">
            <div className="post-share-section-label">
              Link to this page:
            </div>
            <div className="post-share-link-row">
              <input
                className="post-share-link-field"
                value={publicUrl}
                readOnly
                aria-label="Link to this page:"
              />
              <button
                type="button"
                className="post-share-copy ac-btn ac-btn-gray"
                onClick={copyLink}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </section>
          <section className="post-share-section">
            <label className="post-edit-menu-field">
              <span>Slug</span>
              <input
                className="post-edit-slug"
                value={activeDraft.slug}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) =>
                  updateSlugInput(event.currentTarget.value)
                }
                onBlur={commitSlug}
              />
            </label>
          </section>
          <section className="post-share-section">
            <div className="post-share-section-label">Who can see this</div>
            {unlistedItem ? (
              <div className="post-share-visibility-static">
                <span className="post-share-visibility-copy">
                  <strong>Only people with the link (unlisted)</strong>
                  <span>
                    {activeDraft.type === "note"
                      ? "Notes stay unlisted."
                      : "Bookmarks stay unlisted."}
                  </span>
                </span>
              </div>
            ) : (
              <button
                type="button"
                className="post-share-visibility-button"
                onClick={changeVisibility}
              >
                <span className="post-share-visibility-copy">
                  <strong>{visibility.label}</strong>
                  <span>{visibility.detail}</span>
                </span>
                <span className="post-share-action-word">Change</span>
              </button>
            )}
            {readStatus}
          </section>
          <section className="post-share-section post-share-future">
            <div>
              <div className="post-share-section-label">Who can edit</div>
              <p>
                {props.post.id
                  ? "Invite people by email to view or edit this page."
                  : "Save this page first to invite collaborators."}
              </p>
            </div>
            <button
              type="button"
              className="post-share-invite ac-btn ac-btn-gray"
              disabled={!props.post.id}
              onClick={() => {
                setShareOpen(false);
                setCollaboratorsOpen(true);
              }}
            >
              Invite people
            </button>
          </section>
        </div>
      )}
    </div>
  );

  return (
    <>
      <nav
        className={`post-back-action-bar applecms is-${props.mode}`}
        aria-label="Post navigation"
      >
        <NavControl
          href={props.homePath}
          label="Back"
          hint="Back"
          keys={shortcutLabelForCommand("navigation.up")}
          onNavigate={props.onNavigate}
        >
          <BackIcon />
        </NavControl>
      </nav>
      {showTopActionBar && (
        <WorkspaceActionBarPortal>
          <div
            className={`post-top-action-bar applecms is-${props.mode}`}
            aria-label="Post controls"
          >
            <div className="post-action-toolbar ac-chrome">
            {props.onSearchValueChange ? (
              <div className="workspace-find-controls">
                <WorkspaceActionSearch
                ariaLabel={`Find in ${postTitle(activeDraft.title)}`}
                focusRequestKey={props.searchFocusRequestKey}
                placeholder="Find in page"
                value={props.searchValue ?? ""}
                onChange={props.onSearchValueChange}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (props.searchValue) props.onSearchValueChange?.("");
                  else event.currentTarget.blur();
                }}
                />
              </div>
            ) : props.onSearch ? (
              <WorkspaceSearchButton onSearch={props.onSearch} />
            ) : null}
            {(canEditPost || bookmarkControls) && (
              <div className="post-action-owner-group">
                {bookmarkControls}
                {canManagePost && shareControl}
                {canEditPost && presenceControl}
                {canManagePost &&
                  props.mode === "edit" &&
                  !unlistedItem && (
                    <div className="post-action-popover-wrap" ref={typeWrapRef}>
                      <button
                        type="button"
                        className="post-turn-into-button ac-btn ac-btn-gray"
                        aria-haspopup="menu"
                        aria-expanded={typeOpen}
                        onClick={openType}
                      >
                        Turn into
                        <span aria-hidden="true">▾</span>
                      </button>
                      {typeOpen && (
                        <div
                          className="post-edit-menu post-turn-into-menu"
                          data-post-edit-menu-open="true"
                          role="menu"
                          aria-label="Turn into"
                        >
                          {POST_TYPE_OPTIONS.map((option) => {
                            const active = activeDraft.type === option.type;
                            return (
                              <button
                                key={option.type}
                                className={`post-edit-menu-item post-turn-into-item${
                                  active ? " is-active" : ""
                                }`}
                                type="button"
                                role="menuitemradio"
                                aria-checked={active}
                                onClick={() => {
                                  if (!active) changeType(option.type);
                                  setTypeOpen(false);
                                }}
                              >
                                <span>{option.label}</span>
                                {active && (
                                  <span className="post-turn-into-check">
                                    <MenuCheckIcon />
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                {canManagePost && props.mode === "edit" && (
                  <div className="post-action-popover-wrap" ref={settingsWrapRef}>
                    <button
                      type="button"
                      className="post-edit-menu-button ac-icon-btn"
                      aria-label="Post actions"
                      aria-expanded={settingsOpen}
                      aria-haspopup="menu"
                      onClick={openSettings}
                    >
                      <EllipsisIcon />
                    </button>
                    {settingsOpen && (
                      <div
                        className="post-edit-menu"
                        data-post-edit-menu-open="true"
                        role="menu"
                        aria-label="Post actions"
                      >
                        {showAddHeaderItem && (
                          <button
                            className="post-edit-menu-item"
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setSettingsOpen(false);
                              props.onAddHeaderImage();
                            }}
                          >
                            Add header image
                          </button>
                        )}
                        {activeDraft.type === "bookmark" && props.post.id && (
                          <BookmarkRecaptureControl
                            handle={props.blog.handle}
                            menuItem
                            post={props.post}
                            onCaptureChange={props.onBookmarkCaptureChange}
                          />
                        )}
                        <button
                          className="post-edit-delete"
                          type="button"
                          role="menuitem"
                          disabled={!props.post.id || props.deleting}
                          onClick={() => {
                            setSettingsOpen(false);
                            props.onDelete();
                          }}
                        >
                          {props.deleting ? "Deleting" : "Delete post"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {canEditPost && doneControl}
              </div>
            )}
            {canManagePost && props.post.id && (
              <ShareDialog
                handle={props.blog.handle}
                postId={props.post.id}
                postTitle={postTitle(activeDraft.title)}
                open={collaboratorsOpen}
                onClose={() => setCollaboratorsOpen(false)}
              />
            )}
            {showPostNav && (
              <nav className="post-detail-controls" aria-label="Post navigation">
                <NavControl
                  href={previousPath}
                  label={
                    props.adjacent.previous
                      ? `Previous post: ${postTitle(props.adjacent.previous.title)}`
                      : "No previous post"
                  }
                  hint="Previous post"
                  keys={shortcutLabelForCommand("post.previous")}
                  disabled={!previousPath}
                  onNavigate={props.onNavigate}
                >
                  <ChevronIcon dir="left" />
                </NavControl>
                <NavControl
                  href={nextPath}
                  label={
                    props.adjacent.next
                      ? `Next post: ${postTitle(props.adjacent.next.title)}`
                      : "No next post"
                  }
                  hint="Next post"
                  keys={shortcutLabelForCommand("post.next")}
                  disabled={!nextPath}
                  onNavigate={props.onNavigate}
                >
                  <ChevronIcon dir="right" />
                </NavControl>
              </nav>
            )}
            </div>
          </div>
        </WorkspaceActionBarPortal>
      )}
    </>
  );
}
