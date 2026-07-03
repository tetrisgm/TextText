"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";
import { useRouter } from "next/navigation";
import { saveEditablePostAction } from "@/app/editor/actions";
import { CLOSE_EDIT_MENU_EVENT } from "@/components/PostShortcuts";
import type { Blog, Post } from "@/lib/content";
import {
  initialDraft,
  isHexColor,
  payloadFor,
  postPath as postPathFor,
  slugify,
} from "@/lib/post-edit-draft";
import type { DraftState, SaveState } from "@/lib/post-edit-draft";

type AdjacentPostLink = Pick<Post, "slug" | "title">;

type AdjacentPosts = {
  previous: AdjacentPostLink | null;
  next: AdjacentPostLink | null;
};

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
  onDelete: () => void;
  onDone: () => Promise<void>;
  onNavigate: (path: string) => Promise<void>;
  onSlugBlur: () => void;
  onSlugInput: (value: string) => void;
  onUpdateDraft: (patch: Partial<DraftState>) => void;
  onVisibilityChange: (status: Post["status"]) => Promise<void>;
};

type Props = ReadProps | EditProps;

function postTitle(title: string): string {
  return title.trim() || "Untitled";
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 3L13 13M13 3L3 13"
        stroke="currentColor"
        strokeLinecap="round"
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

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.75V3M8 13v1.25M3.6 3.6l.88.88M11.52 11.52l.88.88M1.75 8H3M13 8h1.25M3.6 12.4l.88-.88M11.52 4.48l.88-.88"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
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
  mode,
  onNavigate,
  children,
}: {
  href: string;
  label: string;
  mode: Props["mode"];
  onNavigate?: (path: string) => Promise<void>;
  children: ReactNode;
}) {
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
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [readDraft, setReadDraft] = useState(() => initialDraft(props.post));
  const [readSaveState, setReadSaveState] = useState<SaveState>("saved");
  const [readError, setReadError] = useState<string | null>(null);

  const closeShare = useCallback(() => setShareOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  useDismissPopover(shareOpen, shareWrapRef, closeShare);
  useDismissPopover(settingsOpen, settingsWrapRef, closeSettings);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (props.mode !== "read") return;
    setReadDraft(initialDraft(props.post));
    setReadSaveState("saved");
    setReadError(null);
  }, [props.mode, props.post]);

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
  const colorValue = isHexColor(activeDraft.accent)
    ? activeDraft.accent
    : isHexColor(props.blog.accent)
      ? props.blog.accent
      : "#0066cc";
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
        setReadSaveState("error");
        setReadError("Post cannot be edited");
        return;
      }

      setReadDraft(nextDraft);
      setReadSaveState("saving");
      setReadError(null);

      try {
        const payload = payloadFor(props.post.id, nextDraft, props.post.slug);
        const saved = await saveEditablePostAction(payload);
        setReadDraft(initialDraft(saved));
        setReadSaveState("saved");
        setReadError(null);

        if (saved.slug !== props.post.slug) {
          router.replace(postPathFor(props.blog.handle, saved.slug), {
            scroll: false,
          });
        }
      } catch (saveError) {
        setReadSaveState("error");
        setReadError(
          saveError instanceof Error && saveError.message
            ? saveError.message
            : "Could not save",
        );
      }
    },
    [props.blog.handle, props.post.id, props.post.slug, router],
  );

  const updateDraft = useCallback(
    (patch: Partial<DraftState>) => {
      if (props.mode === "edit") {
        props.onUpdateDraft(patch);
        return;
      }

      setReadDraft((current) => ({ ...current, ...patch }));
    },
    [props],
  );

  const updateSlugInput = useCallback(
    (value: string) => {
      if (props.mode === "edit") {
        props.onSlugInput(value);
        return;
      }

      setReadDraft((current) => ({ ...current, slug: slugify(value, "") }));
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
        href={`${props.postPath}?edit=1`}
      >
        Edit
      </Link>
    );

  const readStatus =
    props.mode === "read" && readSaveState !== "saved" ? (
      <span className={`post-share-status is-${readSaveState}`} role="status">
        {readSaveState === "saving" ? "Saving" : readError}
      </span>
    ) : null;

  return (
    <div className="post-top-action-bar applecms" aria-label="Post controls">
      <div className="post-action-toolbar ac-chrome">
        {props.owner && (
          <div className="post-action-owner-group">
            {doneControl}
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
                    <div className="post-share-section-label">Public link</div>
                    <div className="post-share-link-row">
                      <input
                        className="post-share-link-field"
                        value={publicUrl}
                        readOnly
                        aria-label="Public link"
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
            {props.mode === "edit" && (
              <div className="post-action-popover-wrap" ref={settingsWrapRef}>
                <button
                  type="button"
                  className="post-edit-menu-button ac-icon-btn"
                  aria-label="Post settings"
                  aria-expanded={settingsOpen}
                  onClick={openSettings}
                >
                  <GearIcon />
                </button>
                {settingsOpen && (
                  <div
                    className="post-edit-menu"
                    data-post-edit-menu-open="true"
                    role="dialog"
                    aria-label="Post settings"
                  >
                    <div className="post-popover-heading">Settings</div>
                    <label className="post-edit-menu-field">
                      <span>Kicker</span>
                      <input
                        className="post-edit-kicker-menu"
                        value={activeDraft.kicker}
                        placeholder="Optional kicker"
                        onChange={(event) =>
                          updateDraft({ kicker: event.currentTarget.value })
                        }
                      />
                    </label>
                    <label className="post-edit-menu-field">
                      <span>Accent color</span>
                      <span className="post-edit-color-row">
                        <input
                          className="post-edit-color"
                          type="color"
                          aria-label="Accent color"
                          value={colorValue}
                          onChange={(event) =>
                            updateDraft({ accent: event.currentTarget.value })
                          }
                        />
                        <button
                          className="post-edit-inherit ac-btn ac-btn-plain"
                          type="button"
                          onClick={() => updateDraft({ accent: "" })}
                        >
                          Inherit
                        </button>
                      </span>
                    </label>
                    <button
                      className="post-edit-delete ac-btn"
                      type="button"
                      disabled={!props.post.id || props.deleting}
                      onClick={props.onDelete}
                    >
                      {props.deleting ? "Deleting" : "Delete post"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <nav className="post-detail-controls" aria-label="Post navigation">
          {props.owner && <span className="post-action-divider" aria-hidden="true" />}
          {props.adjacent.previous && (
            <NavControl
              href={postPathFor(props.blog.handle, props.adjacent.previous.slug)}
              label={`Previous post: ${postTitle(props.adjacent.previous.title)}`}
              mode={props.mode}
              onNavigate={props.mode === "edit" ? props.onNavigate : undefined}
            >
              <ChevronIcon dir="left" />
            </NavControl>
          )}
          {props.adjacent.next && (
            <NavControl
              href={postPathFor(props.blog.handle, props.adjacent.next.slug)}
              label={`Next post: ${postTitle(props.adjacent.next.title)}`}
              mode={props.mode}
              onNavigate={props.mode === "edit" ? props.onNavigate : undefined}
            >
              <ChevronIcon dir="right" />
            </NavControl>
          )}
          <NavControl
            href={props.homePath}
            label="Close"
            mode={props.mode}
            onNavigate={props.mode === "edit" ? props.onNavigate : undefined}
          >
            <CloseIcon />
          </NavControl>
        </nav>
      </div>
    </div>
  );
}
