"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  deleteEditablePostAction,
  movePostToFolderAction,
  saveEditablePostAction,
} from "@/app/editor/actions";
import { ProjectGallery } from "@/components/ProjectGallery";
import {
  WorkspaceSidebarChrome,
  closeExpandedWorkspaceSidebar,
  sidebarFolderPathForPostType,
  useWorkspaceSidebarCollapsed,
} from "@/components/PostWorkspaceShell";
import type { SidebarFolderId } from "@/components/PostWorkspaceShell";
import type { Blog, Folder, GalleryItem, Post } from "@/lib/content";
import {
  isVideoFile,
  isYouTube,
  youtubeEmbedUrl,
} from "@/lib/content";
import {
  MediaUploadError,
  mediaUploadEndpointForHandle,
  uploadMedia,
} from "@/lib/upload";
import type { AdjacentPublishedPosts } from "@/lib/store";
import {
  initialDraft,
  isPlaceholderSlug,
  isUnsetTitle,
  payloadFor,
  payloadKey,
  slugify,
  uniqueSlug,
} from "@/lib/post-edit-draft";
import type { DraftState, SaveState } from "@/lib/post-edit-draft";
import { PostActionBar } from "@/components/PostActionBar";
import { BodyEditor } from "@/components/BodyEditor";
import type { BodyEditorHandle, BodyEditorCollab } from "@/components/BodyEditor";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { hasOpenEditMenu } from "@/components/PostShortcuts";
import { ProjectReader } from "@/components/ProjectReader";
import { Reader } from "@/components/Reader";
import { TalkReader } from "@/components/TalkReader";
import { isNoCoverValue, NO_COVER_VALUE, resolveCover } from "@/lib/cover";
import { COVER_PILE } from "@/lib/cover-pile";
import { blogPostEditPath, blogPostPath } from "@/lib/public-paths";
import { ANONYMOUS_MEDIA_UPLOAD_COPY } from "@/lib/product-limits";

type EditSession = {
  draft: DraftState;
  currentSlug: string;
  autoSlugAllowed: boolean;
  lastSavedKey: string;
};

type DraftSnapshot = {
  postId: string | undefined;
  draft: DraftState;
};

const editSessions = new Map<string, EditSession>();

const COVER_HEIGHT_MIN = 220;
const COVER_HEIGHT_MAX = 760;
const COVER_HEIGHT_STEP = 24;

function autoGrow(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.style.height = "0px";
  node.style.height = `${node.scrollHeight}px`;
}

function focusTextareaEnd(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.focus({ preventScroll: true });
  node.setSelectionRange(node.value.length, node.value.length);
}

function textareaCaretOnFirstLine(node: HTMLTextAreaElement): boolean {
  const selectionStart = node.selectionStart ?? 0;
  const firstBreak = node.value.indexOf("\n");
  return firstBreak === -1 || selectionStart <= firstBreak;
}

function textareaCaretOnLastLine(node: HTMLTextAreaElement): boolean {
  const selectionEnd = node.selectionEnd ?? 0;
  const lastBreak = node.value.lastIndexOf("\n");
  return lastBreak === -1 || selectionEnd > lastBreak;
}

function editableCaretOnFirstLine(container: HTMLElement): boolean {
  const editor = container.querySelector<HTMLElement>(".body-editor-content");
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) return false;
  if (!editor.textContent?.trim()) return true;

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;

  const caretRange = range.cloneRange();
  caretRange.collapse(true);
  const caretRect =
    caretRange.getClientRects()[0] ?? caretRange.getBoundingClientRect();
  if (caretRect.height === 0 && caretRect.width === 0) return false;

  const editorRect = editor.getBoundingClientRect();
  const lineHeight = parseFloat(window.getComputedStyle(editor).lineHeight);
  const threshold = Number.isFinite(lineHeight) ? lineHeight * 0.8 : 24;
  return caretRect.top <= editorRect.top + threshold;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.25 8.25l3 3L12.75 4.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 4.25v4.25M8 11.75h.01"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function uploadErrorMessage(error: unknown): string {
  return error instanceof MediaUploadError
    ? error.message
    : errorMessage(error, "Upload failed.");
}

function randomPileCover(currentCover: string): string {
  const available = COVER_PILE.filter((cover) => cover !== currentCover);
  const pile = available.length > 0 ? available : COVER_PILE;
  return pile[Math.floor(Math.random() * pile.length)] ?? COVER_PILE[0] ?? "";
}

function clampCoverHeight(value: number): number {
  return Math.min(COVER_HEIGHT_MAX, Math.max(COVER_HEIGHT_MIN, Math.round(value)));
}

function EditableCover({
  title,
  cover,
  coverHeight,
  mediaEnabled,
  uploading,
  error,
  onChangeCover,
  onCoverHeightChange,
  onUploadFile,
  onRemoveCover,
}: {
  title: string;
  cover: string;
  coverHeight: number | null;
  mediaEnabled: boolean;
  uploading: boolean;
  error: string | null;
  onChangeCover: () => void;
  onCoverHeightChange: (height: number) => void;
  onUploadFile: (file: File) => void;
  onRemoveCover: () => void;
}) {
  const figureRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draggingCover, setDraggingCover] = useState(false);
  const [resizingCover, setResizingCover] = useState(false);
  const chooseFile = (files: FileList | null) => {
    if (!mediaEnabled) return;
    const file = files
      ? Array.from(files).find((item) => item.type.startsWith("image/"))
      : undefined;
    if (file) onUploadFile(file);
  };
  const hasCoverDrop = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes("Files");
  const onCoverDrag = (event: DragEvent<HTMLElement>) => {
    if (!mediaEnabled) return;
    if (!hasCoverDrop(event)) return;
    event.preventDefault();
    if (uploading) return;
    event.dataTransfer.dropEffect = "copy";
    setDraggingCover(true);
  };
  const onCoverDragLeave = (event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setDraggingCover(false);
  };
  const onCoverDrop = (event: DragEvent<HTMLElement>) => {
    if (!mediaEnabled) return;
    if (!hasCoverDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDraggingCover(false);
    if (uploading) return;
    chooseFile(event.dataTransfer.files);
  };
  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const media = figureRef.current?.querySelector<HTMLElement>(".edit-cover-media");
    if (!media) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const startY = event.clientY;
    const startHeight = media.getBoundingClientRect().height;
    setResizingCover(true);

    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      onCoverHeightChange(clampCoverHeight(startHeight + moveEvent.clientY - startY));
    };
    const onPointerUp = () => {
      setResizingCover(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerUp, { once: true });
  };
  const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const currentHeight =
      coverHeight ?? figureRef.current?.querySelector<HTMLElement>(".edit-cover-media")
        ?.getBoundingClientRect().height ?? 420;
    const step = event.shiftKey ? COVER_HEIGHT_STEP * 2 : COVER_HEIGHT_STEP;

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onCoverHeightChange(clampCoverHeight(currentHeight - step));
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onCoverHeightChange(clampCoverHeight(currentHeight + step));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      onCoverHeightChange(COVER_HEIGHT_MIN);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      onCoverHeightChange(COVER_HEIGHT_MAX);
    }
  };
  const coverStyle = coverHeight
    ? ({ "--reader-cover-height": `${coverHeight}px` } as CSSProperties)
    : undefined;

  return (
    <figure
      ref={figureRef}
      className={`reader-cover edit-cover applecms${
        draggingCover ? " is-dragging-cover" : ""
      }${uploading ? " is-uploading-cover" : ""}${
        resizingCover ? " is-resizing-cover" : ""
      }`}
      style={coverStyle}
      onDragEnter={onCoverDrag}
      onDragOver={onCoverDrag}
      onDragLeave={onCoverDragLeave}
      onDrop={onCoverDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          chooseFile(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <div className="edit-cover-media">
        {isVideoFile(cover) ? (
          <video src={cover} controls playsInline preload="metadata" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt={title} />
        )}
        <div className="edit-cover-drop-hint" aria-hidden="true">
          {mediaEnabled ? "Drop to replace image" : "Choose a local image"}
        </div>
        <div className="edit-cover-toolbar">
          <button
            type="button"
            className="edit-cover-action"
            disabled={uploading}
            onClick={onChangeCover}
          >
            Change image
          </button>
          <button
            type="button"
            className="edit-cover-action"
            disabled={uploading || !mediaEnabled}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading" : "Upload image"}
          </button>
          <button
            type="button"
            className="edit-cover-action"
            disabled={uploading}
            onClick={onRemoveCover}
          >
            Remove
          </button>
        </div>
        <div
          role="slider"
          tabIndex={0}
          className="edit-cover-resize-handle"
          aria-label="Resize header image"
          aria-orientation="vertical"
          aria-valuemin={COVER_HEIGHT_MIN}
          aria-valuemax={COVER_HEIGHT_MAX}
          aria-valuenow={Math.round(coverHeight ?? 420)}
          onPointerDown={onResizePointerDown}
          onKeyDown={onResizeKeyDown}
        >
          <span aria-hidden="true" />
        </div>
      </div>
      {error && (
        <span className="edit-cover-error" role="alert">
          {error}
        </span>
      )}
    </figure>
  );
}

function EditableTalkStage({
  title,
  cover,
  videoUrl,
  mediaEnabled,
  uploading,
  error,
  onUploadFile,
  onRemove,
}: {
  title: string;
  cover: string;
  videoUrl: string;
  mediaEnabled: boolean;
  uploading: boolean;
  error: string | null;
  onUploadFile: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedVideoUrl = videoUrl.trim();
  const embedSrc =
    trimmedVideoUrl && isYouTube(trimmedVideoUrl)
      ? youtubeEmbedUrl(trimmedVideoUrl)
      : undefined;
  const fileVideoSrc =
    trimmedVideoUrl && !embedSrc && isVideoFile(trimmedVideoUrl)
      ? trimmedVideoUrl
      : undefined;
  const canEditCover = !embedSrc;
  const empty = !embedSrc && !fileVideoSrc && !cover;

  const chooseFile = (files: FileList | null) => {
    if (!mediaEnabled) return;
    const file = files?.[0];
    if (file) onUploadFile(file);
  };

  return (
    <div
      className={`talk-detail-stage talk-edit-stage applecms${
        empty ? " is-empty" : ""
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          chooseFile(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
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
          poster={cover || undefined}
          controls
          playsInline
          preload="metadata"
        />
      ) : cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="talk-detail-cover"
          src={cover}
          alt={title}
          loading="lazy"
        />
      ) : (
        <div className="talk-edit-stage-empty">
          {mediaEnabled && (
            <button
              type="button"
              className="talk-edit-empty-button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Uploading" : "Add cover"}
            </button>
          )}
        </div>
      )}
      {mediaEnabled && canEditCover && !empty && (
        <div className="talk-edit-cover-controls">
          <button
            type="button"
            className="edit-cover-action"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading" : cover ? "Change" : "Add cover"}
          </button>
          {cover && (
            <button
              type="button"
              className="edit-cover-action"
              disabled={uploading}
              onClick={onRemove}
            >
              Remove
            </button>
          )}
        </div>
      )}
      {error && (
        <span className="edit-cover-error talk-edit-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function TalkMetaEditor({
  videoUrl,
  venue,
  duration,
  onChange,
}: {
  videoUrl: string;
  venue: string;
  duration: string;
  onChange: (patch: Partial<DraftState>) => void;
}) {
  return (
    <div className="talk-edit-fields applecms" aria-label="Talk details">
      <label className="talk-edit-field">
        <span>Video URL</span>
        <input
          value={videoUrl}
          placeholder="YouTube or video file URL"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => onChange({ videoUrl: event.currentTarget.value })}
        />
      </label>
      <label className="talk-edit-field">
        <span>Venue</span>
        <input
          value={venue}
          placeholder="Venue"
          onChange={(event) => onChange({ venue: event.currentTarget.value })}
        />
      </label>
      <label className="talk-edit-field">
        <span>Duration</span>
        <input
          value={duration}
          placeholder="Duration"
          onChange={(event) => onChange({ duration: event.currentTarget.value })}
        />
      </label>
    </div>
  );
}

function SaveStatusPill({
  saveState,
  error,
}: {
  saveState: SaveState;
  error: string | null;
}) {
  const [savedFlash, setSavedFlash] = useState({
    saveState,
    visible: false,
  });
  const savedTimerRef = useRef<number | null>(null);

  if (savedFlash.saveState !== saveState) {
    const nextSavedFlash = {
      saveState,
      visible:
        saveState === "saved" &&
        (savedFlash.saveState === "saving" || savedFlash.saveState === "error"),
    };
    setSavedFlash(nextSavedFlash);
  }

  useEffect(() => {
    if (savedTimerRef.current !== null) {
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }

    if (!savedFlash.visible) return;

    savedTimerRef.current = window.setTimeout(() => {
      setSavedFlash((current) => ({ ...current, visible: false }));
      savedTimerRef.current = null;
    }, 1800);

    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
        savedTimerRef.current = null;
      }
    };
  }, [savedFlash.visible]);

  const visible =
    saveState === "saving" || saveState === "error" || savedFlash.visible;

  if (!visible) return null;

  const text =
    saveState === "saving" ? "Saving" : saveState === "error" ? error : "Saved";
  return (
    <div
      className={`post-save-pill applecms ac-chrome is-${saveState}`}
      role="status"
      aria-live="polite"
    >
      <span className="post-save-pill-icon" aria-hidden="true">
        {saveState === "saving" ? (
          <span className="post-save-spinner" />
        ) : saveState === "error" ? (
          <ErrorIcon />
        ) : (
          <CheckIcon />
        )}
      </span>
      <span className="post-save-pill-text">{text || "Could not save"}</span>
    </div>
  );
}

function createEditSession(post: Post): EditSession {
  const draft = initialDraft(post);
  const currentSlug = post.slug;
  return {
    draft,
    currentSlug,
    autoSlugAllowed: isPlaceholderSlug(post.slug),
    lastSavedKey: post.id
      ? payloadKey(payloadFor(post.id, draft, currentSlug))
      : "",
  };
}

function getEditSession(post: Post): EditSession {
  if (!post.id) return createEditSession(post);
  const existing = editSessions.get(post.id);
  if (existing) return existing;

  const session = createEditSession(post);
  editSessions.set(post.id, session);
  return session;
}

function patchEditSession(id: string | undefined, patch: Partial<EditSession>) {
  if (!id) return;
  const existing = editSessions.get(id);
  if (!existing) return;
  editSessions.set(id, { ...existing, ...patch });
}

function shouldFocusTitleOnEdit(post: Post): boolean {
  return isUnsetTitle(post.title);
}

function isEmptyDraft(draft: DraftState): boolean {
  const title = draft.title.trim().toLowerCase();
  return (
    (!title || title === "untitled") &&
    !draft.excerpt.trim() &&
    !draft.body.trim() &&
    (!draft.cover.trim() || isNoCoverValue(draft.cover)) &&
    draft.gallery.length === 0 &&
    !draft.videoUrl.trim()
  );
}

export function PostEditLayer({
  blog,
  post,
  adjacent,
  homePath,
  counts = {},
  folders = [],
  initialSidebarCollapsed = true,
  mediaEnabled = true,
  usedSlugs = [],
  collab = null,
  canManagePost = true,
}: {
  blog: Blog;
  post: Post;
  adjacent: AdjacentPublishedPosts;
  homePath: string;
  counts?: Record<string, number>;
  folders?: Folder[];
  initialSidebarCollapsed?: boolean;
  mediaEnabled?: boolean;
  usedSlugs?: string[];
  collab?: BodyEditorCollab | null;
  canManagePost?: boolean;
}) {
  const router = useRouter();
  const initialSession = getEditSession(post);
  const [draftSnapshot, setDraftSnapshot] = useState<DraftSnapshot>(() => ({
    postId: post.id,
    draft: initialSession.draft,
  }));
  const draft = draftSnapshot.draft;
  const [saveState, setSaveState] = useState<SaveState>(() =>
    post.id ? "saved" : "error",
  );
  const [error, setError] = useState<string | null>(() =>
    post.id ? null : "Post cannot be edited",
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryUploadError, setGalleryUploadError] = useState<string | null>(null);
  const [bodyToolbarHost, setBodyToolbarHost] = useState<HTMLDivElement | null>(null);
  const { sidebarCollapsed, toggleSidebarCollapsed } =
    useWorkspaceSidebarCollapsed(initialSidebarCollapsed);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const excerptRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<BodyEditorHandle>(null);
  const currentSlugRef = useRef(initialSession.currentSlug);
  const autoSlugAllowedRef = useRef(initialSession.autoSlugAllowed);
  const latestKeyRef = useRef(initialSession.lastSavedKey);
  const lastSavedKeyRef = useRef(initialSession.lastSavedKey);
  const saveTimerRef = useRef<number | null>(null);
  const leavingEditRef = useRef(false);
  const postId = post.id;
  const uploadEndpoint = mediaUploadEndpointForHandle(blog.handle);

  const focusTitle = useCallback(() => {
    focusTextareaEnd(titleRef.current);
  }, []);

  const focusExcerpt = useCallback(() => {
    focusTextareaEnd(excerptRef.current);
  }, []);

  const focusBody = useCallback(() => {
    bodyRef.current?.focus();
  }, []);

  useEffect(() => {
    autoGrow(titleRef.current);
  }, [draft.title, draft.type]);

  useEffect(() => {
    autoGrow(excerptRef.current);
  }, [draft.excerpt, draft.type]);

  const shouldAutoFocusTitle = shouldFocusTitleOnEdit(post);

  useEffect(() => {
    if (!shouldAutoFocusTitle) return;
    const title = titleRef.current;
    if (!title) return;
    title.focus({ preventScroll: true });
    title.setSelectionRange(title.value.length, title.value.length);
  }, [post.id, shouldAutoFocusTitle]);

  useLayoutEffect(() => {
    if (draftSnapshot.postId !== postId) return;
    patchEditSession(postId, {
      draft,
      currentSlug: currentSlugRef.current,
      autoSlugAllowed: autoSlugAllowedRef.current,
      lastSavedKey: lastSavedKeyRef.current,
    });
  }, [draft, draftSnapshot.postId, postId]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!postId) return;

    if (draftSnapshot.postId !== postId) return;

    const payload = payloadFor(postId, draft, currentSlugRef.current);
    const key = payloadKey(payload);
    latestKeyRef.current = key;
    patchEditSession(postId, {
      draft,
      currentSlug: currentSlugRef.current,
      autoSlugAllowed: autoSlugAllowedRef.current,
    });

    if (key === lastSavedKeyRef.current) {
      setSaveState("saved");
      return;
    }

    setSaveState("saving");
    setError(null);

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const sentKey = key;
      const sentSlug = payload.slug;

      startTransition(() => {
        void saveEditablePostAction(blog.handle, payload)
          .then((saved) => {
            if (latestKeyRef.current !== sentKey) return;
            lastSavedKeyRef.current = sentKey;
            patchEditSession(postId, { lastSavedKey: sentKey });
            setSaveState("saved");
            setError(null);

            if (saved.slug !== currentSlugRef.current) {
              currentSlugRef.current = saved.slug;
              patchEditSession(postId, { currentSlug: saved.slug });
              if (!leavingEditRef.current) {
                router.replace(blogPostEditPath(blog, saved), {
                  scroll: false,
                });
              }
            }

            if (saved.slug !== sentSlug) {
              setDraftSnapshot((current) => ({
                ...current,
                draft: { ...current.draft, slug: saved.slug },
              }));
            }
          })
          .catch((saveError) => {
            if (latestKeyRef.current !== sentKey) return;
            setSaveState("error");
            setError(errorMessage(saveError, "Could not save"));
          });
      });
    }, 800);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [blog, draft, draftSnapshot.postId, postId, router]);

  const updateDraft = useCallback((patch: Partial<DraftState>) => {
    setDraftSnapshot((current) => ({
      ...current,
      draft: { ...current.draft, ...patch },
    }));
  }, []);

  const updateDraftFrom = useCallback(
    (updater: (draft: DraftState) => DraftState) => {
      setDraftSnapshot((current) => ({
        ...current,
        draft: updater(current.draft),
      }));
    },
    [],
  );

  const saveDraftNow = useCallback(
    async (
      patch: Partial<DraftState> = {},
      options: { exitEdit?: boolean; navigatePath?: string } = {},
    ) => {
      if (!postId) {
        setSaveState("error");
        setError("Post cannot be edited");
        return;
      }

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      const nextDraft = { ...draft, ...patch };
      const leavingEdit = Boolean(options.exitEdit || options.navigatePath);
      if (leavingEdit) leavingEditRef.current = true;
      const payload = payloadFor(postId, nextDraft, currentSlugRef.current);
      const key = payloadKey(payload);
      latestKeyRef.current = key;
      patchEditSession(postId, {
        draft: nextDraft,
        currentSlug: currentSlugRef.current,
        autoSlugAllowed: autoSlugAllowedRef.current,
      });

      const navigateAfterSave = (slug: string) => {
        if (leavingEdit && postId) {
          // The server copy is now authoritative; a kept session would
          // resurrect this draft over later edits from another tab or agent.
          editSessions.delete(postId);
        }
        if (options.navigatePath) {
          router.push(options.navigatePath);
          return;
        }
        if (options.exitEdit) {
          router.replace(
            isEmptyDraft(nextDraft) ? homePath : blogPostPath(blog, { slug }),
            { scroll: false },
          );
        }
      };

      if (key === lastSavedKeyRef.current) {
        navigateAfterSave(currentSlugRef.current);
        return;
      }

      setSaveState("saving");
      setError(null);

      try {
        const sentSlug = payload.slug;
        const previousSlug = currentSlugRef.current;
        const saved = await saveEditablePostAction(blog.handle, payload);
        lastSavedKeyRef.current = key;
        patchEditSession(postId, { lastSavedKey: key });
        setSaveState("saved");
        setError(null);

        if (saved.slug !== previousSlug) {
          currentSlugRef.current = saved.slug;
          patchEditSession(postId, { currentSlug: saved.slug });
        }

        if (saved.slug !== sentSlug) {
          setDraftSnapshot((current) => ({
            ...current,
            draft: { ...current.draft, slug: saved.slug },
          }));
        }

        navigateAfterSave(saved.slug);
      } catch (saveError) {
        if (leavingEdit) leavingEditRef.current = false;
        setSaveState("error");
        setError(errorMessage(saveError, "Could not save"));
      }
    },
    [blog, draft, homePath, postId, router],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Escape") return;
      if (hasOpenEditMenu()) return;

      // An expanded sidebar consumes Escape first; exiting edit is the last resort.
      if (closeExpandedWorkspaceSidebar()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      if (leavingEditRef.current) return;
      void saveDraftNow({}, { exitEdit: true });
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [saveDraftNow]);

  const uploadCover = useCallback(
    async (file: File) => {
      if (!mediaEnabled) {
        setCoverUploadError(ANONYMOUS_MEDIA_UPLOAD_COPY);
        return;
      }
      setCoverUploading(true);
      setCoverUploadError(null);
      try {
        const url = await uploadMedia(file, { endpoint: uploadEndpoint });
        updateDraft({ cover: url, coverCaption: "" });
      } catch (uploadError) {
        setCoverUploadError(uploadErrorMessage(uploadError));
      } finally {
        setCoverUploading(false);
      }
    },
    [mediaEnabled, updateDraft, uploadEndpoint],
  );

  const shufflePileCover = useCallback(() => {
    const cover = randomPileCover(
      isNoCoverValue(draft.cover) ? "" : draft.cover.trim(),
    );
    if (!cover) return;
    setCoverUploadError(null);
    updateDraft({ cover, coverCaption: "" });
  }, [draft.cover, updateDraft]);

  const removeCover = useCallback(() => {
    setCoverUploadError(null);
    updateDraft({
      cover: draft.type === "article" ? NO_COVER_VALUE : "",
      coverCaption: "",
    });
  }, [draft.type, updateDraft]);

  const uploadGalleryMedia = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      if (!mediaEnabled) {
        setGalleryUploadError(ANONYMOUS_MEDIA_UPLOAD_COPY);
        return;
      }

      setGalleryUploading(true);
      setGalleryUploadError(null);
      try {
        const uploaded: GalleryItem[] = [];
        for (const file of files) {
          const url = await uploadMedia(file, { endpoint: uploadEndpoint });
          uploaded.push({ src: url });
        }
        updateDraftFrom((current) => ({
          ...current,
          gallery: [...current.gallery, ...uploaded],
        }));
      } catch (uploadError) {
        setGalleryUploadError(uploadErrorMessage(uploadError));
      } finally {
        setGalleryUploading(false);
      }
    },
    [mediaEnabled, updateDraftFrom, uploadEndpoint],
  );

  const deriveSlugFromTitle = useCallback(
    (titleValue: string) => {
      if (!autoSlugAllowedRef.current) return;

      const title = titleValue.trim();
      if (isUnsetTitle(title)) return;

      setDraftSnapshot((current) => {
        if (!autoSlugAllowedRef.current) return current;
        if (!isPlaceholderSlug(current.draft.slug)) {
          autoSlugAllowedRef.current = false;
          return { ...current };
        }

        const nextSlug = uniqueSlug(slugify(title, "post"), usedSlugs);
        autoSlugAllowedRef.current = false;
        return nextSlug === current.draft.slug
          ? { ...current }
          : { ...current, draft: { ...current.draft, slug: nextSlug } };
      });
    },
    [usedSlugs],
  );

  useEffect(() => {
    deriveSlugFromTitle(post.title);
  }, [deriveSlugFromTitle, post.id, post.title]);

  const displayPost = useMemo<Post>(
    () => ({
      ...post,
      type: draft.type,
      title: draft.title,
      excerpt: draft.excerpt || undefined,
      cover: draft.cover || undefined,
      coverCaption: draft.coverCaption || undefined,
      coverHeight: draft.coverHeight ?? undefined,
      body: draft.body,
      status: draft.status,
      slug: draft.slug || post.slug,
      accent: draft.accent || undefined,
      gallery: draft.gallery,
      videoUrl: draft.videoUrl || undefined,
      venue: draft.venue || undefined,
      duration: draft.duration || undefined,
    }),
    [draft, post],
  );

  const titleClass =
    displayPost.type === "project"
      ? "project-title edit-title-field"
      : displayPost.type === "talk"
        ? "talk-detail-title edit-title-field"
        : "reader-title edit-title-field";
  const excerptClass =
    displayPost.type === "project"
      ? "reader-dek project-dek edit-excerpt-field"
      : displayPost.type === "talk"
        ? "reader-dek talk-detail-dek edit-excerpt-field"
        : "reader-dek edit-excerpt-field";
  const titleText = displayPost.title.trim() || "Untitled";
  const resolvedHeaderCover = resolveCover(displayPost);
  const hasArticleHeaderImage =
    displayPost.type === "article" && Boolean(resolvedHeaderCover);

  // Folder rows always navigate to the workspace home (saving the draft on
  // the way out), the same sidebar behavior as the home and read shells.
  const selectSidebarFolder = useCallback(
    (folder: SidebarFolderId) => {
      const path = folder === "blog" ? homePath : `${homePath}?folder=${folder}`;
      void saveDraftNow({}, { navigatePath: path });
    },
    [homePath, saveDraftNow],
  );

  const onTitleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Enter") {
        event.preventDefault();
        deriveSlugFromTitle(event.currentTarget.value);
        focusBody();
        return;
      }

      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        focusExcerpt();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusExcerpt();
      }
    },
    [deriveSlugFromTitle, focusBody, focusExcerpt],
  );

  const onExcerptKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Tab") {
        event.preventDefault();
        if (event.shiftKey) {
          focusTitle();
        } else {
          focusBody();
        }
        return;
      }

      if (event.key === "ArrowDown" && textareaCaretOnLastLine(event.currentTarget)) {
        event.preventDefault();
        focusBody();
        return;
      }

      if (event.key === "ArrowUp" && textareaCaretOnFirstLine(event.currentTarget)) {
        event.preventDefault();
        focusTitle();
      }
    },
    [focusBody, focusTitle],
  );

  const onBodyKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Tab" && event.shiftKey) {
        event.preventDefault();
        focusExcerpt();
        return;
      }

      if (event.key === "ArrowUp" && editableCaretOnFirstLine(event.currentTarget)) {
        event.preventDefault();
        focusExcerpt();
      }
    },
    [focusExcerpt],
  );

  const slots = {
    toolbar: (
      <div
        ref={setBodyToolbarHost}
        className="body-editor-toolbar-anchor"
      />
    ),
    title: (
      <textarea
        ref={titleRef}
        id={displayPost.type === "project" ? "project-title" : undefined}
        className={titleClass}
        aria-label="Title"
        placeholder="Give it a title"
        autoFocus={shouldAutoFocusTitle}
        rows={1}
        value={draft.title}
        onChange={(event) =>
          updateDraft({ title: event.currentTarget.value.replace(/[\r\n]+/g, " ") })
        }
        onBlur={(event) => deriveSlugFromTitle(event.currentTarget.value)}
        onKeyDown={onTitleKeyDown}
      />
    ),
    excerpt: (
      <textarea
        ref={excerptRef}
        className={excerptClass}
        aria-label="Excerpt"
        placeholder="Add a short description"
        rows={1}
        value={draft.excerpt}
        onChange={(event) => updateDraft({ excerpt: event.currentTarget.value })}
        onKeyDown={onExcerptKeyDown}
      />
    ),
    body: (
      <div onKeyDown={onBodyKeyDown}>
        <BodyEditor
          ref={bodyRef}
          value={draft.body}
          onChange={(body) => updateDraft({ body })}
          mediaEnabled={mediaEnabled}
          toolbarHost={bodyToolbarHost}
          uploadEndpoint={uploadEndpoint}
          collab={collab}
        />
      </div>
    ),
    cover: hasArticleHeaderImage ? (
      <EditableCover
        title={titleText}
        cover={resolvedHeaderCover}
        coverHeight={draft.coverHeight}
        mediaEnabled={mediaEnabled}
        uploading={coverUploading}
        error={coverUploadError}
        onChangeCover={shufflePileCover}
        onCoverHeightChange={(coverHeight) => updateDraft({ coverHeight })}
        onUploadFile={uploadCover}
        onRemoveCover={removeCover}
      />
    ) : null,
    gallery: (
      <ProjectGallery
        post={displayPost}
        edit={{
          uploading: galleryUploading,
          uploadError: galleryUploadError,
          disabled: !mediaEnabled,
          disabledReason: !mediaEnabled ? ANONYMOUS_MEDIA_UPLOAD_COPY : undefined,
          onAddMedia: uploadGalleryMedia,
          onChange: (gallery) => updateDraft({ gallery }),
        }}
      />
    ),
    stage: (
      <EditableTalkStage
        title={titleText}
        cover={isNoCoverValue(draft.cover) ? "" : draft.cover}
        videoUrl={draft.videoUrl}
        mediaEnabled={mediaEnabled}
        uploading={coverUploading}
        error={coverUploadError}
        onUploadFile={uploadCover}
        onRemove={removeCover}
      />
    ),
    talkMeta: (
      <TalkMetaEditor
        videoUrl={draft.videoUrl}
        venue={draft.venue}
        duration={draft.duration}
        onChange={updateDraft}
      />
    ),
  };

  const requestDeletePost = useCallback(() => {
    if (!postId || deleting) return;
    setError(null);
    setDeleteDialogOpen(true);
  }, [deleting, postId]);

  const moveToFolder = useCallback(
    (folderPath: string) => {
      if (!postId) return;
      void movePostToFolderAction(blog.handle, postId, folderPath)
        .then(() => router.refresh())
        .catch((moveError) => {
          setError(
            moveError instanceof Error && moveError.message
              ? moveError.message
              : "Could not move the post",
          );
        });
    },
    [blog.handle, postId, router],
  );

  const deletePost = useCallback(() => {
    if (!postId || deleting) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    leavingEditRef.current = true;
    setDeleting(true);
    setSaveState("saving");
    setError(null);
    startTransition(() => {
      void deleteEditablePostAction(blog.handle, postId)
        .then(() => {
          setDeleteDialogOpen(false);
          editSessions.delete(postId);
          setDeleting(false);
          setSaveState("saved");
          setError(null);
          if (homePath) {
            router.replace(homePath);
            return;
          }
          router.refresh();
        })
        .catch((deleteError) => {
          leavingEditRef.current = false;
          setDeleting(false);
          setDeleteDialogOpen(false);
          setSaveState("error");
          setError(errorMessage(deleteError, "Could not delete"));
        });
    });
  }, [blog.handle, deleting, homePath, postId, router]);

  const renderedPostPath = blogPostPath(blog, {
    slug: slugify(draft.slug, post.slug),
  });

  return (
    <div
      className={`post-editor-shell applecms has-sidebar${
        sidebarCollapsed ? " is-sidebar-collapsed" : ""
      } is-edit-workspace-shell`}
    >
      <WorkspaceSidebarChrome
        blog={blog}
        activeFolder={sidebarFolderPathForPostType(post.type)}
        canManageFolders={canManagePost}
        canManageSharing={canManagePost}
        collapsed={sidebarCollapsed}
        counts={counts}
        folders={folders}
        homePath={homePath}
        onSelectFolder={selectSidebarFolder}
        onToggleCollapsed={toggleSidebarCollapsed}
      />
      <div className="post-editor-content">
        <PostActionBar
          mode="edit"
          owner={canManagePost}
          canEditPost
          canManagePost={canManagePost}
          blog={blog}
          post={post}
          adjacent={adjacent}
          homePath={homePath}
          postPath={renderedPostPath}
          draft={draft}
          deleting={deleting}
          hasHeaderImage={hasArticleHeaderImage}
          folders={folders}
          onDelete={requestDeletePost}
          onDone={() => saveDraftNow({}, { exitEdit: true })}
          onAddHeaderImage={shufflePileCover}
          onMoveToFolder={moveToFolder}
          onNavigate={(path) => saveDraftNow({}, { navigatePath: path })}
          onSlugBlur={() => {
            autoSlugAllowedRef.current = false;
            updateDraft({ slug: slugify(draft.slug, currentSlugRef.current) });
          }}
          onSlugInput={(value) => {
            autoSlugAllowedRef.current = false;
            updateDraft({ slug: slugify(value, "") });
          }}
          onUpdateDraft={updateDraft}
          onVisibilityChange={(status) =>
            saveDraftNow({ status }, { exitEdit: true })
          }
        />
        <SaveStatusPill saveState={saveState} error={error} />

        {displayPost.type === "talk" ? (
          <TalkReader blog={blog} post={displayPost} slots={slots} />
        ) : displayPost.type === "project" ? (
          <ProjectReader blog={blog} post={displayPost} slots={slots} />
        ) : (
          <Reader blog={blog} post={displayPost} slots={slots} />
        )}
      </div>
      <ConfirmationDialog
        open={deleteDialogOpen}
        title="Delete post?"
        message="This moves the post to Trash."
        confirmLabel="Delete"
        confirmingLabel="Deleting"
        confirming={deleting}
        onCancel={() => setDeleteDialogOpen(false)}
        onConfirm={deletePost}
      />
    </div>
  );
}
