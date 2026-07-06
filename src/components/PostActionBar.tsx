"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode, RefObject } from "react";
import { useRouter } from "next/navigation";
import { saveEditablePostAction } from "@/app/editor/actions";
import { CLOSE_EDIT_MENU_EVENT } from "@/components/PostShortcuts";
import type { Blog, Post, PostType } from "@/lib/content";
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
  owner: boolean;
};

type ReadProps = CommonProps & {
  mode: "read";
};

type EditProps = CommonProps & {
  mode: "edit";
  draft: DraftState;
  deleting: boolean;
  hasHeaderImage: boolean;
  onDelete: () => void;
  onDone: () => Promise<void>;
  onAddHeaderImage: () => void;
  onNavigate: (path: string) => Promise<void>;
  onSlugBlur: () => void;
  onSlugInput: (value: string) => void;
  onUpdateDraft: (patch: Partial<DraftState>) => void;
  onVisibilityChange: (status: Post["status"]) => Promise<void>;
};

type Props = ReadProps | EditProps;
type ReadState = {
  source: Post;
  draft: DraftState;
  saveState: SaveState;
  error: string | null;
};

const POST_TYPE_OPTIONS: Array<{
  type: PostType;
  label: string;
}> = [
  { type: "article", label: "Article" },
  { type: "project", label: "Media post" },
  { type: "talk", label: "Video post" },
];

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

function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={dir === "left" ? "M10 3L5 8L10 13" : "M6 3L11 8L6 13"}
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

function useDismissPopover<T extends HTMLElement>(
  open: boolean,
  ref: RefObject<T | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (!node || !(event.target instanceof Node)) return;
      if (!node.contains(event.target)) onClose();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose, open, ref]);
}

function NavControl({
  href,
  label,
  disabled = false,
  mode,
  onNavigate,
  children,
}: {
  href?: string;
  label: string;
  disabled?: boolean;
  mode: Props["mode"];
  onNavigate?: (path: string) => Promise<void>;
  children: ReactNode;
}) {
  if (disabled || !href) {
    return (
      <button
        type="button"
        className="post-detail-nav is-disabled"
        aria-label={label}
        aria-disabled="true"
        disabled
      >
        <span className="post-detail-control-icon">{children}</span>
      </button>
    );
  }

  if (mode === "edit" && onNavigate) {
    return (
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
    );
  }

  return (
    <Link className="post-detail-nav" href={href} aria-label={label}>
      <span className="post-detail-control-icon">{children}</span>
    </Link>
  );
}

export function PostActionBar(props: Props) {
  const router = useRouter();
  const shareWrapRef = useRef<HTMLDivElement>(null);
  const settingsWrapRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const origin = useSyncExternalStore(
    subscribeClientSnapshot,
    getBrowserOrigin,
    getServerOrigin,
  );
  const [copied, setCopied] = useState(false);
  const [readState, setReadState] = useState<ReadState>(() => ({
    source: props.post,
    draft: initialDraft(props.post),
    saveState: "saved",
    error: null,
  }));

  const closeShare = useCallback(() => setShareOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  useDismissPopover(shareOpen, shareWrapRef, closeShare);
  useDismissPopover(settingsOpen, settingsWrapRef, closeSettings);

  let readDraft = readState.draft;
  let readSaveState = readState.saveState;
  let readError = readState.error;
  if (props.mode === "read" && readState.source !== props.post) {
    const nextReadState = {
      source: props.post,
      draft: initialDraft(props.post),
      saveState: "saved" as const,
      error: null,
    };
    setReadState(nextReadState);
    readDraft = nextReadState.draft;
    readSaveState = nextReadState.saveState;
    readError = nextReadState.error;
  }

  useEffect(() => {
    const closePopovers = () => {
      setShareOpen(false);
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
  const activeSlug = slugify(activeDraft.slug, props.post.slug);
  const publicPath = postPathFor(props.blog.handle, activeSlug);
  const publicUrl = origin ? `${origin}${publicPath}` : publicPath;
  const visibility =
    activeDraft.status === "published"
      ? {
          label: "Everyone (published)",
          detail: "Visible on the blog and feeds",
          next: "draft" as const,
        }
      : {
          label: "Only people with the link (unlisted)",
          detail: "Hidden from public lists",
          next: "published" as const,
        };

  const readSave = useCallback(
    async (nextDraft: DraftState) => {
      if (!props.post.id) {
        setReadState((current) => ({
          ...current,
          saveState: "error",
          error: "Post cannot be edited",
        }));
        return;
      }

      setReadState((current) => ({
        ...current,
        draft: nextDraft,
        saveState: "saving",
        error: null,
      }));

      try {
        const payload = payloadFor(props.post.id, nextDraft, props.post.slug);
        const saved = await saveEditablePostAction(props.blog.handle, payload);
        setReadState({
          source: props.post,
          draft: initialDraft(saved),
          saveState: "saved",
          error: null,
        });

        if (saved.slug !== props.post.slug) {
          router.replace(postPathFor(props.blog.handle, saved.slug), {
            scroll: false,
          });
        }
      } catch (saveError) {
        setReadState((current) => ({
          ...current,
          saveState: "error",
          error:
            saveError instanceof Error && saveError.message
              ? saveError.message
              : "Could not save",
        }));
      }
    },
    [props.blog.handle, props.post, router],
  );

  const updateSlugInput = useCallback(
    (value: string) => {
      if (props.mode === "edit") {
        props.onSlugInput(value);
        return;
      }

      setReadState((current) => ({
        ...current,
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
    (type: PostType) => {
      if (props.mode !== "edit" || type === activeDraft.type) return;
      setShareOpen(false);
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
    setSettingsOpen(false);
    setShareOpen((open) => !open);
  }, []);

  const openSettings = useCallback(() => {
    setShareOpen(false);
    setSettingsOpen((open) => !open);
  }, []);

  const doneControl =
    props.mode === "edit" ? (
      <button
        type="button"
        className="post-owner-edit ac-btn ac-btn-filled"
        onClick={() => {
          void props.onDone();
        }}
      >
        Done
      </button>
    ) : (
      <Link
        className="post-owner-edit ac-btn ac-btn-filled"
        href={postEditPath(props.postPath, props.post.id)}
      >
        <span className="post-action-button-icon">
          <PencilIcon />
        </span>
        Edit
      </Link>
    );

  const readStatus =
    props.mode === "read" && readSaveState !== "saved" ? (
      <span className={`post-share-status is-${readSaveState}`} role="status">
        {readSaveState === "saving" ? "Saving" : readError}
      </span>
    ) : null;

  const previousPath = props.adjacent.previous
    ? postPathFor(props.blog.handle, props.adjacent.previous.slug)
    : undefined;
  const nextPath = props.adjacent.next
    ? postPathFor(props.blog.handle, props.adjacent.next.slug)
    : undefined;
  const showPostNav = props.mode === "read" && Boolean(previousPath || nextPath);
  const showTopActionBar = props.owner || showPostNav;
  const showAddHeaderItem =
    props.mode === "edit" &&
    activeDraft.type === "article" &&
    !props.hasHeaderImage;
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
        Share
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
            {readStatus}
          </section>
          <section className="post-share-section post-share-future">
            <div>
              <div className="post-share-section-label">Who can edit</div>
              <p>Collaborators and invites will appear here.</p>
            </div>
            <button
              type="button"
              className="post-share-invite ac-btn ac-btn-gray"
              disabled
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
          mode={props.mode}
          onNavigate={props.mode === "edit" ? props.onNavigate : undefined}
        >
          <BackIcon />
        </NavControl>
      </nav>
      {showTopActionBar && (
        <div
          className={`post-top-action-bar applecms is-${props.mode}`}
          aria-label="Post controls"
        >
          <div className="post-action-toolbar ac-chrome">
            {props.owner && (
              <div className="post-action-owner-group">
                {shareControl}
                {props.mode === "edit" && (
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
                        <div
                          className="post-edit-menu-section"
                          role="group"
                          aria-label="Turn into"
                        >
                          <div
                            className="post-edit-menu-section-title"
                            role="presentation"
                          >
                            Turn into
                          </div>
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
                                  if (active) {
                                    setSettingsOpen(false);
                                    return;
                                  }
                                  changeType(option.type);
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
                {doneControl}
              </div>
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
                  disabled={!previousPath}
                  mode={props.mode}
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
                  disabled={!nextPath}
                  mode={props.mode}
                >
                  <ChevronIcon dir="right" />
                </NavControl>
              </nav>
            )}
          </div>
        </div>
      )}
    </>
  );
}
