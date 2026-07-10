"use client";

// The workspace view of a folder: a quiet list rendered per folder mode inside
// the home workspace shell. Notes and bookmarks stay unlisted; sharing only
// grants named collaborators access.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import type { FormEvent, MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createFolderItemAction,
  createWorkspacePostAction,
  updateBlogNameAction,
} from "@/app/editor/actions";
import { BookmarkCard } from "@/components/bookmarks/BookmarkCard";
import { PostCard } from "@/components/PostCard";
import { formatArticleDate, postBodyPreview } from "@/lib/content";
import type { Blog, Folder, Post } from "@/lib/content";
import { blogPostEditPath, blogPostPath } from "@/lib/public-paths";

export type FolderCreateRequest =
  | { type: "article"; folderPath: string }
  | { type: "note"; folderPath: string; title?: string }
  | {
      type: "bookmark";
      folderPath: string;
      description?: string;
      url: string;
      title?: string;
    };

export type FolderCreateItem = (request: FolderCreateRequest) => void;
export type FolderDeleteItem = (post: Post) => Promise<void> | void;
export type FolderCaptureResolved = (post: Post) => void;

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

function domSafeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function postOptionId(postId: string | null | undefined): string | undefined {
  return postId ? `workspace-post-${domSafeId(postId)}` : undefined;
}

function actionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isDefaultWorkspaceName(name: string): boolean {
  const normalized = name.trim().replace(/\s+/g, " ").toLowerCase();
  return !normalized || normalized === "untitled blog";
}

function shouldOpenLocally(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
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

function bookmarkUrlParts(rawUrl: string): { href: string; host: string } {
  const raw = rawUrl.trim();
  const candidates = [raw, `https://${raw}`];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      return {
        href: url.toString(),
        host: url.hostname.replace(/^www\./, ""),
      };
    } catch {
      // Try the next forgiving candidate.
    }
  }
  return { href: raw, host: raw };
}

function optimisticBookmarkPost({
  url,
  title,
  description,
}: {
  url: string;
  title?: string;
  description?: string;
}): Post {
  const now = new Date().toISOString();
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const { href, host } = bookmarkUrlParts(url);
  const resolvedTitle = title?.trim() || host || "Bookmark";
  return {
    id: `optimistic-bookmark-${stamp}`,
    type: "bookmark",
    captureStatus: "pending",
    capture: { url: href },
    slug: `untitled-${stamp}`,
    title: resolvedTitle,
    excerpt: description?.trim() || href,
    body: "",
    status: "draft",
    pinned: false,
    links: [{ label: host || resolvedTitle, href }],
    date: now.slice(0, 10),
    createdAt: now,
    updatedAt: now,
  };
}

function FolderEmptyCard({
  actionLabel,
  busy = false,
  children,
  onAction,
}: {
  actionLabel?: ReactNode;
  busy?: boolean;
  children: string;
  onAction?: () => void;
}) {
  return (
    <article className="post-folder-page-card">
      <p>{children}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          className="post-folder-create ac-btn ac-btn-filled"
          disabled={busy}
          onClick={onAction}
        >
          {busy ? "Creating" : actionLabel}
        </button>
      )}
    </article>
  );
}

function BlogFolderTitleEditor({
  blog,
  canEdit,
}: {
  blog: Blog;
  canEdit: boolean;
}) {
  const router = useRouter();
  const defaultName = isDefaultWorkspaceName(blog.name);
  const [editing, setEditing] = useState(defaultName);
  const [name, setName] = useState(defaultName ? "" : blog.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const cleanName = name.trim().replace(/\s+/g, " ");

  const saveName = useCallback(() => {
    if (!canEdit || saving) return;
    if (!cleanName) return;
    setSaving(true);
    setError(null);
    startTransition(() => {
      void updateBlogNameAction(blog.handle, cleanName)
        .then((result) => {
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setName(result.name);
          setEditing(false);
          router.refresh();
        })
        .catch((saveError) => {
          setError(actionErrorMessage(saveError, "Could not rename"));
        })
        .finally(() => setSaving(false));
    });
  }, [blog.handle, canEdit, cleanName, router, saving, startTransition]);

  if (!canEdit || !editing) {
    return (
      <div className="post-folder-title-row">
        <h1 id="post-folder-page-title">
          {defaultName ? "Name your page" : blog.name}
        </h1>
        {canEdit && (
          <button
            type="button"
            className="post-folder-title-edit ac-btn ac-btn-gray"
            onClick={() => {
              setName(defaultName ? "" : blog.name);
              setEditing(true);
              setError(null);
            }}
          >
            Edit
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      className="post-folder-title-form"
      onSubmit={(event) => {
        event.preventDefault();
        saveName();
      }}
    >
      <input
        id="post-folder-page-title"
        className="post-folder-title-input"
        value={name}
        placeholder="Name your page"
        aria-label="Page name"
        autoFocus
        onBlur={() => {
          if (cleanName) saveName();
        }}
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !defaultName) {
            event.preventDefault();
            setName(blog.name);
            setEditing(false);
            setError(null);
          }
        }}
      />
      <button
        type="submit"
        className="post-folder-title-confirm ac-btn ac-btn-filled"
        disabled={!cleanName || saving}
        onPointerDown={(event) => event.preventDefault()}
      >
        {saving ? "Saving" : "Confirm"}
      </button>
      {error && (
        <span className="post-folder-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

function NotesFolderContents({
  blog,
  handle,
  items,
  canCreateItems,
  canEditItems,
  folderPath,
  onCreateItem,
  onDeleteItem,
  onOpenPost,
  selectedPostId,
}: {
  blog: Blog;
  handle: string;
  items: Post[];
  canCreateItems: boolean;
  canEditItems: boolean;
  folderPath: string;
  onCreateItem?: FolderCreateItem;
  onDeleteItem?: FolderDeleteItem;
  onOpenPost?: (post: Post) => void;
  selectedPostId?: string | null;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const createNote = useCallback(() => {
    if (creating) return;
    if (onCreateItem) {
      setError(null);
      onCreateItem({ type: "note", folderPath });
      return;
    }
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
  }, [blog, creating, folderPath, handle, onCreateItem, router]);

  const notes = useMemo(
    () =>
      sortedByTimestampDesc(
        items,
        (post) => post.updatedAt ?? post.date ?? "",
      ),
    [items],
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
          <FolderEmptyCard
            actionLabel={canCreateItems ? "New note" : undefined}
            busy={creating}
            onAction={canCreateItems ? createNote : undefined}
          >
            Write your first private note.
          </FolderEmptyCard>
        ) : (
          <div
            className="post-folder-list"
            role="listbox"
            aria-label="Notes"
            aria-activedescendant={postOptionId(selectedPostId)}
          >
            {notes.map((note) => {
              const preview = previewLine(postBodyPreview(note));
              const selected = note.id === selectedPostId;
              return (
                <Link
                  key={itemKey(note)}
                  id={postOptionId(note.id)}
                  className={`post-folder-row${
                    selected ? " is-command-selected" : ""
                  }`}
                  role="option"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  data-workspace-post-id={note.id}
                  href={
                    onOpenPost
                      ? blogPostPath(blog, note)
                      : canEditItems
                        ? blogPostEditPath(blog, note)
                        : blogPostPath(blog, note)
                  }
                  prefetch={onOpenPost ? false : undefined}
                  onClick={(event) => {
                    if (!onOpenPost || !shouldOpenLocally(event)) return;
                    event.preventDefault();
                    onOpenPost(note);
                  }}
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
  folderPath,
  onCaptureResolved,
  onCreateItem,
  onDeleteItem,
  onOpenPost,
  createRequestKey,
  selectedPostId,
}: {
  blog: Blog;
  handle: string;
  items: Post[];
  canCreateItems: boolean;
  canEditItems: boolean;
  folderPath: string;
  onCaptureResolved?: FolderCaptureResolved;
  onCreateItem?: FolderCreateItem;
  onDeleteItem?: FolderDeleteItem;
  onOpenPost?: (post: Post) => void;
  createRequestKey?: number;
  selectedPostId?: string | null;
}) {
  const router = useRouter();
  const urlRef = useRef<HTMLInputElement>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localBookmarks, setLocalBookmarks] = useState<Post[]>([]);
  const [, startTransition] = useTransition();

  const openForm = useCallback(() => {
    setError(null);
    setFormOpen(true);
    window.requestAnimationFrame(() => {
      urlRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (!createRequestKey) return;
    const frame = window.requestAnimationFrame(openForm);
    return () => window.cancelAnimationFrame(frame);
  }, [createRequestKey, openForm]);

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
      const description = String(data.get("description") ?? "").trim();
      if (!url) {
        setError("A bookmark needs a link");
        return;
      }

      if (onCreateItem) {
        form.reset();
        setFormOpen(false);
        setError(null);
        onCreateItem({
          type: "bookmark",
          folderPath,
          url,
          description: description || undefined,
          title: title || undefined,
        });
        return;
      }

      const optimistic = optimisticBookmarkPost({
        url,
        title: title || undefined,
        description: description || undefined,
      });
      setLocalBookmarks((current) => [optimistic, ...current]);
      form.reset();
      setFormOpen(false);
      setError(null);
      startTransition(() => {
        void createFolderItemAction(handle, "bookmarks", {
          url,
          description: description || undefined,
          title: title || undefined,
        })
          .then((saved) => {
            setLocalBookmarks((current) =>
              current.map((bookmark) =>
                bookmark.id === optimistic.id ? saved : bookmark,
              ),
            );
            router.refresh();
          })
          .catch((saveError) => {
            setLocalBookmarks((current) =>
              current.filter((bookmark) => bookmark.id !== optimistic.id),
            );
            setError(
              actionErrorMessage(saveError, "Could not save the bookmark"),
            );
          })
          .finally(() => setSaving(false));
      });
    },
    [folderPath, handle, onCreateItem, router, saving],
  );

  const bookmarks = useMemo(
    () => {
      const persistedIds = new Set(
        items.flatMap((post) => (post.id ? [post.id] : [])),
      );
      const pending = localBookmarks.filter(
        (post) => !post.id || !persistedIds.has(post.id),
      );
      return sortedByTimestampDesc(
        [...pending, ...items],
        (post) => post.createdAt ?? post.date ?? "",
      );
    },
    [items, localBookmarks],
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
              <input
                className="post-folder-field is-description"
                name="description"
                type="text"
                placeholder="Description (optional)"
                aria-label="Bookmark description"
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
          <FolderEmptyCard
            actionLabel={canCreateItems ? "Add bookmark" : undefined}
            onAction={canCreateItems ? openForm : undefined}
          >
            Save your first link.
          </FolderEmptyCard>
        ) : (
          <div
            className="post-folder-list"
            role="listbox"
            aria-label="Bookmarks"
            aria-activedescendant={postOptionId(selectedPostId)}
          >
            {bookmarks.map((bookmark) => {
              const selected = bookmark.id === selectedPostId;
              return (
                <BookmarkCard
                  key={itemKey(bookmark)}
                  post={bookmark}
                  selected={selected}
                  optionId={postOptionId(bookmark.id)}
                  optionTabIndex={selected ? 0 : -1}
                  owner={canEditItems}
                  handle={handle}
                  editPath={
                    onOpenPost
                      ? blogPostPath(blog, bookmark)
                      : canEditItems
                        ? blogPostEditPath(blog, bookmark)
                        : blogPostPath(blog, bookmark)
                  }
                  onCaptureResolved={onCaptureResolved}
                  onDeletePost={onDeleteItem}
                  onOpenPost={onOpenPost}
                />
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function BlogFolderContents({
  blog,
  handle,
  items,
  canCreateItems,
  canEditItems,
  folderPath,
  onCreateItem,
  onDeleteItem,
  onOpenPost,
  selectedPostId,
}: {
  blog: Blog;
  handle: string;
  items: Post[];
  canCreateItems: boolean;
  canEditItems: boolean;
  folderPath: string;
  onCreateItem?: FolderCreateItem;
  onDeleteItem?: FolderDeleteItem;
  onOpenPost?: (post: Post) => void;
  selectedPostId?: string | null;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const sorted = useMemo(
    () =>
      sortedByTimestampDesc(
        items,
        (post) => post.updatedAt ?? post.date ?? "",
      ),
    [items],
  );

  const createArticle = useCallback(() => {
    if (creating) return;
    if (onCreateItem) {
      setError(null);
      onCreateItem({ type: "article", folderPath });
      return;
    }
    setCreating(true);
    setError(null);
    startTransition(() => {
      void createWorkspacePostAction(handle, "article", "blog")
        .then((post) => {
          router.push(blogPostEditPath(blog, post));
        })
        .catch((createError) => {
          setCreating(false);
          setError(
            actionErrorMessage(createError, "Could not create the article"),
          );
        });
    });
  }, [blog, creating, folderPath, handle, onCreateItem, router]);

  return (
    <>
      {canCreateItems && sorted.length > 0 && (
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
            onClick={createArticle}
          >
            {creating ? (
              "Creating"
            ) : (
              <>
                <span className="shortcut-letter">C</span>reate post
              </>
            )}
          </button>
        </div>
      )}
      <section className="post-folder-page-items" aria-label="Folder items">
        {sorted.length === 0 ? (
          <>
            {error && (
              <span className="post-folder-error" role="alert">
                {error}
              </span>
            )}
            <FolderEmptyCard
              actionLabel={
                canCreateItems ? (
                  <>
                    <span className="shortcut-letter">C</span>reate post
                  </>
                ) : undefined
              }
              busy={creating}
              onAction={canCreateItems ? createArticle : undefined}
            >
              Start the first article in this folder.
            </FolderEmptyCard>
          </>
        ) : (
          <div
            className="tv-grid post-folder-card-grid"
            role="listbox"
            aria-label="Folder items"
            aria-activedescendant={postOptionId(selectedPostId)}
          >
            {sorted.map((post) => {
              const selected = post.id === selectedPostId;
              return (
                <div
                  key={itemKey(post)}
                  id={postOptionId(post.id)}
                  className={`post-folder-card-option${
                    selected ? " is-command-selected" : ""
                  }`}
                  role="option"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  data-workspace-post-id={post.id}
                >
                  <PostCard
                    blog={blog}
                    handle={handle}
                    post={post}
                    owner={canEditItems}
                    href={
                      canEditItems
                        ? blogPostPath(blog, post)
                        : blogPostPath(blog, post)
                    }
                    onOpen={
                      onOpenPost
                        ? (event) => {
                            if (!shouldOpenLocally(event)) return;
                            event.preventDefault();
                            onOpenPost(post);
                          }
                        : undefined
                    }
                    onDeletePost={onDeleteItem}
                  />
                </div>
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
  canCreateItems = true,
  canEditItems = true,
  onCaptureResolved,
  onCreateItem,
  onDeleteItem,
  onOpenPost,
  createBookmarkRequestKey,
  selectedPostId,
}: {
  blog: Blog;
  folder: Folder;
  handle: string;
  items: Post[];
  canCreateItems?: boolean;
  canEditItems?: boolean;
  onCaptureResolved?: FolderCaptureResolved;
  onCreateItem?: FolderCreateItem;
  onDeleteItem?: FolderDeleteItem;
  onOpenPost?: (post: Post) => void;
  createBookmarkRequestKey?: number;
  selectedPostId?: string | null;
}) {
  const folderTagline = FOLDER_TAGLINES[folder.mode] ?? "";
  return (
    <main className="post-folder-page" aria-labelledby="post-folder-page-title">
      <header className="post-folder-page-header">
        <span>Folder</span>
        {folder.mode === "blog" ? (
          <BlogFolderTitleEditor blog={blog} canEdit={canEditItems} />
        ) : (
          <h1 id="post-folder-page-title">{folder.name}</h1>
        )}
        {folderTagline && <p>{folderTagline}</p>}
      </header>
      {folder.mode === "blog" ? (
        <BlogFolderContents
          blog={blog}
          handle={handle}
          items={items}
          canCreateItems={canCreateItems}
          canEditItems={canEditItems}
          folderPath={folder.path}
          onCreateItem={onCreateItem}
          onDeleteItem={onDeleteItem}
          onOpenPost={onOpenPost}
          selectedPostId={selectedPostId}
        />
      ) : folder.mode === "bookmarks" ? (
        <BookmarksFolderContents
          blog={blog}
          handle={handle}
          items={items}
          canCreateItems={canCreateItems}
          canEditItems={canEditItems}
          folderPath={folder.path}
          onCaptureResolved={onCaptureResolved}
          onCreateItem={onCreateItem}
          onDeleteItem={onDeleteItem}
          onOpenPost={onOpenPost}
          createRequestKey={createBookmarkRequestKey}
          selectedPostId={selectedPostId}
        />
      ) : (
        <NotesFolderContents
          blog={blog}
          handle={handle}
          items={items}
          canCreateItems={canCreateItems}
          canEditItems={canEditItems}
          folderPath={folder.path}
          onCreateItem={onCreateItem}
          onOpenPost={onOpenPost}
          selectedPostId={selectedPostId}
        />
      )}
    </main>
  );
}
