"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SignOutButton } from "@/components/SignOutButton";
import type { Blog, GalleryItem, LinkRef, Post, PostType } from "@/lib/content";
import { formatArticleDate, readingTimeMin } from "@/lib/content";
import {
  createDraftAction,
  savePostAction,
  updateBlogAction,
} from "@/app/editor/actions";
import { MediaUploadError, uploadMedia } from "@/lib/upload";
import { blogPostPath } from "@/lib/public-paths";

type FolderId = "all" | "drafts" | "published";
type EditorItem = { id: string; post: Post };
type EditorUser = { name?: string; email?: string };
type BodySelection = { start: number; end: number };
type SaveIntent = "save" | "publish" | "unpublish";
type BlogSettingsFields = {
  name: string;
  handle: string;
  username: string;
  tagline: string;
  bioLine: string;
};

const PREVIEW_SRC = "/editor/preview?preview=1";
const MIN_SPLIT = 35;
const MAX_SPLIT = 72;

const FOLDERS: Array<{ id: FolderId; name: string }> = [
  { id: "all", name: "Posts" },
  { id: "drafts", name: "Drafts" },
  { id: "published", name: "Published" },
];

const POST_TYPES: Array<{ type: PostType; label: string }> = [
  { type: "article", label: "Article" },
  { type: "project", label: "Media post" },
  { type: "talk", label: "Video post" },
];

function FolderGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 4.5c0-1.1.9-2 2-2h2.8c.5 0 1 .2 1.4.6l.8.8h4c1.1 0 2 .9 2 2v5.6c0 1.1-.9 2-2 2h-9c-1.1 0-2-.9-2-2V4.5z"
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
}

function postIds(posts: Post[]) {
  return posts.map((post, index) => `${index}:${post.slug}`);
}

// Keep each post's accent exactly as authored. postAccent() reads a missing
// accent (undefined) as "inherit the blog accent" and an empty string as
// "explicitly no accent", so collapsing the two here would make the preview
// disagree with the published page for every post that inherits the blog color.
function draftsById(posts: Post[]) {
  return Object.fromEntries(
    posts.map((post, index) => [`${index}:${post.slug}`, post]),
  ) as Record<string, Post>;
}

function itemInFolder(item: EditorItem, folder: FolderId) {
  if (folder === "drafts") return item.post.status === "draft";
  if (folder === "published") return item.post.status === "published";
  return true;
}

function folderCount(items: EditorItem[], folder: FolderId) {
  return items.filter((item) => itemInFolder(item, folder)).length;
}

function statusLabel(status: Post["status"]) {
  return status === "draft" ? "Draft" : "Published";
}

function postTypeLabel(type: PostType) {
  return POST_TYPES.find((entry) => entry.type === type)?.label ?? "Article";
}

function cleanAccountValue(value: string | undefined) {
  return value?.trim() || undefined;
}

function accountName(user: EditorUser) {
  return cleanAccountValue(user.name) ?? cleanAccountValue(user.email) ?? "Account";
}

function accountInitial(label: string) {
  return Array.from(label.trim())[0]?.toUpperCase() ?? "A";
}

function itemMeta(post: Post) {
  return [
    postTypeLabel(post.type),
    formatArticleDate(post.date),
    statusLabel(post.status),
    `${readingTimeMin(post.body)} min read`,
  ]
    .filter(Boolean)
    .join(" | ");
}

function optionalValue(value: string) {
  return value === "" ? undefined : value;
}

function slugify(value: string, fallback = "post") {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function isPlaceholderSlug(value: string | undefined) {
  const slug = value?.trim().toLowerCase() ?? "";
  return slug === "" || slug.startsWith("untitled-");
}

function canAutoSlugPost(
  id: string,
  post: Post | undefined,
  manualSlugById: Record<string, boolean>,
) {
  return Boolean(
    id &&
      post &&
      post.status === "draft" &&
      !manualSlugById[id] &&
      isPlaceholderSlug(post.slug),
  );
}

function postSaveErrorMessage(error: unknown) {
  const message = errorMessage(error, "Post could not be saved");
  const haystack = message.toLowerCase();
  if (
    haystack.includes("posts_blog_slug_idx") ||
    haystack.includes("duplicate key") ||
    (haystack.includes("unique") && haystack.includes("slug"))
  ) {
    return "That URL is already used";
  }
  return message;
}

function blogSettingsFields(blog: Blog): BlogSettingsFields {
  return {
    name: blog.name,
    handle: blog.handle,
    username: blog.username ?? "",
    tagline: blog.tagline ?? "",
    bioLine: blog.bioLine ?? "",
  };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function imageAltFromFileName(fileName: string | undefined) {
  const name = fileName?.split(/[\\/]/).pop()?.trim();
  if (!name) return "";

  const withoutExtension = name.replace(/\.[^/.]+$/, "").trim();
  if (!withoutExtension) return "";

  return withoutExtension
    .replace(/[_-]+/g, " ")
    .replace(/[\[\]\(\)<>`!*#\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactLinks(links: LinkRef[]) {
  const next = links.filter((link) => link.label.trim() || link.href.trim());
  return next.length > 0 ? next : undefined;
}

function compactGallery(gallery: GalleryItem[]) {
  return gallery.length > 0 ? gallery : undefined;
}

function GalleryEditor({
  gallery,
  mediaEnabled,
  uploading,
  uploadError,
  onUploadImage,
  onChange,
}: {
  gallery: GalleryItem[];
  mediaEnabled: boolean;
  uploading: boolean;
  uploadError: string | null;
  onUploadImage: (file: File) => void;
  onChange: (gallery: GalleryItem[] | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const updateItem = (index: number, patch: Partial<GalleryItem>) => {
    onChange(
      compactGallery(
        gallery.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...patch } : item,
        ),
      ),
    );
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= gallery.length) return;
    const next = [...gallery];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    onChange(next);
  };

  const removeItem = (index: number) => {
    onChange(compactGallery(gallery.filter((_, itemIndex) => itemIndex !== index)));
  };

  return (
    <section className="ac-nested-editor ac-gallery-editor" aria-labelledby="ac-gallery-title">
      <div className="ac-nested-editor-head">
        <h3 id="ac-gallery-title" className="ac-nested-editor-title">
          Media
        </h3>
        {mediaEnabled && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) onUploadImage(file);
              }}
            />
            <button
              className="ac-btn ac-btn-gray"
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Uploading" : "Add image"}
            </button>
          </>
        )}
      </div>

      {uploadError && (
        <span className="ac-field-error ac-nested-error" role="alert">
          {uploadError}
        </span>
      )}

      {gallery.length > 0 ? (
        <div className="ac-gallery-list">
          {gallery.map((item, index) => (
            <div className="ac-gallery-row" key={`${item.src}:${index}`}>
              <div className="ac-gallery-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.src} alt="" className="ac-gallery-thumb-img" />
              </div>
              <label className="ac-field-label ac-gallery-caption">
                <span className="ac-label-text">Caption</span>
                <input
                  className="ac-field"
                  value={item.caption ?? ""}
                  onChange={(event) =>
                    updateItem(index, {
                      caption: optionalValue(event.currentTarget.value),
                    })
                  }
                />
              </label>
              <div className="ac-row-actions">
                <button
                  className="ac-btn ac-btn-gray"
                  type="button"
                  disabled={index === 0}
                  onClick={() => moveItem(index, -1)}
                >
                  Move up
                </button>
                <button
                  className="ac-btn ac-btn-gray"
                  type="button"
                  disabled={index === gallery.length - 1}
                  onClick={() => moveItem(index, 1)}
                >
                  Move down
                </button>
                <button
                  className="ac-btn ac-btn-plain ac-danger"
                  type="button"
                  onClick={() => removeItem(index)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ac-nested-empty">No gallery images</div>
      )}
    </section>
  );
}

function LinksEditor({
  links,
  onChange,
}: {
  links: LinkRef[];
  onChange: (links: LinkRef[] | undefined) => void;
}) {
  const [pendingLink, setPendingLink] = useState<LinkRef | null>(null);

  const updateLink = (index: number, patch: Partial<LinkRef>) => {
    onChange(
      compactLinks(
        links.map((link, linkIndex) =>
          linkIndex === index ? { ...link, ...patch } : link,
        ),
      ),
    );
  };

  const updatePendingLink = (patch: Partial<LinkRef>) => {
    const next = { ...(pendingLink ?? { label: "", href: "" }), ...patch };
    setPendingLink(next);
    if (!next.label.trim() && !next.href.trim()) return;
    onChange(compactLinks([...links, next]));
    setPendingLink(null);
  };

  const removeLink = (index: number) => {
    onChange(compactLinks(links.filter((_, linkIndex) => linkIndex !== index)));
  };

  return (
    <section className="ac-nested-editor ac-links-editor" aria-labelledby="ac-links-title">
      <div className="ac-nested-editor-head">
        <h3 id="ac-links-title" className="ac-nested-editor-title">
          Links
        </h3>
        <button
          className="ac-btn ac-btn-gray"
          type="button"
          disabled={pendingLink !== null}
          onClick={() => setPendingLink({ label: "", href: "" })}
        >
          Add link
        </button>
      </div>

      {links.length > 0 || pendingLink ? (
        <div className="ac-links-list">
          {links.map((link, index) => (
            <div className="ac-link-row" key={`${link.href}:${index}`}>
              <label className="ac-field-label">
                <span className="ac-label-text">Label</span>
                <input
                  className="ac-field"
                  value={link.label}
                  onChange={(event) =>
                    updateLink(index, { label: event.currentTarget.value })
                  }
                />
              </label>
              <label className="ac-field-label">
                <span className="ac-label-text">URL</span>
                <input
                  className="ac-field"
                  value={link.href}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) =>
                    updateLink(index, { href: event.currentTarget.value })
                  }
                />
              </label>
              <button
                className="ac-btn ac-btn-plain ac-danger ac-link-remove"
                type="button"
                onClick={() => removeLink(index)}
              >
                Remove
              </button>
            </div>
          ))}

          {pendingLink && (
            <div className="ac-link-row">
              <label className="ac-field-label">
                <span className="ac-label-text">Label</span>
                <input
                  className="ac-field"
                  value={pendingLink.label}
                  onChange={(event) =>
                    updatePendingLink({ label: event.currentTarget.value })
                  }
                />
              </label>
              <label className="ac-field-label">
                <span className="ac-label-text">URL</span>
                <input
                  className="ac-field"
                  value={pendingLink.href}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) =>
                    updatePendingLink({ href: event.currentTarget.value })
                  }
                />
              </label>
              <button
                className="ac-btn ac-btn-plain ac-danger ac-link-remove"
                type="button"
                onClick={() => setPendingLink(null)}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="ac-nested-empty">No links</div>
      )}
    </section>
  );
}

export function EditorApp({
  blog: initialBlog,
  posts,
  dbEnabled,
  mediaEnabled,
  user = null,
}: {
  blog: Blog;
  posts: Post[];
  dbEnabled: boolean;
  mediaEnabled: boolean;
  user?: EditorUser | null;
}) {
  const [blog, setBlog] = useState(initialBlog);
  const [ids, setIds] = useState(() => postIds(posts));
  const [drafts, setDrafts] = useState(() => draftsById(posts));
  const [selectedId, setSelectedId] = useState(() => ids[0] ?? "");
  const [slugAutoForSelected, setSlugAutoForSelected] = useState(() => {
    const first = ids[0];
    return Boolean(first && drafts[first] && isPlaceholderSlug(drafts[first].slug));
  });
  const [folder, setFolder] = useState<FolderId>("all");
  const [showPreview, setShowPreview] = useState(true);
  const [previewMounted, setPreviewMounted] = useState(true);
  const [newDraftType, setNewDraftType] = useState<PostType>("article");
  const [splitPct, setSplitPct] = useState(52);
  const [dragging, setDragging] = useState(false);
  // Below this width apple.css stacks the panes and disables the split, so the
  // handle becomes a plain divider rather than an operable separator.
  const [stacked, setStacked] = useState(false);
  const [saveIntent, setSaveIntent] = useState<SaveIntent | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryUploadError, setGalleryUploadError] = useState<string | null>(null);
  const [bodyImageUploading, setBodyImageUploading] = useState(false);
  const [bodyUploadError, setBodyUploadError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(() =>
    blogSettingsFields(initialBlog),
  );
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const bodyImageInputRef = useRef<HTMLInputElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const settingsNameRef = useRef<HTMLInputElement>(null);
  const bodySelectionRef = useRef<BodySelection | null>(null);
  const pendingBodyCaretRef = useRef<number | null>(null);
  const previewWindowRef = useRef<Window | null>(null);
  const draftRef = useRef<{ blog: Blog; post: Post } | null>(null);
  const manualSlugByIdRef = useRef<Record<string, boolean>>({});
  const copiedTimerRef = useRef<number | null>(null);
  const savedTimerRef = useRef<number | null>(null);
  const saving = saveIntent !== null;

  const items = useMemo(
    () =>
      ids
        .map((id) => ({ id, post: drafts[id] }))
        .filter((item): item is EditorItem => Boolean(item.post)),
    [drafts, ids],
  );
  const filteredItems = useMemo(
    () => items.filter((item) => itemInFolder(item, folder)),
    [folder, items],
  );
  const selectedPost = selectedId ? drafts[selectedId] : undefined;
  const selectedDraft = useMemo(
    () => (selectedPost ? { blog, post: selectedPost } : null),
    [blog, selectedPost],
  );
  const livePostPath = useMemo(() => {
    const slug = selectedPost?.slug.trim();
    if (!dbEnabled || selectedPost?.status !== "published" || !slug) return "";
    return blogPostPath(blog, { slug });
  }, [blog, dbEnabled, selectedPost?.slug, selectedPost?.status]);
  const signedIn = Boolean(user);
  const canEditSettings = signedIn && dbEnabled;

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    draftRef.current = selectedDraft;
  }, [selectedDraft]);

  useEffect(() => {
    if (!settingsOpen) return;
    const frame = window.requestAnimationFrame(() => {
      settingsNameRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !settingsSaving) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, settingsSaving]);

  const resetSelectedPostUi = useCallback(() => {
    previewWindowRef.current = null;
    bodySelectionRef.current = null;
    pendingBodyCaretRef.current = null;
    setLinkCopied(false);
    setGalleryUploadError(null);
  }, []);

  useEffect(() => {
    const position = pendingBodyCaretRef.current;
    if (position === null) return;

    const frame = window.requestAnimationFrame(() => {
      const textarea = bodyTextareaRef.current;
      if (!textarea) return;
      const nextPosition = Math.min(position, textarea.value.length);
      textarea.focus();
      textarea.selectionStart = nextPosition;
      textarea.selectionEnd = nextPosition;
      bodySelectionRef.current = { start: nextPosition, end: nextPosition };
      pendingBodyCaretRef.current = null;
    });

    return () => window.cancelAnimationFrame(frame);
  });

  useEffect(() => {
    const query = window.matchMedia("(max-width: 820px)");
    const update = () => setStacked(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const selectPost = useCallback(
    (id: string) => {
      setSelectedId(id);
      setSlugAutoForSelected(
        canAutoSlugPost(id, drafts[id], manualSlugByIdRef.current),
      );
      setPostError(null);
      resetSelectedPostUi();
    },
    [drafts, resetSelectedPostUi],
  );

  const updateSelected = useCallback(
    (patch: Partial<Post>) => {
      if (!selectedId) return;
      setPostError(null);
      setDrafts((current) => {
        const currentPost = current[selectedId];
        if (!currentPost) return current;
        return {
          ...current,
          [selectedId]: { ...currentPost, ...patch },
        };
      });
    },
    [selectedId],
  );

  const updateSelectedTitle = useCallback(
    (title: string) => {
      updateSelected({
        title,
        ...(slugAutoForSelected && selectedPost?.status === "draft"
          ? { slug: slugify(title) }
          : {}),
      });
    },
    [selectedPost?.status, slugAutoForSelected, updateSelected],
  );

  const updateSelectedSlug = useCallback(
    (slug: string) => {
      if (selectedId) manualSlugByIdRef.current[selectedId] = true;
      setSlugAutoForSelected(false);
      updateSelected({ slug: slugify(slug, "") });
    },
    [selectedId, updateSelected],
  );

  const openSettings = useCallback(() => {
    if (!canEditSettings) return;
    setSettingsDraft(blogSettingsFields(blog));
    setSettingsError(null);
    setSettingsOpen(true);
  }, [blog, canEditSettings]);

  const closeSettings = useCallback(() => {
    if (settingsSaving) return;
    setSettingsOpen(false);
    setSettingsError(null);
  }, [settingsSaving]);

  const updateSettingsDraft = useCallback((patch: Partial<BlogSettingsFields>) => {
    setSettingsDraft((current) => ({ ...current, ...patch }));
    setSettingsError(null);
  }, []);

  const onSaveSettings = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canEditSettings) return;

      setSettingsSaving(true);
      setSettingsError(null);
      try {
        const saved = await updateBlogAction({
          name: settingsDraft.name,
          handle: settingsDraft.handle,
          username: settingsDraft.username,
          tagline: settingsDraft.tagline,
          bioLine: settingsDraft.bioLine,
        });
        setBlog(saved);
        setSettingsDraft(blogSettingsFields(saved));
        setSettingsOpen(false);
      } catch (error) {
        setSettingsError(errorMessage(error, "Settings could not be saved"));
      } finally {
        setSettingsSaving(false);
      }
    },
    [canEditSettings, settingsDraft],
  );

  const selectFolder = useCallback(
    (nextFolder: FolderId) => {
      setFolder(nextFolder);
      const nextItem = items.find((item) => itemInFolder(item, nextFolder));
      if (nextItem) selectPost(nextItem.id);
    },
    [items, selectPost],
  );

  const storeBodySelection = useCallback(() => {
    const textarea = bodyTextareaRef.current;
    if (!textarea) return;
    bodySelectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
  }, []);

  const postForPersist = useCallback(
    (post: Post, status: Post["status"]) => {
      const shouldAutoSlug =
        post.status === "draft" &&
        selectedId &&
        !manualSlugByIdRef.current[selectedId] &&
        (slugAutoForSelected || isPlaceholderSlug(post.slug));

      return {
        ...post,
        status,
        slug: shouldAutoSlug ? slugify(post.title) : post.slug.trim() || "post",
      };
    },
    [selectedId, slugAutoForSelected],
  );

  const persistSelectedPost = useCallback(
    async (post: Post, intent: SaveIntent) => {
      if (!dbEnabled || !selectedId) return;
      setSaveIntent(intent);
      setPostError(null);
      setLinkCopied(false);
      try {
        const saved = await savePostAction(post);
        setDrafts((current) =>
          current[selectedId] ? { ...current, [selectedId]: saved } : current,
        );
        if (saved.status === "published" && !isPlaceholderSlug(saved.slug)) {
          setSlugAutoForSelected(false);
        }
        if (intent === "save") {
          setJustSaved(true);
          if (savedTimerRef.current !== null) {
            window.clearTimeout(savedTimerRef.current);
          }
          savedTimerRef.current = window.setTimeout(() => {
            setJustSaved(false);
            savedTimerRef.current = null;
          }, 1500);
        }
      } catch (error) {
        setPostError(postSaveErrorMessage(error));
      } finally {
        setSaveIntent(null);
      }
    },
    [dbEnabled, selectedId],
  );

  const onSave = useCallback(async () => {
    if (!selectedPost) return;
    await persistSelectedPost(
      postForPersist(selectedPost, selectedPost.status),
      "save",
    );
  }, [persistSelectedPost, postForPersist, selectedPost]);

  const onPublishToggle = useCallback(async () => {
    if (!selectedPost) return;
    const status: Post["status"] =
      selectedPost.status === "published" ? "draft" : "published";
    await persistSelectedPost(
      postForPersist(selectedPost, status),
      status === "published" ? "publish" : "unpublish",
    );
  }, [persistSelectedPost, postForPersist, selectedPost]);

  const onCopyLiveLink = useCallback(async () => {
    if (!dbEnabled || !livePostPath) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${livePostPath}`);
      setPostError(null);
      setLinkCopied(true);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        setLinkCopied(false);
        copiedTimerRef.current = null;
      }, 1500);
    } catch {
      setPostError("Could not copy link");
    }
  }, [dbEnabled, livePostPath]);

  const onNewDraft = useCallback(async () => {
    if (!dbEnabled) return;
    const created = await createDraftAction(newDraftType);
    const id = `db:${created.id}`;
    setDrafts((current) => ({ ...current, [id]: created }));
    setIds((current) => [id, ...current]);
    setFolder("all");
    setSelectedId(id);
    manualSlugByIdRef.current[id] = false;
    setSlugAutoForSelected(canAutoSlugPost(id, created, manualSlugByIdRef.current));
    setPostError(null);
    resetSelectedPostUi();
  }, [dbEnabled, newDraftType, resetSelectedPostUi]);

  const onUploadCover = useCallback(
    async (file: File) => {
      setCoverUploading(true);
      setUploadError(null);
      try {
        const url = await uploadMedia(file);
        updateSelected({ cover: url });
      } catch (error) {
        setUploadError(
          error instanceof MediaUploadError ? error.message : "Upload failed.",
        );
      } finally {
        setCoverUploading(false);
      }
    },
    [updateSelected],
  );

  const onUploadGalleryImage = useCallback(
    async (file: File) => {
      if (!selectedPost) return;

      setGalleryUploading(true);
      setGalleryUploadError(null);
      try {
        const url = await uploadMedia(file);
        updateSelected({ gallery: [...(selectedPost.gallery ?? []), { src: url }] });
      } catch (error) {
        setGalleryUploadError(
          error instanceof MediaUploadError ? error.message : "Upload failed.",
        );
      } finally {
        setGalleryUploading(false);
      }
    },
    [selectedPost, updateSelected],
  );

  const onUploadBodyImage = useCallback(
    async (file: File) => {
      if (!selectedPost) return;

      const selection = bodySelectionRef.current;
      setBodyImageUploading(true);
      setBodyUploadError(null);

      try {
        const url = await uploadMedia(file);
        const alt = imageAltFromFileName(file.name);
        const body = selectedPost.body;
        const selectionStart = selection
          ? Math.min(selection.start, body.length)
          : body.length;
        const selectionEnd = selection ? Math.min(selection.end, body.length) : body.length;
        const start = Math.min(selectionStart, selectionEnd);
        const end = Math.max(selectionStart, selectionEnd);
        const markdown = `![${alt}](${url})`;
        const next = `${body.slice(0, start)}${markdown}${body.slice(end)}`;

        pendingBodyCaretRef.current = start + markdown.length;
        updateSelected({ body: next });
      } catch (error) {
        setBodyUploadError(
          error instanceof MediaUploadError ? error.message : "Upload failed.",
        );
      } finally {
        setBodyImageUploading(false);
      }
    },
    [selectedPost, updateSelected],
  );

  const postDraft = useCallback((targetWindow?: Window | null) => {
    const target = targetWindow ?? previewWindowRef.current;
    const draft = draftRef.current;
    if (!target || !draft) return;
    try {
      target.postMessage(
        { type: "write-draft", post: draft.post, blog: draft.blog },
        window.location.origin,
      );
    } catch {
      previewWindowRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string } | null;
      if (data?.type !== "write-preview-ready" || !event.source) return;
      previewWindowRef.current = event.source as Window;
      postDraft(event.source as Window);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postDraft]);

  useEffect(() => {
    if (!showPreview || !selectedDraft) return;
    const timer = window.setTimeout(() => postDraft(), 80);
    return () => window.clearTimeout(timer);
  }, [postDraft, selectedDraft, showPreview]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: MouseEvent) => {
      const element = splitRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const next = ((event.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, next)));
    };
    const onUp = () => setDragging(false);
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const adjustSplit = useCallback((delta: number) => {
    setSplitPct((value) => Math.max(MIN_SPLIT, Math.min(MAX_SPLIT, value + delta)));
  }, []);

  const togglePreview = useCallback(() => {
    setPreviewMounted(true);
    setShowPreview((value) => !value);
  }, []);

  const folderTitle = FOLDERS.find((entry) => entry.id === folder)?.name ?? "Posts";
  const accountLabel = user ? accountName(user) : "Demo (read only)";
  const avatarInitial = signedIn ? accountInitial(accountLabel) : "D";

  return (
    <div className="applecms ac-editor-app">
      <div className="ac-toolbar ac-chrome">
        <Link href="/" className="ac-btn ac-btn-plain ac-back">
          <span aria-hidden="true">&#8249;</span>
          Texttext
        </Link>
        <div className="ac-toolbar-title ac-toolbar-title-grow">Editor</div>
        <button
          className={`ac-btn ${showPreview ? "ac-btn-filled" : "ac-btn-gray"}`}
          type="button"
          aria-pressed={showPreview}
          onClick={togglePreview}
        >
          Preview
        </button>
        {dbEnabled && (
          <div className="ac-newdraft">
            <select
              className="ac-field ac-newdraft-select"
              aria-label="Draft type"
              value={newDraftType}
              onChange={(event) =>
                setNewDraftType(event.currentTarget.value as PostType)
              }
            >
              {POST_TYPES.map((entry) => (
                <option key={entry.type} value={entry.type}>
                  {entry.label}
                </option>
              ))}
            </select>
            <button className="ac-btn ac-btn-gray" type="button" onClick={onNewDraft}>
              New draft
            </button>
          </div>
        )}
        {selectedPost && (
          <span
            className={`ac-toolbar-status ${
              selectedPost.status === "published" ? "ac-toolbar-status-live" : ""
            }`}
          >
            {statusLabel(selectedPost.status)}
          </span>
        )}
        <button
          className={`ac-btn ${
            selectedPost?.status === "published" ? "ac-btn-gray" : "ac-btn-filled"
          }`}
          type="button"
          disabled={!dbEnabled || !selectedPost || saving}
          title={dbEnabled ? undefined : "Connect a database to publish"}
          onClick={onPublishToggle}
        >
          {selectedPost?.status === "published"
            ? saveIntent === "unpublish"
              ? "Unpublishing"
              : "Unpublish"
            : saveIntent === "publish"
              ? "Publishing"
              : "Publish"}
        </button>
        <button
          className="ac-btn ac-btn-gray"
          type="button"
          disabled={!dbEnabled || !selectedPost || saving}
          title={dbEnabled ? undefined : "Connect a database to save"}
          onClick={onSave}
        >
          {saveIntent === "save" ? "Saving" : justSaved ? "Saved" : "Save"}
        </button>
      </div>

      <div className="ac-workspace">
        <aside className="ac-sidebar ac-chrome ac-editor-sidebar">
          <Link
            href={`/t/${encodeURIComponent(blog.handle)}`}
            className="ac-blog-home-link"
            target="_blank"
            rel="noreferrer"
          >
            <span className="ac-blog-home-name">{blog.name}</span>
            <span className="ac-blog-home-meta">View blog</span>
          </Link>
          <div className="ac-list ac-editor-folder-list">
            {FOLDERS.map((entry) => (
              <button
                key={entry.id}
                className={`ac-folder ${folder === entry.id ? "ac-folder-on" : ""}`}
                type="button"
                aria-pressed={folder === entry.id}
                onClick={() => selectFolder(entry.id)}
              >
                <span className="ac-folder-icon">
                  <FolderGlyph />
                </span>
                <span className="ac-folder-name">{entry.name}</span>
                <span className="ac-badge">{folderCount(items, entry.id)}</span>
              </button>
            ))}
          </div>
          <div className="ac-account">
            <span className="ac-avatar ac-editor-avatar" aria-hidden="true">
              {avatarInitial}
            </span>
            <span className="ac-account-name">{accountLabel}</span>
            {canEditSettings && (
              <button
                className="ac-btn ac-btn-plain ac-account-settings"
                type="button"
                onClick={openSettings}
              >
                Settings
              </button>
            )}
            {signedIn && (
              <SignOutButton className="ac-btn ac-btn-plain ac-account-signout" />
            )}
          </div>
        </aside>

        <section className="ac-listview ac-post-list" aria-label="Posts">
          <div className="ac-listview-head">
            <div className="ac-listview-title">{folderTitle}</div>
            <div className="ac-listview-count">
              {filteredItems.length} {filteredItems.length === 1 ? "item" : "items"}
            </div>
          </div>
          <div className="ac-notelist">
            {filteredItems.map((item) => (
              <button
                key={item.id}
                className={`ac-noterow ${item.id === selectedId ? "ac-noterow-on" : ""}`}
                type="button"
                onClick={() => selectPost(item.id)}
              >
                <span className="ac-noterow-title">
                  {item.post.title || "Untitled"}
                </span>
                <span className="ac-noterow-sub">{itemMeta(item.post)}</span>
              </button>
            ))}
            {filteredItems.length === 0 && (
              <div className="ac-empty-state">No posts</div>
            )}
          </div>
        </section>

        <div className="ac-editor-stage" ref={splitRef}>
          <main
            className="ac-editor-pane"
            aria-label="Post editor"
            style={showPreview ? { flexBasis: `${splitPct}%` } : undefined}
          >
            {selectedPost ? (
              <form
                className="ac-editor-form ac-composer-form"
                onSubmit={(event) => event.preventDefault()}
              >
                <section className="ac-writing-sheet" aria-label="Writing">
                  <label className="ac-document-title-label">
                    <span className="ac-sr-only">Title</span>
                    <input
                      className="ac-document-title-input"
                      value={selectedPost.title}
                      placeholder="Give it a title"
                      onChange={(event) =>
                        updateSelectedTitle(event.currentTarget.value)
                      }
                    />
                  </label>

                  <div className="ac-document-meta">
                    <span className="ac-editor-eyebrow">
                      {postTypeLabel(selectedPost.type)} | {statusLabel(selectedPost.status)}
                    </span>
                    <span className="ac-status-pill">
                      {selectedPost.slug || "no-slug"}
                    </span>
                    {postError && (
                      <span className="ac-field-error ac-editor-error" role="alert">
                        {postError}
                      </span>
                    )}
                    {livePostPath && (
                      <div className="ac-live-link" aria-label="Published post link">
                        <span className="ac-live-url">{livePostPath}</span>
                        <a
                          className="ac-btn ac-btn-gray"
                          href={livePostPath}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View
                        </a>
                        <button
                          className="ac-btn ac-btn-gray"
                          type="button"
                          onClick={onCopyLiveLink}
                        >
                          Copy link
                        </button>
                        {linkCopied && (
                          <span className="ac-copy-note" role="status">
                            Copied
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="ac-field-label ac-body-field">
                    <div className="ac-body-head">
                      <label className="ac-label-text" htmlFor="ac-body-textarea">
                        Body
                      </label>
                      {mediaEnabled && (
                        <div className="ac-body-actions">
                          <input
                            ref={bodyImageInputRef}
                            type="file"
                            accept="image/*"
                            hidden
                            onChange={(event) => {
                              const file = event.currentTarget.files?.[0];
                              event.currentTarget.value = "";
                              if (file) onUploadBodyImage(file);
                            }}
                          />
                          <button
                            type="button"
                            className="ac-btn ac-btn-gray"
                            disabled={bodyImageUploading}
                            onClick={() => bodyImageInputRef.current?.click()}
                          >
                            {bodyImageUploading ? "Uploading" : "Insert image"}
                          </button>
                          {bodyUploadError && (
                            <span className="ac-field-error" role="alert">
                              {bodyUploadError}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <textarea
                      id="ac-body-textarea"
                      ref={bodyTextareaRef}
                      className="ac-field ac-textarea"
                      value={selectedPost.body}
                      spellCheck
                      onFocus={storeBodySelection}
                      onClick={storeBodySelection}
                      onKeyUp={storeBodySelection}
                      onSelect={storeBodySelection}
                      onChange={(event) => {
                        updateSelected({ body: event.currentTarget.value });
                        bodySelectionRef.current = {
                          start: event.currentTarget.selectionStart,
                          end: event.currentTarget.selectionEnd,
                        };
                      }}
                    />
                  </div>
                </section>

                <section
                  className="ac-details-section"
                  aria-labelledby="ac-details-title"
                >
                  <div className="ac-details-head">
                    <h2 id="ac-details-title" className="ac-details-title">
                      Details
                    </h2>
                    <span className="ac-details-subtitle">
                      {postTypeLabel(selectedPost.type)}
                    </span>
                  </div>

                  <div className="ac-form-grid ac-details-grid">
                    <label className="ac-field-label">
                      <span className="ac-label-text">Date</span>
                      <input
                        className="ac-field"
                        type="date"
                        value={selectedPost.date ?? ""}
                        onChange={(event) =>
                          updateSelected({
                            date: optionalValue(event.currentTarget.value),
                          })
                        }
                      />
                    </label>

                    <label className="ac-field-label">
                      <span className="ac-label-text">Slug</span>
                      <input
                        className="ac-field"
                        value={selectedPost.slug}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        onChange={(event) =>
                          updateSelectedSlug(event.currentTarget.value)
                        }
                      />
                    </label>

                    <label className="ac-field-label ac-form-span">
                      <span className="ac-label-text">
                        {selectedPost.type === "talk" ? "Poster or cover URL" : "Cover URL"}
                      </span>
                      <input
                        className="ac-field"
                        value={selectedPost.cover ?? ""}
                        onChange={(event) =>
                          updateSelected({
                            cover: optionalValue(event.currentTarget.value),
                          })
                        }
                      />
                    </label>

                    {mediaEnabled && (
                      <div className="ac-form-span ac-cover-actions">
                        <input
                          ref={coverInputRef}
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            if (file) onUploadCover(file);
                          }}
                        />
                        <button
                          type="button"
                          className="ac-btn ac-btn-gray"
                          disabled={coverUploading}
                          onClick={() => coverInputRef.current?.click()}
                        >
                          {coverUploading ? "Uploading" : "Upload image"}
                        </button>
                        {uploadError && (
                          <span className="ac-field-error" role="alert">
                            {uploadError}
                          </span>
                        )}
                      </div>
                    )}

                    <label className="ac-field-label ac-form-span">
                      <span className="ac-label-text">Cover caption</span>
                      <input
                        className="ac-field"
                        value={selectedPost.coverCaption ?? ""}
                        onChange={(event) =>
                          updateSelected({
                            coverCaption: optionalValue(event.currentTarget.value),
                          })
                        }
                      />
                    </label>

                    {selectedPost.type === "talk" && (
                      <>
                        <label className="ac-field-label ac-form-span">
                          <span className="ac-label-text">Video URL</span>
                          <input
                            className="ac-field"
                            value={selectedPost.videoUrl ?? ""}
                            onChange={(event) =>
                              updateSelected({
                                videoUrl: optionalValue(event.currentTarget.value),
                              })
                            }
                          />
                        </label>

                        <label className="ac-field-label">
                          <span className="ac-label-text">Venue</span>
                          <input
                            className="ac-field"
                            value={selectedPost.venue ?? ""}
                            onChange={(event) =>
                              updateSelected({
                                venue: optionalValue(event.currentTarget.value),
                              })
                            }
                          />
                        </label>

                        <label className="ac-field-label">
                          <span className="ac-label-text">Duration</span>
                          <input
                            className="ac-field"
                            value={selectedPost.duration ?? ""}
                            onChange={(event) =>
                              updateSelected({
                                duration: optionalValue(event.currentTarget.value),
                              })
                            }
                          />
                        </label>
                      </>
                    )}
                  </div>

                  {selectedPost.type === "project" && (
                    <GalleryEditor
                      gallery={selectedPost.gallery ?? []}
                      mediaEnabled={mediaEnabled}
                      uploading={galleryUploading}
                      uploadError={galleryUploadError}
                      onUploadImage={onUploadGalleryImage}
                      onChange={(gallery) => updateSelected({ gallery })}
                    />
                  )}

                  {(selectedPost.type === "project" || selectedPost.type === "talk") && (
                    <LinksEditor
                      key={`${selectedId}:${selectedPost.type}:links`}
                      links={selectedPost.links ?? []}
                      onChange={(links) => updateSelected({ links })}
                    />
                  )}
                </section>
              </form>
            ) : (
              <div className="ac-empty-editor">Select a post</div>
            )}
          </main>

          {previewMounted && selectedPost && (
            <>
              {showPreview &&
                (stacked ? (
                  // Stacked layout: apple.css disables the split here, so the
                  // handle is a plain divider, not an operable separator.
                  <div className="ac-split-handle" aria-hidden="true" />
                ) : (
                  <div
                    className="ac-split-handle"
                    role="separator"
                    aria-label="Resize preview"
                    aria-orientation="vertical"
                    aria-valuemin={MIN_SPLIT}
                    aria-valuemax={MAX_SPLIT}
                    aria-valuenow={Math.round(splitPct)}
                    tabIndex={0}
                    onMouseDown={() => setDragging(true)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowLeft") {
                        event.preventDefault();
                        adjustSplit(-4);
                      } else if (event.key === "ArrowRight") {
                        event.preventDefault();
                        adjustSplit(4);
                      } else if (event.key === "Home") {
                        event.preventDefault();
                        setSplitPct(MIN_SPLIT);
                      } else if (event.key === "End") {
                        event.preventDefault();
                        setSplitPct(MAX_SPLIT);
                      }
                    }}
                  />
                ))}
              <section
                className={`ac-preview-pane ${showPreview ? "" : "ac-preview-pane-hidden"}`}
                aria-label="Live preview"
                style={{ flexBasis: `${100 - splitPct}%` }}
              >
                <div className="ac-preview-head">
                  <span>Live preview</span>
                </div>
                <iframe
                  key={selectedId}
                  className="ac-preview-frame"
                  title="Live preview"
                  src={PREVIEW_SRC}
                />
              </section>
            </>
          )}
        </div>
      </div>

      {settingsOpen && canEditSettings && (
        <div className="ac-modal-backdrop" onMouseDown={closeSettings}>
          <section
            className="ac-settings-panel ac-chrome"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ac-settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="ac-settings-head">
              <h2 id="ac-settings-title" className="ac-settings-title">
                Settings
              </h2>
            </div>
            <form className="ac-settings-form" onSubmit={onSaveSettings}>
              <label className="ac-field-label ac-settings-wide">
                <span className="ac-label-text">Blog name</span>
                <input
                  ref={settingsNameRef}
                  className="ac-field"
                  value={settingsDraft.name}
                  onChange={(event) =>
                    updateSettingsDraft({ name: event.currentTarget.value })
                  }
                />
              </label>

              <label className="ac-field-label ac-settings-wide">
                <span className="ac-label-text">Handle</span>
                <input
                  className="ac-field"
                  value={settingsDraft.handle}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) =>
                    updateSettingsDraft({ handle: event.currentTarget.value })
                  }
                />
              </label>

              <label className="ac-field-label ac-settings-wide">
                <span className="ac-label-text">Username</span>
                <input
                  className="ac-field"
                  value={settingsDraft.username}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) =>
                    updateSettingsDraft({ username: event.currentTarget.value })
                  }
                />
              </label>

              <label className="ac-field-label ac-settings-wide">
                <span className="ac-label-text">Tagline</span>
                <input
                  className="ac-field"
                  value={settingsDraft.tagline}
                  onChange={(event) =>
                    updateSettingsDraft({ tagline: event.currentTarget.value })
                  }
                />
              </label>

              <label className="ac-field-label ac-settings-wide">
                <span className="ac-label-text">Bio line</span>
                <input
                  className="ac-field"
                  value={settingsDraft.bioLine}
                  onChange={(event) =>
                    updateSettingsDraft({ bioLine: event.currentTarget.value })
                  }
                />
              </label>

              <div className="ac-settings-actions">
                {settingsError && (
                  <span className="ac-field-error ac-settings-error" role="alert">
                    {settingsError}
                  </span>
                )}
                <button
                  className="ac-btn ac-btn-gray"
                  type="button"
                  disabled={settingsSaving}
                  onClick={closeSettings}
                >
                  Cancel
                </button>
                <button
                  className="ac-btn ac-btn-filled"
                  type="submit"
                  disabled={settingsSaving}
                >
                  {settingsSaving ? "Saving" : "Save settings"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
