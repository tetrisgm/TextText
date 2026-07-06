"use client";

// The workspace view of a non-blog folder (Notes, Bookmarks): a quiet list
// rendered per folder mode inside the home workspace shell. Items are always
// unlisted; everything here is owner-only surface.

import { useCallback, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createFolderItemAction } from "@/app/editor/actions";
import { formatArticleDate } from "@/lib/content";
import type { Blog, Folder, Post } from "@/lib/content";
import { blogPostEditPath } from "@/lib/public-paths";

const FOLDER_TAGLINES: Record<string, string> = {
  notes: "Private Markdown notes.",
  bookmarks: "Links and sources for later.",
};

const FOLDER_EXPLAINERS: Record<string, { title: string; body: string }> = {
  notes: {
    title: "How Notes work",
    body: "Keep rough Markdown notes private, then turn the useful ones into posts later.",
  },
  bookmarks: {
    title: "How Bookmarks work",
    body: "Save links with notes, quotes, and context so references stay near your writing.",
  },
};

function itemKey(post: Post): string {
  return post.id ?? post.slug;
}

function itemTitle(post: Post): string {
  return post.title.trim() || "Untitled";
}

function actionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sortedByTimestampDesc(
  items: Post[],
  timestamp: (post: Post) => string,
): Post[] {
  return [...items].sort((a, b) => timestamp(b).localeCompare(timestamp(a)));
}

function bookmarkHref(post: Post): string | undefined {
  return post.links?.[0]?.href;
}

function bookmarkHost(post: Post): string {
  const link = post.links?.[0];
  if (!link) return "";
  try {
    return new URL(link.href).hostname.replace(/^www\./, "");
  } catch {
    return link.label;
  }
}

function commentaryLine(body: string): string {
  const line = body.replace(/\s+/g, " ").trim();
  if (line.length <= 150) return line;
  const sliced = line.slice(0, 147).trimEnd();
  const wordBreak = sliced.lastIndexOf(" ");
  return `${wordBreak > 60 ? sliced.slice(0, wordBreak) : sliced}...`;
}

function FolderEmptyCard({ mode }: { mode: string }) {
  const explainer = FOLDER_EXPLAINERS[mode];
  if (!explainer) return null;
  return (
    <article className="post-folder-page-card">
      <span>Empty folder</span>
      <h2>{explainer.title}</h2>
      <p>{explainer.body}</p>
    </article>
  );
}

function NotesFolderContents({
  blog,
  handle,
  items,
}: {
  blog: Blog;
  handle: string;
  items: Post[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const createNote = useCallback(() => {
    if (creating) return;
    setCreating(true);
    setError(null);
    startTransition(() => {
      void createFolderItemAction(handle, "notes")
        .then((post) => {
          router.push(blogPostEditPath(blog, post));
        })
        .catch((createError) => {
          setCreating(false);
          setError(actionErrorMessage(createError, "Could not create the note"));
        });
    });
  }, [blog, creating, handle, router]);

  const notes = sortedByTimestampDesc(
    items,
    (post) => post.updatedAt ?? post.date ?? "",
  );

  return (
    <>
      <div className="post-folder-toolbar">
        {error && (
          <span className="post-folder-error" role="alert">
            {error}
          </span>
        )}
        <button
          type="button"
          className="post-folder-create ac-btn ac-btn-filled"
          disabled={creating}
          onClick={createNote}
        >
          {creating ? "Creating" : "New note"}
        </button>
      </div>
      <section className="post-folder-page-items" aria-label="Notes">
        {notes.length === 0 ? (
          <FolderEmptyCard mode="notes" />
        ) : (
          <div className="post-folder-list">
            {notes.map((note) => (
              <Link
                key={itemKey(note)}
                className="post-folder-row"
                href={blogPostEditPath(blog, note)}
              >
                <span className="post-folder-row-title">{itemTitle(note)}</span>
                <span className="post-folder-row-meta">
                  {formatArticleDate(note.updatedAt ?? note.date, {
                    style: "short",
                  })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function BookmarksFolderContents({
  blog,
  handle,
  items,
}: {
  blog: Blog;
  handle: string;
  items: Post[];
}) {
  const router = useRouter();
  const urlRef = useRef<HTMLInputElement>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const openForm = useCallback(() => {
    setError(null);
    setFormOpen(true);
    window.requestAnimationFrame(() => {
      urlRef.current?.focus();
    });
  }, []);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setError(null);
  }, []);

  const addBookmark = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (saving) return;

      const form = event.currentTarget;
      const data = new FormData(form);
      const url = String(data.get("url") ?? "").trim();
      const title = String(data.get("title") ?? "").trim();
      if (!url) {
        setError("A bookmark needs a link");
        return;
      }

      setSaving(true);
      setError(null);
      startTransition(() => {
        void createFolderItemAction(handle, "bookmarks", {
          url,
          title: title || undefined,
        })
          .then(() => {
            form.reset();
            setFormOpen(false);
            router.refresh();
          })
          .catch((saveError) => {
            setError(
              actionErrorMessage(saveError, "Could not save the bookmark"),
            );
          })
          .finally(() => setSaving(false));
      });
    },
    [handle, router, saving],
  );

  const bookmarks = sortedByTimestampDesc(
    items,
    (post) => post.createdAt ?? post.date ?? "",
  );

  return (
    <>
      <div className="post-folder-toolbar">
        {error && (
          <span className="post-folder-error" role="alert">
            {error}
          </span>
        )}
        {formOpen ? (
          <form className="post-folder-new-form" onSubmit={addBookmark}>
            <input
              ref={urlRef}
              className="post-folder-field is-url"
              name="url"
              type="text"
              inputMode="url"
              placeholder="https://example.com"
              aria-label="Bookmark link"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
            <input
              className="post-folder-field is-title"
              name="title"
              type="text"
              placeholder="Title (optional)"
              aria-label="Bookmark title"
            />
            <button
              type="submit"
              className="ac-btn ac-btn-filled"
              disabled={saving}
            >
              {saving ? "Adding" : "Add"}
            </button>
            <button
              type="button"
              className="ac-btn ac-btn-gray"
              disabled={saving}
              onClick={closeForm}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="post-folder-create ac-btn ac-btn-filled"
            onClick={openForm}
          >
            Add bookmark
          </button>
        )}
      </div>
      <section className="post-folder-page-items" aria-label="Bookmarks">
        {bookmarks.length === 0 ? (
          <FolderEmptyCard mode="bookmarks" />
        ) : (
          <div className="post-folder-list">
            {bookmarks.map((bookmark) => {
              const href = bookmarkHref(bookmark);
              const host = bookmarkHost(bookmark);
              const commentary = commentaryLine(bookmark.body);
              const editPath = blogPostEditPath(blog, bookmark);
              const copy = (
                <>
                  <span className="post-folder-row-title">
                    {itemTitle(bookmark)}
                  </span>
                  {host && (
                    <span className="post-folder-row-meta">{host}</span>
                  )}
                  {commentary && (
                    <span className="post-folder-row-excerpt">
                      {commentary}
                    </span>
                  )}
                </>
              );
              return (
                <article
                  key={itemKey(bookmark)}
                  className="post-folder-row is-bookmark"
                >
                  {href ? (
                    <a
                      className="post-folder-row-link"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {copy}
                    </a>
                  ) : (
                    // A bookmark without a saved link can only be edited.
                    <Link className="post-folder-row-link" href={editPath}>
                      {copy}
                    </Link>
                  )}
                  <Link
                    className="post-folder-row-edit"
                    href={editPath}
                    aria-label={`Edit ${itemTitle(bookmark)}`}
                  >
                    Edit
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

export function FolderPage({
  blog,
  folder,
  handle,
  items,
}: {
  blog: Blog;
  folder: Folder;
  handle: string;
  items: Post[];
}) {
  return (
    <main className="post-folder-page" aria-labelledby="post-folder-page-title">
      <header className="post-folder-page-header">
        <span>Folder</span>
        <h1 id="post-folder-page-title">{folder.name}</h1>
        <p>{FOLDER_TAGLINES[folder.mode] ?? ""}</p>
      </header>
      {folder.mode === "bookmarks" ? (
        <BookmarksFolderContents blog={blog} handle={handle} items={items} />
      ) : (
        <NotesFolderContents blog={blog} handle={handle} items={items} />
      )}
    </main>
  );
}
