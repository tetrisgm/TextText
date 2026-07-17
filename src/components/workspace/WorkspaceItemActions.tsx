"use client";

import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  deleteEditablePostAction,
  setEditablePostCreatedAtAction,
  toggleEditablePostPinnedAction,
  toggleEditablePostStarredAction,
} from "@/app/editor/actions";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import { isPrivatePostType, type Blog, type Post } from "@/lib/content";
import { updatePost } from "@/lib/pool/store";
import { blogPostPath } from "@/lib/public-paths";

function actionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function itemTitle(post: Post): string {
  return post.title.trim() || "Untitled";
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path
        d="m10 2.4 2.25 4.56 5.03.73-3.64 3.55.86 5.01L10 13.89l-4.5 2.36.86-5.01L2.72 7.69l5.03-.73L10 2.4Z"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WorkspaceItemActions({
  blog,
  className = "",
  handle,
  href,
  onDeletePost,
  owner,
  post,
}: {
  blog?: Blog;
  className?: string;
  handle: string;
  href?: string;
  onDeletePost?: (post: Post) => Promise<void> | void;
  owner: boolean;
  post: Post;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useEscapeLayer(open, "Item actions", close);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        close();
      }
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [close, open]);

  if (!owner) return null;

  const stop = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const toggleStar = (event: MouseEvent<HTMLButtonElement>) => {
    stop(event);
    if (!post.id || busy) return;
    const previous = Boolean(post.starred);
    const previousUpdatedAt = post.updatedAt;
    setBusy(true);
    setError(null);
    updatePost(post.id, {
      starred: !previous,
      updatedAt: new Date().toISOString(),
    });
    void toggleEditablePostStarredAction(handle, post.id)
      .then((saved) => {
        updatePost(post.id!, {
          starred: saved.starred,
          updatedAt: saved.updatedAt,
        });
        setOpen(false);
      })
      .catch((actionError) => {
        updatePost(post.id!, {
          starred: previous,
          updatedAt: previousUpdatedAt,
        });
        setError(actionErrorMessage(actionError, "Could not update star"));
      })
      .finally(() => setBusy(false));
  };

  const togglePin = (event: MouseEvent<HTMLButtonElement>) => {
    stop(event);
    if (!post.id || busy) return;
    const previous = Boolean(post.pinned);
    const previousUpdatedAt = post.updatedAt;
    setBusy(true);
    setError(null);
    updatePost(post.id, {
      pinned: !previous,
      updatedAt: new Date().toISOString(),
    });
    void toggleEditablePostPinnedAction(handle, post.id)
      .then((saved) => {
        updatePost(post.id!, {
          pinned: saved.pinned,
          updatedAt: saved.updatedAt,
        });
        setOpen(false);
      })
      .catch((actionError) => {
        updatePost(post.id!, {
          pinned: previous,
          updatedAt: previousUpdatedAt,
        });
        setError(actionErrorMessage(actionError, "Could not update pin"));
      })
      .finally(() => setBusy(false));
  };

  const share = (event: MouseEvent<HTMLButtonElement>) => {
    stop(event);
    const target = href ?? (blog ? blogPostPath(blog, post) : window.location.href);
    const url = new URL(target, window.location.origin);
    void navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  const setCreatedDate = (value: string) => {
    if (!post.id || !value || busy) return;
    const previous = post.createdAt;
    setBusy(true);
    setError(null);
    updatePost(post.id, { createdAt: `${value}T12:00:00.000Z` });
    void setEditablePostCreatedAtAction(handle, post.id, value)
      .then((saved) => {
        updatePost(post.id!, { createdAt: saved.createdAt });
        setOpen(false);
      })
      .catch((actionError) => {
        updatePost(post.id!, { createdAt: previous });
        setError(actionErrorMessage(actionError, "Could not change date"));
      })
      .finally(() => setBusy(false));
  };

  const confirmDelete = () => {
    if (!post.id || busy) return;
    setBusy(true);
    const request = onDeletePost
      ? Promise.resolve(onDeletePost(post))
      : deleteEditablePostAction(handle, post.id).then(() => router.refresh());
    void request
      .then(() => {
        setDeleteOpen(false);
        setOpen(false);
      })
      .catch((actionError) => {
        setError(actionErrorMessage(actionError, "Could not move to Trash"));
        setDeleteOpen(false);
        setOpen(true);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div
      className={`workspace-item-actions${className ? ` ${className}` : ""}`}
      ref={rootRef}
      onClick={stop}
    >
      <button
        type="button"
        className="workspace-item-star"
        aria-label={post.starred ? "Unstar" : "Star"}
        aria-pressed={Boolean(post.starred)}
        disabled={!post.id || busy}
        onClick={toggleStar}
      >
        <StarIcon filled={Boolean(post.starred)} />
      </button>
      <button
        type="button"
        className="workspace-item-actions-trigger"
        aria-label="Item actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          stop(event);
          setError(null);
          setOpen((value) => !value);
        }}
      >
        ···
      </button>
      {open && (
        <div
          className="workspace-item-actions-menu"
          role="menu"
          data-post-edit-menu-open="true"
        >
          <button type="button" role="menuitem" disabled={busy} onClick={toggleStar}>
            {post.starred ? "Unstar" : "Star"}
          </button>
          {!isPrivatePostType(post.type) && (
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={togglePin}
            >
              {post.pinned ? "Unpin from blog" : "Pin to blog"}
            </button>
          )}
          <button type="button" role="menuitem" onClick={share}>
            {copied ? "Link copied" : "Share"}
          </button>
          <label className="workspace-item-actions-date">
            <span>Created</span>
            <input
              type="date"
              value={(post.createdAt ?? post.date ?? "").slice(0, 10)}
              disabled={busy}
              onChange={(event) => setCreatedDate(event.currentTarget.value)}
            />
          </label>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            disabled={!post.id || busy}
            onClick={(event) => {
              stop(event);
              setOpen(false);
              setDeleteOpen(true);
            }}
          >
            Move to Trash
          </button>
          {error && (
            <span className="workspace-item-actions-error" role="alert">
              {error}
            </span>
          )}
        </div>
      )}
      <ConfirmationDialog
        open={deleteOpen}
        title={`Move ${itemTitle(post)} to Trash?`}
        message="You can restore it later from Trash."
        confirmLabel="Move to Trash"
        confirmingLabel="Moving"
        confirming={busy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
