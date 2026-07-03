"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Blog, Post } from "@/lib/content";
import { formatArticleDate, readingTimeMin } from "@/lib/content";
import { createDraftAction, savePostAction } from "@/app/editor/actions";

type FolderId = "all" | "drafts" | "published";
type EditorItem = { id: string; post: Post };

const PREVIEW_SRC = "/editor/preview?preview=1";
const MIN_SPLIT = 35;
const MAX_SPLIT = 72;

const FOLDERS: Array<{ id: FolderId; name: string }> = [
  { id: "all", name: "Posts" },
  { id: "drafts", name: "Drafts" },
  { id: "published", name: "Published" },
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

function itemMeta(post: Post) {
  return [
    formatArticleDate(post.date),
    statusLabel(post.status),
    `${readingTimeMin(post.body)} min read`,
  ]
    .filter(Boolean)
    .join(" | ");
}

function isHexColor(value: string | undefined) {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? "");
}

function optionalValue(value: string) {
  return value === "" ? undefined : value;
}

export function EditorApp({
  blog,
  posts,
  dbEnabled,
}: {
  blog: Blog;
  posts: Post[];
  dbEnabled: boolean;
}) {
  const [ids, setIds] = useState(() => postIds(posts));
  const [drafts, setDrafts] = useState(() => draftsById(posts));
  const [selectedId, setSelectedId] = useState(() => ids[0] ?? "");
  // The hex field's own text buffer, so a partial value like "#0a" can be typed
  // without streaming an invalid color to the preview. Only a valid hex or an
  // empty string is ever committed to the draft accent.
  const [accentText, setAccentText] = useState(() => {
    const first = ids[0];
    return (first ? drafts[first]?.accent : undefined) ?? "";
  });
  const [folder, setFolder] = useState<FolderId>("all");
  const [showPreview, setShowPreview] = useState(false);
  const [previewMounted, setPreviewMounted] = useState(false);
  const [splitPct, setSplitPct] = useState(52);
  const [dragging, setDragging] = useState(false);
  // Below this width apple.css stacks the panes and disables the split, so the
  // handle becomes a plain divider rather than an operable separator.
  const [stacked, setStacked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const previewWindowRef = useRef<Window | null>(null);
  const draftRef = useRef<{ blog: Blog; post: Post } | null>(null);

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

  useEffect(() => {
    draftRef.current = selectedDraft;
  }, [selectedDraft]);

  useEffect(() => {
    previewWindowRef.current = null;
  }, [selectedId]);

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
      setAccentText(drafts[id]?.accent ?? "");
    },
    [drafts],
  );

  const updateSelected = useCallback(
    (patch: Partial<Post>) => {
      if (!selectedId) return;
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

  const selectFolder = useCallback(
    (nextFolder: FolderId) => {
      setFolder(nextFolder);
      const nextItem = items.find((item) => itemInFolder(item, nextFolder));
      if (nextItem) selectPost(nextItem.id);
    },
    [items, selectPost],
  );

  const onSave = useCallback(async () => {
    if (!dbEnabled || !selectedId || !selectedPost) return;
    setSaving(true);
    try {
      const saved = await savePostAction(selectedPost);
      setDrafts((current) =>
        current[selectedId] ? { ...current, [selectedId]: saved } : current,
      );
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }, [dbEnabled, selectedId, selectedPost]);

  const onNewDraft = useCallback(async () => {
    if (!dbEnabled) return;
    const created = await createDraftAction();
    const id = `db:${created.id}`;
    setDrafts((current) => ({ ...current, [id]: created }));
    setIds((current) => [id, ...current]);
    setFolder("all");
    setSelectedId(id);
    setAccentText(created.accent ?? "");
  }, [dbEnabled]);

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

  return (
    <div className="applecms ac-editor-app">
      <div className="ac-toolbar ac-chrome">
        <Link href="/" className="ac-btn ac-btn-plain ac-back">
          <span aria-hidden="true">&#8249;</span>
          Write
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
          <button className="ac-btn ac-btn-gray" type="button" onClick={onNewDraft}>
            New draft
          </button>
        )}
        <button
          className="ac-btn ac-btn-filled"
          type="button"
          disabled={!dbEnabled || !selectedPost || saving}
          title={dbEnabled ? undefined : "Connect a database to save"}
          onClick={onSave}
        >
          {saving ? "Saving" : justSaved ? "Saved" : "Save"}
        </button>
      </div>

      <div className="ac-workspace">
        <aside className="ac-sidebar ac-chrome ac-editor-sidebar">
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
              W
            </span>
            <span className="ac-account-name">Sign in with Apple: soon</span>
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
              <>
                <div className="ac-editor-pane-head">
                  <div>
                    <div className="ac-editor-eyebrow">{statusLabel(selectedPost.status)}</div>
                    <h1 className="ac-editor-heading">
                      {selectedPost.title || "Untitled"}
                    </h1>
                  </div>
                  <span className="ac-status-pill">{selectedPost.slug || "no-slug"}</span>
                </div>

                <form
                  className="ac-editor-form"
                  onSubmit={(event) => event.preventDefault()}
                >
                  <div className="ac-form-grid">
                    <label className="ac-field-label ac-form-span">
                      <span className="ac-label-text">Title</span>
                      <input
                        className="ac-field"
                        value={selectedPost.title}
                        onChange={(event) =>
                          updateSelected({ title: event.currentTarget.value })
                        }
                      />
                    </label>

                    <label className="ac-field-label">
                      <span className="ac-label-text">Kicker</span>
                      <input
                        className="ac-field"
                        value={selectedPost.kicker ?? ""}
                        onChange={(event) =>
                          updateSelected({
                            kicker: optionalValue(event.currentTarget.value),
                          })
                        }
                      />
                    </label>

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
                        onChange={(event) =>
                          updateSelected({ slug: event.currentTarget.value })
                        }
                      />
                    </label>

                    <label className="ac-field-label">
                      <span className="ac-label-text">Status</span>
                      <select
                        className="ac-field"
                        value={selectedPost.status}
                        onChange={(event) =>
                          updateSelected({
                            status: event.currentTarget.value as Post["status"],
                          })
                        }
                      >
                        <option value="draft">Draft</option>
                        <option value="published">Published</option>
                      </select>
                    </label>

                    <div className="ac-accent-row">
                      <label className="ac-field-label">
                        <span className="ac-label-text">Accent swatch</span>
                        <input
                          className="ac-color-field"
                          type="color"
                          value={
                            isHexColor(selectedPost.accent)
                              ? selectedPost.accent
                              : "#000000"
                          }
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            updateSelected({ accent: value });
                            setAccentText(value);
                          }}
                        />
                      </label>

                      <label className="ac-field-label ac-accent-input">
                        <span className="ac-label-text">Accent hex</span>
                        <input
                          className="ac-field"
                          value={accentText}
                          placeholder={blog.accent ?? "#065ec6"}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setAccentText(value);
                            const hex = value.trim();
                            // Commit only a valid hex or an explicit clear; keep
                            // partial input in the field without streaming an
                            // invalid --post-accent to the preview.
                            if (hex === "") updateSelected({ accent: "" });
                            else if (isHexColor(hex)) updateSelected({ accent: hex });
                          }}
                        />
                      </label>
                    </div>

                    <label className="ac-field-label ac-form-span">
                      <span className="ac-label-text">Cover URL</span>
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
                  </div>

                  <label className="ac-field-label ac-body-field">
                    <span className="ac-label-text">Body</span>
                    <textarea
                      className="ac-field ac-textarea"
                      value={selectedPost.body}
                      spellCheck
                      onChange={(event) =>
                        updateSelected({ body: event.currentTarget.value })
                      }
                    />
                  </label>
                </form>
              </>
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
                aria-label="Broadsheet preview"
                style={{ flexBasis: `${100 - splitPct}%` }}
              >
                <div className="ac-preview-head">
                  <span>Broadsheet preview</span>
                </div>
                <iframe
                  key={selectedId}
                  className="ac-preview-frame"
                  title="Broadsheet preview"
                  src={PREVIEW_SRC}
                />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
