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
import { useRouter } from "next/navigation";
import { deleteEditablePostAction, saveEditablePostAction } from "@/app/editor/actions";
import { ProjectGallery } from "@/components/ProjectGallery";
import type { Blog, GalleryItem, Post } from "@/lib/content";
import {
  isVideoFile,
  isYouTube,
  youtubeEmbedUrl,
} from "@/lib/content";
import { MediaUploadError, uploadMedia } from "@/lib/upload";
import type { AdjacentPublishedPosts } from "@/lib/store";
import {
  initialDraft,
  isPlaceholderSlug,
  payloadFor,
  payloadKey,
  postPath,
  slugify,
  uniqueSlug,
} from "@/lib/post-edit-draft";
import type { DraftState, SaveState } from "@/lib/post-edit-draft";
import { PostActionBar } from "@/components/PostActionBar";
import { ProjectReader } from "@/components/ProjectReader";
import { Reader } from "@/components/Reader";
import { TalkReader } from "@/components/TalkReader";

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

function autoGrow(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.style.height = "0px";
  node.style.height = `${node.scrollHeight}px`;
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

function EditableCover({
  title,
  cover,
  caption,
  uploading,
  error,
  onUploadFile,
  onCaptionChange,
  onRemove,
}: {
  title: string;
  cover: string;
  caption: string;
  uploading: boolean;
  error: string | null;
  onUploadFile: (file: File) => void;
  onCaptionChange: (caption: string) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const chooseFile = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onUploadFile(file);
  };

  const input = (
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
  );

  if (!cover) {
    return (
      <div className="reader-cover edit-cover-empty applecms">
        {input}
        <button
          type="button"
          className="edit-cover-empty-button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Uploading" : "Add cover"}
        </button>
        {error && (
          <span className="edit-cover-error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <figure className="reader-cover edit-cover applecms">
      <div className="edit-cover-media">
        {input}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cover} alt={title} />
        <div className="edit-cover-toolbar">
          <button
            type="button"
            className="edit-cover-action"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading" : "Change"}
          </button>
          <button
            type="button"
            className="edit-cover-action"
            disabled={uploading}
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
      </div>
      <figcaption className="reader-figcaption edit-cover-caption">
        <input
          className="edit-cover-caption-input"
          value={caption}
          placeholder="Add caption"
          aria-label="Cover caption"
          onChange={(event) => onCaptionChange(event.currentTarget.value)}
        />
      </figcaption>
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
  uploading,
  error,
  onUploadFile,
  onRemove,
}: {
  title: string;
  cover: string;
  videoUrl: string;
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
          <button
            type="button"
            className="edit-cover-empty-button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading" : "Add cover"}
          </button>
        </div>
      )}
      {canEditCover && !empty && (
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

function isEmptyNewPost(post: Post): boolean {
  return (
    post.status === "draft" &&
    isPlaceholderSlug(post.slug) &&
    !post.title.trim() &&
    !post.excerpt?.trim() &&
    !post.body.trim() &&
    !post.cover?.trim() &&
    !(post.gallery && post.gallery.length > 0) &&
    !post.videoUrl?.trim()
  );
}

export function PostEditLayer({
  blog,
  post,
  adjacent,
  homePath,
  usedSlugs = [],
}: {
  blog: Blog;
  post: Post;
  adjacent: AdjacentPublishedPosts;
  homePath: string;
  usedSlugs?: string[];
}) {
  const router = useRouter();
  const initialSession = getEditSession(post);
  const [draftSnapshot, setDraftSnapshot] = useState<DraftSnapshot>(() => ({
    postId: post.id,
    draft: initialSession.draft,
  }));
  const draft = draftSnapshot.draft;
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryUploadError, setGalleryUploadError] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const excerptRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const currentSlugRef = useRef(initialSession.currentSlug);
  const autoSlugAllowedRef = useRef(initialSession.autoSlugAllowed);
  const latestKeyRef = useRef(initialSession.lastSavedKey);
  const lastSavedKeyRef = useRef(initialSession.lastSavedKey);
  const saveTimerRef = useRef<number | null>(null);
  const leavingEditRef = useRef(false);
  const postId = post.id;

  useEffect(() => {
    const session = getEditSession(post);
    setDraftSnapshot({ postId: post.id, draft: session.draft });
    setSaveState("saved");
    setError(null);
    setCoverUploading(false);
    setCoverUploadError(null);
    setGalleryUploading(false);
    setGalleryUploadError(null);
    currentSlugRef.current = session.currentSlug;
    autoSlugAllowedRef.current = session.autoSlugAllowed;
    latestKeyRef.current = session.lastSavedKey;
    lastSavedKeyRef.current = session.lastSavedKey;
    leavingEditRef.current = false;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [post.id]);

  useEffect(() => {
    autoGrow(titleRef.current);
  }, [draft.title, draft.type]);

  useEffect(() => {
    autoGrow(excerptRef.current);
  }, [draft.excerpt, draft.type]);

  useEffect(() => {
    autoGrow(bodyRef.current);
  }, [draft.body, draft.type]);

  useEffect(() => {
    if (!isEmptyNewPost(post)) return;
    const title = titleRef.current;
    if (!title) return;
    title.focus({ preventScroll: true });
    title.setSelectionRange(title.value.length, title.value.length);
  }, [post.id, post.slug, post]);

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
    if (!postId) {
      setSaveState("error");
      setError("Post cannot be edited");
      return;
    }

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
        void saveEditablePostAction(payload)
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
                router.replace(`${postPath(blog.handle, saved.slug)}?edit=1`, {
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
  }, [blog.handle, draft, draftSnapshot.postId, postId, router]);

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
        if (options.navigatePath) {
          router.push(options.navigatePath);
          return;
        }
        if (options.exitEdit) {
          router.replace(postPath(blog.handle, slug), { scroll: false });
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
        const saved = await saveEditablePostAction(payload);
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
    [blog.handle, draft, postId, router],
  );

  const uploadCover = useCallback(
    async (file: File) => {
      setCoverUploading(true);
      setCoverUploadError(null);
      try {
        const url = await uploadMedia(file);
        updateDraft({ cover: url });
      } catch (uploadError) {
        setCoverUploadError(uploadErrorMessage(uploadError));
      } finally {
        setCoverUploading(false);
      }
    },
    [updateDraft],
  );

  const removeCover = useCallback(() => {
    setCoverUploadError(null);
    updateDraft({ cover: "", coverCaption: "" });
  }, [updateDraft]);

  const uploadGalleryImages = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      setGalleryUploading(true);
      setGalleryUploadError(null);
      try {
        const uploaded: GalleryItem[] = [];
        for (const file of files) {
          const url = await uploadMedia(file);
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
    [updateDraftFrom],
  );

  const deriveSlugFromTitle = useCallback(
    (titleValue: string) => {
      if (!autoSlugAllowedRef.current) return;

      const title = titleValue.trim();
      if (!title || title.toLowerCase() === "untitled") return;

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
        onChange={(event) => updateDraft({ title: event.currentTarget.value })}
        onBlur={(event) => deriveSlugFromTitle(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            deriveSlugFromTitle(event.currentTarget.value);
            bodyRef.current?.focus();
          }
        }}
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
      />
    ),
    body: (
      <textarea
        ref={bodyRef}
        className="edit-body-field"
        aria-label="Body"
        placeholder="Start writing"
        value={draft.body}
        onChange={(event) => updateDraft({ body: event.currentTarget.value })}
      />
    ),
    cover: (
      <EditableCover
        title={titleText}
        cover={draft.cover}
        caption={draft.coverCaption}
        uploading={coverUploading}
        error={coverUploadError}
        onUploadFile={uploadCover}
        onCaptionChange={(coverCaption) => updateDraft({ coverCaption })}
        onRemove={removeCover}
      />
    ),
    gallery: (
      <ProjectGallery
        post={displayPost}
        edit={{
          uploading: galleryUploading,
          uploadError: galleryUploadError,
          onAddImages: uploadGalleryImages,
          onChange: (gallery) => updateDraft({ gallery }),
        }}
      />
    ),
    stage: (
      <EditableTalkStage
        title={titleText}
        cover={draft.cover}
        videoUrl={draft.videoUrl}
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

  const deletePost = useCallback(() => {
    if (!postId || deleting) return;
    if (!window.confirm("Delete this post?")) return;
    setDeleting(true);
    setSaveState("saving");
    setError(null);
    startTransition(() => {
      void deleteEditablePostAction(postId)
        .then(({ handle }) => {
          router.push(`/t/${encodeURIComponent(handle)}`);
        })
        .catch((deleteError) => {
          setDeleting(false);
          setSaveState("error");
          setError(errorMessage(deleteError, "Could not delete"));
        });
    });
  }, [deleting, postId, router]);

  return (
    <>
      <PostActionBar
        mode="edit"
        owner
        blog={blog}
        post={post}
        adjacent={adjacent}
        homePath={homePath}
        postPath={postPath(blog.handle, currentSlugRef.current)}
        draft={draft}
        deleting={deleting}
        onDelete={deletePost}
        onDone={() => saveDraftNow({}, { exitEdit: true })}
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
    </>
  );
}
