"use client";

// The workspace view of a folder: a quiet list rendered per folder mode inside
// the home workspace shell. Notes and bookmarks stay unlisted; sharing only
// grants named collaborators access.

import { useCallback, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createFolderItemAction } from "@/app/editor/actions";
import { BookmarkCard } from "@/components/bookmarks/BookmarkCard";
import { formatArticleDate } from "@/lib/content";
import type { Blog, Folder, Post } from "@/lib/content";
import { blogPostEditPath, blogPostPath } from "@/lib/public-paths";

const FOLDER_TAGLINES: Record<string, string> = {
  notes: "Private Markdown notes.",
  bookmarks: "Links and sources for later.",
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

function firstBodyLine(body: string): string {
  return (
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function stripLeadingMarkdown(line: string): string {
  return line.replace(/^[\s#*>`-]+/, "").trim();
}

function previewLine(body: string): string {
  const line = stripLeadingMarkdown(firstBodyLine(body));
  if (line.length <= 150) return line;
  const sliced = line.slice(0, 147).trimEnd();
  const wordBreak = sliced.lastIndexOf(" ");
  return `${wordBreak > 60 ? sliced.slice(0, wordBreak) : sliced}...`;
}

function FolderEmptyCard({ mode }: { mode: string }) {
  const copy =
    mode === "bookmarks"
      ? "Save your first link"
      : mode === "notes"
        ? "Write your first note"
        : null;
  if (!copy) return null;
  return (
    <article className="post-folder-page-card">
      <p>{copy}</p>
    </article>
  );
}

function NotesFolderContents({
  blog,
  handle,
  items,
  canCreateItems,
  canEditItems,
}: {
  blog: Blog;
  handle: string;
  items: Post[];
  canCreateItems: boolean;
  canEditItems: boolean;
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
      {canCreateItems && (
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
      )}
      <section className="post-folder-page-items" aria-label="Notes">
        {notes.length === 0 ? (
          <FolderEmptyCard mode="notes" />
        ) : (
          <div className="post-folder-list">
            {notes.map((note) => {
              const preview = previewLine(note.body);
              return (
                <Link
                  key={itemKey(note)}
                  className="post-folder-row"
                  href={
                    canEditItems
                      ? blogPostEditPath(blog, note)
                      : blogPostPath(blog, note)
                  }
                >
                  <span className="post-folder-row-title">
                    {itemTitle(note)}
                  </span>
                  <span className="post-folder-row-meta">
                    {formatArticleDate(note.updatedAt ?? note.date, {
                      style: "short",
                    })}
                  </span>
                  {preview && (
                    <span className="post-folder-row-excerpt">{preview}</span>
                  )}
                </Link>
              );
            })}
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
  canCreateItems,
  canEditItems,
}: {
  blog: Blog;
  handle: string;
  items: Post[];
  canCreateItems: boolean;
  canEditItems: boolean;
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
      {canCreateItems && (
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
      )}
      <section className="post-folder-page-items" aria-label="Bookmarks">
        {bookmarks.length === 0 ? (
          <FolderEmptyCard mode="bookmarks" />
        ) : (
          <div className="post-folder-list">
            {bookmarks.map((bookmark) => (
              <BookmarkCard
                key={itemKey(bookmark)}
                post={bookmark}
                editPath={
                  canEditItems
                    ? blogPostEditPath(blog, bookmark)
                    : blogPostPath(blog, bookmark)
                }
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function BlogFolderContents({
  blog,
  items,
  canEditItems,
}: {
  blog: Blog;
  items: Post[];
  canEditItems: boolean;
}) {
  const sorted = sortedByTimestampDesc(
    items,
    (post) => post.updatedAt ?? post.date ?? "",
  );
  return (
    <section className="post-folder-page-items" aria-label="Folder items">
      {sorted.length === 0 ? (
        <FolderEmptyCard mode="blog" />
      ) : (
        <div className="post-folder-list">
          {sorted.map((post) => {
            const preview = previewLine(post.body);
            return (
              <Link
                key={itemKey(post)}
                className="post-folder-row"
                href={
                  canEditItems
                    ? blogPostEditPath(blog, post)
                    : blogPostPath(blog, post)
                }
              >
                <span className="post-folder-row-title">{itemTitle(post)}</span>
                <span className="post-folder-row-meta">
                  {formatArticleDate(post.updatedAt ?? post.date, {
                    style: "short",
                  })}
                </span>
                {preview && (
                  <span className="post-folder-row-excerpt">{preview}</span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function FolderPage({
  blog,
  folder,
  handle,
  items,
  canCreateItems = true,
  canEditItems = true,
}: {
  blog: Blog;
  folder: Folder;
  handle: string;
  items: Post[];
  canCreateItems?: boolean;
  canEditItems?: boolean;
}) {
  return (
    <main className="post-folder-page" aria-labelledby="post-folder-page-title">
      <header className="post-folder-page-header">
        <span>Folder</span>
        <h1 id="post-folder-page-title">{folder.name}</h1>
        <p>{FOLDER_TAGLINES[folder.mode] ?? ""}</p>
      </header>
      {folder.mode === "blog" ? (
        <BlogFolderContents
          blog={blog}
          items={items}
          canEditItems={canEditItems}
        />
      ) : folder.mode === "bookmarks" ? (
        <BookmarksFolderContents
          blog={blog}
          handle={handle}
          items={items}
          canCreateItems={canCreateItems}
          canEditItems={canEditItems}
        />
      ) : (
        <NotesFolderContents
          blog={blog}
          handle={handle}
          items={items}
          canCreateItems={canCreateItems}
          canEditItems={canEditItems}
        />
      )}
    </main>
  );
}
