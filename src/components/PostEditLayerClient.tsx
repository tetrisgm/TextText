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
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import {
  deleteEditablePostAction,
  movePostToFolderAction,
  saveEditablePostAction,
} from "@/app/editor/actions";
import { ProjectGallery } from "@/components/ProjectGallery";
import { ProjectReader } from "@/components/ProjectReader";
import { Reader } from "@/components/Reader";
import { TalkReader } from "@/components/TalkReader";
import {
  WorkspaceSidebarChrome,
  closeExpandedWorkspaceSidebar,
  finishEditTransition,
  sidebarFolderPathForPostType,
  useWorkspaceSidebarCollapsed,
} from "@/components/PostWorkspaceShell";
import type { SidebarFolderId } from "@/components/PostWorkspaceShell";
import type { Blog, Folder, GalleryItem, Post } from "@/lib/content";
import { isVideoFile, isYouTube, youtubeEmbedUrl } from "@/lib/content";
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
import type {
  BodyEditorHandle,
  BodyEditorCollab,
} from "@/components/BodyEditor";
import type { PresencePeer } from "@/lib/collab/provider";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { hasOpenEditMenu } from "@/components/PostShortcuts";
import {
  EditProjectReaderPreview,
  EditReaderPreview,
  EditTalkReaderPreview,
} from "@/components/editor/EditReaderPreview";
import { EditableCover, randomCover } from "@/components/editor/EditableCover";
import { isNoCoverValue, NO_COVER_VALUE, resolveCover } from "@/lib/cover";
import { COVER_PILE } from "@/lib/cover-pile";
import { blogPostEditPath, blogPostPath } from "@/lib/public-paths";
import { ANONYMOUS_MEDIA_UPLOAD_COPY } from "@/lib/product-limits";
import {
  deletePersistedWorkspaceDraft,
  persistWorkspaceDraft,
  readPersistedWorkspaceDraft,
} from "@/lib/pool/storage";

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

function samePresencePeers(
  current: readonly PresencePeer[],
  next: readonly PresencePeer[],
): boolean {
  return (
    current.length === next.length &&
    current.every(
      (peer, index) =>
        peer.clientId === next[index]?.clientId &&
        peer.userName === next[index]?.userName &&
        peer.color === next[index]?.color,
    )
  );
}

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
          onChange={(event) =>
            onChange({ videoUrl: event.currentTarget.value })
          }
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
          onChange={(event) =>
            onChange({ duration: event.currentTarget.value })
          }
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

export type PostEditLayerProps = {
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
  canCommentPost?: boolean;
  canManagePost?: boolean;
  workspaceBlogId?: string;
};

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
  canCommentPost = true,
  canManagePost = true,
  workspaceBlogId,
}: PostEditLayerProps) {
  const router = useRouter();
  const [initialSessionState] = useState(() => {
    const fromMemory = Boolean(post.id && editSessions.has(post.id));
    return { fromMemory, session: getEditSession(post) };
  });
  const initialSession = initialSessionState.session;
  const [draftSnapshot, setDraftSnapshot] = useState<DraftSnapshot>(() => ({
    postId: post.id,
    draft: initialSession.draft,
  }));
  const draft = draftSnapshot.draft;
  const draftRef = useRef(draft);
  const [draftHydrated, setDraftHydrated] = useState(
    () => !post.id || initialSessionState.fromMemory,
  );
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
  const [galleryUploadError, setGalleryUploadError] = useState<string | null>(
    null,
  );
  const [bodyToolbarHost, setBodyToolbarHost] = useState<HTMLDivElement | null>(
    null,
  );
  const [presencePeers, setPresencePeers] = useState<PresencePeer[]>([]);
  const [surfaceMode, setSurfaceMode] = useState<"read" | "edit">("edit");
  const { sidebarCollapsed, toggleSidebarCollapsed } =
    useWorkspaceSidebarCollapsed(initialSidebarCollapsed);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const excerptRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<BodyEditorHandle>(null);
  const editSurfaceRef = useRef<HTMLDivElement>(null);
  const lastEditFocusRef = useRef<HTMLElement | null>(null);
  const surfaceModeRef = useRef<"read" | "edit">("edit");
  const pendingScrollRestoreRef = useRef<{
    left: number;
    top: number;
  } | null>(null);
  const currentSlugRef = useRef(initialSession.currentSlug);
  const baseUpdatedAtRef = useRef(post.updatedAt);
  const autoSlugAllowedRef = useRef(initialSession.autoSlugAllowed);
  const latestKeyRef = useRef(initialSession.lastSavedKey);
  const lastSavedKeyRef = useRef(initialSession.lastSavedKey);
  const saveTimerRef = useRef<number | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draftRevisionRef = useRef(0);
  const editorMountedRef = useRef(true);
  const coverRevisionRef = useRef(0);
  const leavingEditRef = useRef(false);
  const postId = post.id;
  const draftBlogId = workspaceBlogId ?? blog.handle;
  const uploadEndpoint = mediaUploadEndpointForHandle(blog.handle);

  useEffect(() => {
    if (!postId || initialSessionState.fromMemory) return;

    let cancelled = false;
    const requestedRevision = draftRevisionRef.current;
    void readPersistedWorkspaceDraft(draftBlogId, postId).then((persisted) => {
      if (cancelled) return;
      if (persisted && draftRevisionRef.current === requestedRevision) {
        const nextDraft = persisted.draft;
        draftRef.current = nextDraft;
        baseUpdatedAtRef.current =
          persisted.baseUpdatedAt ?? baseUpdatedAtRef.current;
        latestKeyRef.current = persisted.key;
        currentSlugRef.current = nextDraft.slug || currentSlugRef.current;
        draftRevisionRef.current += 1;
        patchEditSession(postId, {
          draft: nextDraft,
          currentSlug: currentSlugRef.current,
          autoSlugAllowed: autoSlugAllowedRef.current,
        });
        setDraftSnapshot({ postId, draft: nextDraft });
      }
      setDraftHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, [draftBlogId, initialSessionState.fromMemory, postId]);

  useLayoutEffect(() => {
    if (postId) finishEditTransition(postId);
  }, [postId]);

  const focusTitle = useCallback(() => {
    focusTextareaEnd(titleRef.current);
  }, []);

  const focusExcerpt = useCallback(() => {
    focusTextareaEnd(excerptRef.current);
  }, []);

  const focusBody = useCallback(() => {
    bodyRef.current?.focus();
  }, []);

  const updatePresencePeers = useCallback((peers: PresencePeer[]) => {
    setPresencePeers((current) =>
      samePresencePeers(current, peers) ? current : peers,
    );
  }, []);

  useEffect(() => {
    autoGrow(titleRef.current);
  }, [draft.title, draft.type]);

  useEffect(() => {
    autoGrow(excerptRef.current);
  }, [draft.excerpt, draft.type]);

  const shouldAutoFocusTitle = shouldFocusTitleOnEdit(post);

  useLayoutEffect(() => {
    if (!shouldAutoFocusTitle) return;
    const title = titleRef.current;
    if (!title) return;
    title.focus({ preventScroll: true });
    title.setSelectionRange(title.value.length, title.value.length);
  }, [post.id, shouldAutoFocusTitle]);

  useLayoutEffect(() => {
    draftRef.current = draft;
    if (draftSnapshot.postId !== postId) return;
    patchEditSession(postId, {
      draft,
      currentSlug: currentSlugRef.current,
      autoSlugAllowed: autoSlugAllowedRef.current,
      lastSavedKey: lastSavedKeyRef.current,
    });
  }, [draft, draftSnapshot.postId, postId]);

  useEffect(() => {
    editorMountedRef.current = true;
    return () => {
      editorMountedRef.current = false;
      coverRevisionRef.current += 1;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const enqueueSave = useCallback(
    (
      nextDraft: DraftState,
      options: { onlyIfCurrent?: boolean; revalidate?: boolean } = {},
    ) => {
      if (!postId) return Promise.resolve(null);
      const requestedKey = payloadKey(
        payloadFor(postId, nextDraft, currentSlugRef.current),
      );
      const requestedRevision = draftRevisionRef.current;
      const queued = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (
            options.onlyIfCurrent &&
            (latestKeyRef.current !== requestedKey ||
              draftRevisionRef.current !== requestedRevision)
          ) {
            return null;
          }
          if (lastSavedKeyRef.current === requestedKey) return null;
          const payload = payloadFor(
            postId,
            nextDraft,
            currentSlugRef.current,
            baseUpdatedAtRef.current,
          );
          const saved = await saveEditablePostAction(blog.handle, payload, {
            revalidate: options.revalidate,
          });
          // Advance the server revision even when this response has already
          // been superseded. The response itself never replaces a newer draft.
          baseUpdatedAtRef.current = saved.updatedAt;
          return { requestedKey, requestedRevision, saved };
        });
      saveQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [blog.handle, postId],
  );

  // Unload-safe materialization. The autosave above is a server action that
  // cannot complete during a tab close, so on pagehide beacon the current body
  // to the collab materialize endpoint. Only for the co-editing shell, and only
  // when there are unsaved changes; the server no-ops if the body already
  // matches. Complements the CollabProvider's own pagehide beacon (which flushes
  // the Yjs log) by keeping the canonical posts.body current too.
  useEffect(() => {
    if (!postId || !collab?.canEdit) return;
    const onPageHide = () => {
      if (lastSavedKeyRef.current === latestKeyRef.current) return;
      if (
        typeof navigator === "undefined" ||
        typeof navigator.sendBeacon !== "function"
      ) {
        return;
      }
      const payload = JSON.stringify({
        handle: blog.handle,
        body: draftRef.current.body,
      });
      navigator.sendBeacon(
        `/api/collab/${postId}/materialize`,
        new Blob([payload], { type: "application/json" }),
      );
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [postId, collab?.canEdit, blog.handle]);

  useEffect(() => {
    if (!postId) return;
    if (!draftHydrated) return;

    if (draftSnapshot.postId !== postId) return;

    const key = payloadKey(payloadFor(postId, draft, currentSlugRef.current));
    latestKeyRef.current = key;
    patchEditSession(postId, {
      draft,
      currentSlug: currentSlugRef.current,
      autoSlugAllowed: autoSlugAllowedRef.current,
    });

    if (key === lastSavedKeyRef.current) {
      setSaveState("saved");
      void deletePersistedWorkspaceDraft(draftBlogId, postId, key);
      return;
    }

    setSaveState("saving");
    setError(null);

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;

      startTransition(() => {
        void enqueueSave(draft, {
          onlyIfCurrent: true,
          revalidate: false,
        })
          .then((result) => {
            if (
              !result ||
              latestKeyRef.current !== result.requestedKey ||
              draftRevisionRef.current !== result.requestedRevision
            ) {
              return;
            }
            const { saved } = result;
            lastSavedKeyRef.current = result.requestedKey;
            patchEditSession(postId, { lastSavedKey: result.requestedKey });
            void deletePersistedWorkspaceDraft(
              draftBlogId,
              postId,
              result.requestedKey,
            );
            setSaveState("saved");
            setError(null);

            if (saved.slug !== currentSlugRef.current) {
              currentSlugRef.current = saved.slug;
              patchEditSession(postId, { currentSlug: saved.slug });
              if (!leavingEditRef.current) {
                window.history.replaceState(
                  window.history.state,
                  "",
                  surfaceModeRef.current === "edit"
                    ? blogPostEditPath(blog, saved)
                    : blogPostPath(blog, saved),
                );
              }
            }

            if (saved.slug !== draftRef.current.slug) {
              draftRef.current = { ...draftRef.current, slug: saved.slug };
              setDraftSnapshot((current) => ({
                ...current,
                draft: { ...current.draft, slug: saved.slug },
              }));
            }
          })
          .catch((saveError) => {
            if (latestKeyRef.current !== key) return;
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
  }, [
    blog,
    draft,
    draftBlogId,
    draftHydrated,
    draftSnapshot.postId,
    enqueueSave,
    postId,
    router,
  ]);

  const updateDraft = useCallback(
    (patch: Partial<DraftState>) => {
      const nextDraft = { ...draftRef.current, ...patch };
      draftRef.current = nextDraft;
      draftRevisionRef.current += 1;
      if (postId) {
        latestKeyRef.current = payloadKey(
          payloadFor(postId, nextDraft, currentSlugRef.current),
        );
        void persistWorkspaceDraft({
          blogId: draftBlogId,
          postId,
          draft: nextDraft,
          key: latestKeyRef.current,
          baseUpdatedAt: baseUpdatedAtRef.current,
          persistedAt: new Date().toISOString(),
        });
      }
      setDraftSnapshot((current) => ({ ...current, draft: nextDraft }));
    },
    [draftBlogId, postId],
  );

  const updateDraftFrom = useCallback(
    (updater: (draft: DraftState) => DraftState) => {
      const nextDraft = updater(draftRef.current);
      draftRef.current = nextDraft;
      draftRevisionRef.current += 1;
      if (postId) {
        latestKeyRef.current = payloadKey(
          payloadFor(postId, nextDraft, currentSlugRef.current),
        );
        void persistWorkspaceDraft({
          blogId: draftBlogId,
          postId,
          draft: nextDraft,
          key: latestKeyRef.current,
          baseUpdatedAt: baseUpdatedAtRef.current,
          persistedAt: new Date().toISOString(),
        });
      }
      setDraftSnapshot((current) => ({ ...current, draft: nextDraft }));
    },
    [draftBlogId, postId],
  );
  const containingFolderPath = useMemo(() => {
    const folder = post.folderId
      ? folders.find((entry) => entry.id === post.folderId)
      : null;
    return folder?.path ?? sidebarFolderPathForPostType(post.type);
  }, [folders, post.folderId, post.type]);
  const containingFolderHref = useMemo(
    () => `${homePath}?folder=${encodeURIComponent(containingFolderPath)}`,
    [containingFolderPath, homePath],
  );

  const saveDraftNow = useCallback(
    async (
      patch: Partial<DraftState> = {},
      options: { navigatePath?: string } = {},
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

      const nextDraft = { ...draftRef.current, ...patch };
      if (Object.keys(patch).length > 0) {
        draftRef.current = nextDraft;
        draftRevisionRef.current += 1;
        setDraftSnapshot((current) => ({ ...current, draft: nextDraft }));
      }
      const leavingEdit = Boolean(options.navigatePath);
      if (leavingEdit) leavingEditRef.current = true;

      const navigateAfterSave = () => {
        if (leavingEdit && postId) {
          // The newest local snapshot has been acknowledged, so the transient
          // session can be discarded without resurrecting an older draft.
          editSessions.delete(postId);
        }
        if (options.navigatePath) {
          router.push(options.navigatePath);
        }
      };

      setSaveState("saving");
      setError(null);

      try {
        while (true) {
          const targetDraft = draftRef.current;
          const targetRevision = draftRevisionRef.current;
          const targetKey = payloadKey(
            payloadFor(postId, targetDraft, currentSlugRef.current),
          );
          latestKeyRef.current = targetKey;
          patchEditSession(postId, {
            draft: targetDraft,
            currentSlug: currentSlugRef.current,
            autoSlugAllowed: autoSlugAllowedRef.current,
          });

          if (targetKey === lastSavedKeyRef.current) {
            await deletePersistedWorkspaceDraft(draftBlogId, postId, targetKey);
            setSaveState("saved");
            setError(null);
            navigateAfterSave();
            return;
          }

          const result = await enqueueSave(targetDraft, { revalidate: true });
          if (
            !result ||
            draftRevisionRef.current !== targetRevision ||
            latestKeyRef.current !== targetKey
          ) {
            continue;
          }

          const { saved } = result;
          lastSavedKeyRef.current = targetKey;
          patchEditSession(postId, { lastSavedKey: targetKey });
          await deletePersistedWorkspaceDraft(draftBlogId, postId, targetKey);
          setSaveState("saved");
          setError(null);

          if (saved.slug !== currentSlugRef.current) {
            currentSlugRef.current = saved.slug;
            patchEditSession(postId, { currentSlug: saved.slug });
          }

          let savedDraft = targetDraft;
          if (saved.slug !== targetDraft.slug) {
            savedDraft = { ...targetDraft, slug: saved.slug };
            draftRef.current = savedDraft;
            setDraftSnapshot((current) => ({
              ...current,
              draft: savedDraft,
            }));
          }
          if (!options.navigatePath) {
            window.history.replaceState(
              window.history.state,
              "",
              surfaceModeRef.current === "edit"
                ? blogPostEditPath(blog, saved)
                : blogPostPath(blog, saved),
            );
          }

          navigateAfterSave();
          return;
        }
      } catch (saveError) {
        if (leavingEdit) leavingEditRef.current = false;
        setSaveState("error");
        setError(errorMessage(saveError, "Could not save"));
      }
    },
    [blog, draftBlogId, enqueueSave, postId, router],
  );

  const pathForSurfaceMode = useCallback(
    (mode: "read" | "edit") => {
      const item = {
        id: postId,
        slug: slugify(draftRef.current.slug, currentSlugRef.current),
      };
      return mode === "edit"
        ? blogPostEditPath(blog, item)
        : blogPostPath(blog, item);
    },
    [blog, postId],
  );

  const changeSurfaceMode = useCallback(
    (nextMode: "read" | "edit", updateHistory = true) => {
      if (surfaceModeRef.current === nextMode) return;
      if (surfaceModeRef.current === "edit") {
        const activeElement = document.activeElement;
        if (
          activeElement instanceof HTMLElement &&
          editSurfaceRef.current?.contains(activeElement)
        ) {
          lastEditFocusRef.current = activeElement;
        }
      }
      pendingScrollRestoreRef.current = {
        left: window.scrollX,
        top: window.scrollY,
      };
      surfaceModeRef.current = nextMode;
      setSurfaceMode(nextMode);
      if (updateHistory) {
        window.history.pushState(
          window.history.state,
          "",
          pathForSurfaceMode(nextMode),
        );
      }
    },
    [pathForSurfaceMode],
  );

  useLayoutEffect(() => {
    if (surfaceMode === "edit") {
      lastEditFocusRef.current?.focus({ preventScroll: true });
    }
    const pending = pendingScrollRestoreRef.current;
    if (!pending) return;
    pendingScrollRestoreRef.current = null;
    window.scrollTo({
      left: pending.left,
      top: pending.top,
      behavior: "auto",
    });
  }, [surfaceMode]);

  const stopEditingLocally = useCallback(
    (patch: Partial<DraftState> = {}) => {
      changeSurfaceMode("read");
      void saveDraftNow(patch);
    },
    [changeSurfaceMode, saveDraftNow],
  );

  const startEditingLocally = useCallback(() => {
    changeSurfaceMode("edit");
  }, [changeSurfaceMode]);

  useEffect(() => {
    const onPopState = () => {
      const nextMode =
        new URL(window.location.href).searchParams.get("edit") === "1"
          ? "edit"
          : "read";
      const previousMode = surfaceModeRef.current;
      changeSurfaceMode(nextMode, false);
      if (previousMode === "edit" && nextMode === "read") {
        void saveDraftNow();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [changeSurfaceMode, saveDraftNow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      // Cmd/Ctrl-E toggles back to reading (the reader binds the same chord to
      // enter edit), so one key flips edit and read in both directions.
      const isToggleEdit =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "e";
      if (isToggleEdit) {
        if (hasOpenEditMenu()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (leavingEditRef.current) return;
        if (surfaceModeRef.current === "edit") stopEditingLocally();
        else startEditingLocally();
        return;
      }

      if (event.key !== "Escape") return;
      if (hasOpenEditMenu()) return;

      // An expanded sidebar consumes Escape first; exiting edit is the last resort.
      if (closeExpandedWorkspaceSidebar()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (surfaceModeRef.current === "read") return;

      event.preventDefault();
      event.stopImmediatePropagation();
      if (leavingEditRef.current) return;
      stopEditingLocally();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [startEditingLocally, stopEditingLocally]);

  const uploadCover = useCallback(
    async (file: File) => {
      if (!mediaEnabled) {
        setCoverUploadError(ANONYMOUS_MEDIA_UPLOAD_COPY);
        return;
      }
      const uploadRevision = coverRevisionRef.current + 1;
      coverRevisionRef.current = uploadRevision;
      setCoverUploading(true);
      setCoverUploadError(null);
      try {
        const url = await uploadMedia(file, { endpoint: uploadEndpoint });
        if (
          editorMountedRef.current &&
          coverRevisionRef.current === uploadRevision
        ) {
          coverRevisionRef.current += 1;
          updateDraft({ cover: url, coverCaption: "" });
        }
      } catch (uploadError) {
        setCoverUploadError(uploadErrorMessage(uploadError));
      } finally {
        if (editorMountedRef.current) setCoverUploading(false);
      }
    },
    [mediaEnabled, updateDraft, uploadEndpoint],
  );

  const shufflePileCover = useCallback(() => {
    const cover = randomCover(
      COVER_PILE,
      isNoCoverValue(draft.cover) ? "" : draft.cover.trim(),
    );
    if (!cover) return;
    coverRevisionRef.current += 1;
    setCoverUploadError(null);
    updateDraft({ cover, coverCaption: "" });
  }, [draft.cover, updateDraft]);

  const selectPileCover = useCallback(
    (cover: string) => {
      coverRevisionRef.current += 1;
      setCoverUploadError(null);
      updateDraft({ cover, coverCaption: "" });
    },
    [updateDraft],
  );

  const removeCover = useCallback(() => {
    coverRevisionRef.current += 1;
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

      const current = draftRef.current;
      if (!isPlaceholderSlug(current.slug)) {
        autoSlugAllowedRef.current = false;
        return;
      }

      const nextSlug = uniqueSlug(slugify(title, "post"), usedSlugs);
      autoSlugAllowedRef.current = false;
      if (nextSlug !== current.slug) updateDraft({ slug: nextSlug });
    },
    [updateDraft, usedSlugs],
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
  const excerptPlaceholder =
    displayPost.type === "bookmark"
      ? "Add a description"
      : "Add a short description";
  const titleText = displayPost.title.trim() || "Untitled";
  const resolvedHeaderCover = resolveCover(displayPost);
  const hasArticleHeaderImage =
    displayPost.type === "article" && Boolean(resolvedHeaderCover);

  // Folder rows always navigate to the workspace home (saving the draft on
  // the way out), the same sidebar behavior as the home and read shells.
  const selectSidebarFolder = useCallback(
    (folder: SidebarFolderId) => {
      const path = `${homePath}?folder=${encodeURIComponent(folder)}`;
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

      if (
        event.key === "ArrowDown" &&
        textareaCaretOnLastLine(event.currentTarget)
      ) {
        event.preventDefault();
        focusBody();
        return;
      }

      if (
        event.key === "ArrowUp" &&
        textareaCaretOnFirstLine(event.currentTarget)
      ) {
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

      if (
        event.key === "ArrowUp" &&
        editableCaretOnFirstLine(event.currentTarget)
      ) {
        event.preventDefault();
        focusExcerpt();
      }
    },
    [focusExcerpt],
  );

  const slots = {
    title: (
      <textarea
        ref={titleRef}
        id={displayPost.type === "project" ? "project-title" : undefined}
        className={titleClass}
        aria-label="Title"
        placeholder="Give it a title"
        rows={1}
        value={draft.title}
        onChange={(event) =>
          updateDraft({
            title: event.currentTarget.value.replace(/[\r\n]+/g, " "),
          })
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
        placeholder={excerptPlaceholder}
        rows={1}
        value={draft.excerpt}
        onChange={(event) =>
          updateDraft({ excerpt: event.currentTarget.value })
        }
        onKeyDown={onExcerptKeyDown}
      />
    ),
    body: (
      <div onKeyDown={onBodyKeyDown}>
        <div ref={setBodyToolbarHost} className="body-editor-toolbar-anchor" />
        <BodyEditor
          ref={bodyRef}
          value={draft.body}
          onChange={(body) => updateDraft({ body })}
          mediaEnabled={mediaEnabled}
          postType={displayPost.type}
          toolbarHost={bodyToolbarHost}
          uploadEndpoint={uploadEndpoint}
          collab={collab}
          onPresence={updatePresencePeers}
        />
      </div>
    ),
    cover: hasArticleHeaderImage ? (
      <EditableCover
        title={titleText}
        cover={resolvedHeaderCover}
        covers={COVER_PILE}
        coverHeight={draft.coverHeight}
        mediaEnabled={mediaEnabled}
        uploading={coverUploading}
        error={coverUploadError}
        onSelectCover={selectPileCover}
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
          disabledReason: !mediaEnabled
            ? ANONYMOUS_MEDIA_UPLOAD_COPY
            : undefined,
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
        .then(async () => {
          await deletePersistedWorkspaceDraft(draftBlogId, postId);
          setDeleteDialogOpen(false);
          editSessions.delete(postId);
          setDeleting(false);
          setSaveState("saved");
          setError(null);
          if (containingFolderHref) {
            router.replace(containingFolderHref);
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
  }, [
    blog.handle,
    containingFolderHref,
    deleting,
    draftBlogId,
    postId,
    router,
  ]);

  const renderedPostPath = blogPostPath(blog, {
    slug: slugify(draft.slug, post.slug),
  });
  const ReaderComponent =
    displayPost.type === "talk"
      ? TalkReader
      : displayPost.type === "project"
        ? ProjectReader
        : Reader;
  const navigateFromRead = useCallback(
    (path: string) => {
      const url = new URL(path, window.location.origin);
      if (url.searchParams.get("edit") === "1") {
        startEditingLocally();
        return;
      }
      void saveDraftNow({}, { navigatePath: path });
    },
    [saveDraftNow, startEditingLocally],
  );

  return (
    <div
      data-write-edit-surface="true"
      data-write-edit-post-id={postId}
      data-write-draft-hydrated={draftHydrated ? "true" : "false"}
      aria-busy={!draftHydrated}
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
        <div hidden={surfaceMode === "edit"}>
          <PostActionBar
            mode="read"
            owner={canManagePost}
            canCommentPost={canCommentPost}
            canEditPost
            canManagePost={canManagePost}
            blog={blog}
            post={displayPost}
            adjacent={adjacent}
            homePath={containingFolderHref}
            postPath={renderedPostPath}
            presencePeers={collab ? presencePeers : []}
            onNavigate={navigateFromRead}
          />
          <SaveStatusPill saveState={saveState} error={error} />
          <ReaderComponent blog={blog} post={displayPost} />
        </div>
        <div ref={editSurfaceRef} hidden={surfaceMode === "read"}>
          <PostActionBar
            mode="edit"
            owner={canManagePost}
            canCommentPost={canCommentPost}
            canEditPost
            canManagePost={canManagePost}
            blog={blog}
            post={post}
            adjacent={adjacent}
            homePath={homePath}
            postPath={renderedPostPath}
            presencePeers={collab ? presencePeers : []}
            draft={draft}
            deleting={deleting}
            hasHeaderImage={hasArticleHeaderImage}
            folders={folders}
            onDelete={requestDeletePost}
            onDone={async () => stopEditingLocally()}
            onAddHeaderImage={shufflePileCover}
            onMoveToFolder={moveToFolder}
            onNavigate={(path) => saveDraftNow({}, { navigatePath: path })}
            onSlugBlur={() => {
              autoSlugAllowedRef.current = false;
              updateDraft({
                slug: slugify(draft.slug, currentSlugRef.current),
              });
            }}
            onSlugInput={(value) => {
              autoSlugAllowedRef.current = false;
              updateDraft({ slug: slugify(value, "") });
            }}
            onUpdateDraft={updateDraft}
            onVisibilityChange={async (status) =>
              stopEditingLocally({ status })
            }
          />
          <SaveStatusPill saveState={saveState} error={error} />

          {displayPost.type === "talk" ? (
            <EditTalkReaderPreview
              blog={blog}
              post={displayPost}
              slots={slots}
            />
          ) : displayPost.type === "project" ? (
            <EditProjectReaderPreview
              blog={blog}
              post={displayPost}
              slots={slots}
            />
          ) : (
            <EditReaderPreview blog={blog} post={displayPost} slots={slots} />
          )}
        </div>
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
