"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import {
  addItemCommentAction,
  listItemCommentsAction,
  reopenItemCommentAction,
  replyItemCommentAction,
  resolveItemCommentAction,
} from "@/app/editor/actions";
import type { ItemCommentView } from "@/app/editor/actions";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import styles from "./CommentsDialog.module.css";

type CommentThread = {
  root: ItemCommentView;
  replies: ItemCommentView[];
};

export type CommentsDialogProps = {
  canResolve: boolean;
  handle: string;
  open: boolean;
  postId: string;
  postTitle: string;
  onClose: () => void;
  onOpenCountChange?: (count: number) => void;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function commentTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function groupCommentThreads(
  comments: ItemCommentView[],
): CommentThread[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const roots: ItemCommentView[] = [];
  const repliesByRoot = new Map<string, ItemCommentView[]>();

  const rootIdFor = (comment: ItemCommentView): string | null => {
    let current = comment;
    const visited = new Set<string>([comment.id]);
    while (current.parentId) {
      if (visited.has(current.parentId)) return null;
      visited.add(current.parentId);
      const parent = byId.get(current.parentId);
      if (!parent) return null;
      current = parent;
    }
    return current.id;
  };

  for (const comment of comments) {
    if (!comment.parentId || !byId.has(comment.parentId)) roots.push(comment);
  }
  for (const comment of comments) {
    if (!comment.parentId || !byId.has(comment.parentId)) continue;
    const rootId = rootIdFor(comment);
    if (!rootId || rootId === comment.id) continue;
    const replies = repliesByRoot.get(rootId) ?? [];
    replies.push(comment);
    repliesByRoot.set(rootId, replies);
  }

  return roots
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((root) => ({
      root,
      replies: (repliesByRoot.get(root.id) ?? []).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      ),
    }));
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m4 4 8 8m0-8-8 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.5 4 2.75 7.5 6.5 11M3 7.5h5.25A4.75 4.75 0 0 1 13 12.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function ResolveIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="m5.3 8.1 1.7 1.7 3.8-3.9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
    </svg>
  );
}

function ReopenIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.1 5.2A5.2 5.2 0 1 1 3 9M4.1 5.2V2.4m0 2.8H1.3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function submitOnModifiedEnter(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
) {
  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function CommentRow({
  comment,
  reply,
}: {
  comment: ItemCommentView;
  reply?: boolean;
}) {
  return (
    <div className={reply ? styles.replyRow : styles.commentRow}>
      <span className={styles.avatar} aria-hidden="true">
        {initials(comment.authorName)}
      </span>
      <div className={styles.commentMain}>
        <div className={styles.commentMeta}>
          <strong>{comment.authorName}</strong>
          <time dateTime={comment.createdAt}>{commentTime(comment.createdAt)}</time>
        </div>
        <p className={styles.commentBody}>{comment.body}</p>
      </div>
    </div>
  );
}

export function CommentsDialog({
  canResolve,
  handle,
  open,
  postId,
  postTitle,
  onClose,
  onOpenCountChange,
}: CommentsDialogProps) {
  const titleId = useId();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [comments, setComments] = useState<ItemCommentView[]>([]);
  const [loadedPostId, setLoadedPostId] = useState<string | null>(null);
  const [mode, setMode] = useState<"open" | "resolved">("open");
  const [creating, setCreating] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const [composer, setComposer] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const threads = useMemo(() => groupCommentThreads(comments), [comments]);
  const openThreads = useMemo(
    () => threads.filter((thread) => !thread.root.resolved),
    [threads],
  );
  const resolvedThreads = useMemo(
    () => threads.filter((thread) => thread.root.resolved),
    [threads],
  );
  const visibleThreads = mode === "open" ? openThreads : resolvedThreads;
  const loading = loadedPostId !== postId;

  useEffect(() => {
    onOpenCountChange?.(openThreads.length);
  }, [onOpenCountChange, openThreads.length]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    listItemCommentsAction(handle, postId)
      .then((nextComments) => {
        if (!active) return;
        setComments(nextComments);
        setLoadedPostId(postId);
        setError(null);
        setReplyingId(null);
        setReplyBody("");
      })
      .catch((loadError) => {
        if (active) {
          setComments([]);
          setLoadedPostId(postId);
          setError(errorMessage(loadError, "Could not load comments."));
        }
      });
    const frame = window.requestAnimationFrame(() => composerRef.current?.focus());
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
  }, [handle, open, postId]);

  useEscapeLayer(open, "Comments", onClose);

  const closeFromBackdrop = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  const addComment = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const body = composer.trim();
      if (!body || creating) return;
      const previous = comments;
      const now = new Date().toISOString();
      const optimistic: ItemCommentView = {
        id: `optimistic-${Date.now()}`,
        parentId: null,
        body,
        authorName: "You",
        createdAt: now,
        updatedAt: now,
        resolved: false,
        resolvedAt: null,
        anchor: null,
      };
      setCreating(true);
      setError(null);
      setComposer("");
      setMode("open");
      setComments((current) => [...current, optimistic]);
      try {
        setComments(await addItemCommentAction(handle, postId, body));
      } catch (createError) {
        setComments(previous);
        setComposer(body);
        setError(errorMessage(createError, "Could not add comment."));
      } finally {
        setCreating(false);
        composerRef.current?.focus();
      }
    },
    [comments, composer, creating, handle, postId],
  );

  const addReply = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const parentId = replyingId;
      const body = replyBody.trim();
      if (!parentId || !body || replying) return;
      const previous = comments;
      const now = new Date().toISOString();
      const optimistic: ItemCommentView = {
        id: `optimistic-reply-${Date.now()}`,
        parentId,
        body,
        authorName: "You",
        createdAt: now,
        updatedAt: now,
        resolved: false,
        resolvedAt: null,
        anchor: null,
      };
      setReplying(true);
      setError(null);
      setComments((current) => [...current, optimistic]);
      setReplyBody("");
      try {
        setComments(
          await replyItemCommentAction(handle, postId, parentId, body),
        );
        setReplyingId(null);
      } catch (replyError) {
        setComments(previous);
        setReplyBody(body);
        setError(errorMessage(replyError, "Could not add reply."));
      } finally {
        setReplying(false);
      }
    },
    [comments, handle, postId, replyBody, replying, replyingId],
  );

  const changeResolution = useCallback(
    async (thread: CommentThread) => {
      if (!canResolve || resolvingId) return;
      const resolved = !thread.root.resolved;
      const previous = comments;
      const resolvedAt = resolved ? new Date().toISOString() : null;
      setResolvingId(thread.root.id);
      setError(null);
      setComments((current) =>
        current.map((comment) =>
          comment.id === thread.root.id
            ? { ...comment, resolved, resolvedAt }
            : comment,
        ),
      );
      try {
        const action = resolved
          ? resolveItemCommentAction
          : reopenItemCommentAction;
        setComments(await action(handle, postId, thread.root.id));
      } catch (resolveError) {
        setComments(previous);
        setError(
          errorMessage(
            resolveError,
            resolved ? "Could not resolve comment." : "Could not reopen comment.",
          ),
        );
      } finally {
        setResolvingId(null);
      }
    },
    [canResolve, comments, handle, postId, resolvingId],
  );

  if (!open) return null;

  return (
    <div className={`applecms ${styles.backdrop}`} onMouseDown={closeFromBackdrop}>
      <section
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h2 id={titleId}>Comments</h2>
            <p>{postTitle}</p>
          </div>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="Close comments"
            title="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className={styles.segmented} aria-label="Comment status">
          <button
            type="button"
            aria-pressed={mode === "open"}
            onClick={() => setMode("open")}
          >
            Open <span>{openThreads.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={mode === "resolved"}
            onClick={() => setMode("resolved")}
          >
            Resolved <span>{resolvedThreads.length}</span>
          </button>
        </div>

        {error && (
          <p className={styles.error} role="status">
            {error}
          </p>
        )}

        <div className={styles.threadList} aria-busy={loading}>
          {loading ? (
            <div className={styles.emptyState}>Loading comments</div>
          ) : visibleThreads.length === 0 ? (
            <div className={styles.emptyState}>
              {mode === "open" ? "No open comments" : "No resolved comments"}
            </div>
          ) : (
            visibleThreads.map((thread) => (
              <article
                className={styles.thread}
                data-resolved={thread.root.resolved ? "true" : undefined}
                key={thread.root.id}
              >
                <CommentRow comment={thread.root} />
                {thread.replies.length > 0 && (
                  <div className={styles.replies}>
                    {thread.replies.map((reply) => (
                      <CommentRow comment={reply} key={reply.id} reply />
                    ))}
                  </div>
                )}
                <div className={styles.threadActions}>
                  {!thread.root.resolved && (
                    <button
                      type="button"
                      onClick={() => {
                        setReplyingId(thread.root.id);
                        setReplyBody("");
                      }}
                    >
                      <ReplyIcon />
                      Reply
                    </button>
                  )}
                  {canResolve && (
                    <button
                      type="button"
                      disabled={resolvingId === thread.root.id}
                      title={thread.root.resolved ? "Reopen comment" : "Resolve comment"}
                      onClick={() => void changeResolution(thread)}
                    >
                      {thread.root.resolved ? <ReopenIcon /> : <ResolveIcon />}
                      {thread.root.resolved ? "Reopen" : "Resolve"}
                    </button>
                  )}
                </div>
                {replyingId === thread.root.id && !thread.root.resolved && (
                  <form className={styles.replyForm} onSubmit={addReply}>
                    <textarea
                      value={replyBody}
                      maxLength={4_000}
                      rows={2}
                      autoFocus
                      aria-label="Reply"
                      aria-keyshortcuts="Meta+Enter Control+Enter"
                      placeholder="Reply"
                      disabled={replying}
                      onChange={(event) => setReplyBody(event.currentTarget.value)}
                      onKeyDown={submitOnModifiedEnter}
                    />
                    <div>
                      <button
                        type="button"
                        disabled={replying}
                        onClick={() => {
                          setReplyingId(null);
                          setReplyBody("");
                        }}
                      >
                        Cancel
                      </button>
                      <button type="submit" disabled={!replyBody.trim() || replying}>
                        {replying ? "Replying" : "Reply"}
                      </button>
                    </div>
                  </form>
                )}
              </article>
            ))
          )}
        </div>

        <form className={styles.composer} onSubmit={addComment}>
          <textarea
            ref={composerRef}
            value={composer}
            maxLength={4_000}
            rows={3}
            aria-label="Add a comment"
            aria-keyshortcuts="Meta+Enter Control+Enter"
            placeholder="Add a comment"
            disabled={creating}
            onChange={(event) => setComposer(event.currentTarget.value)}
            onKeyDown={submitOnModifiedEnter}
          />
          <button type="submit" disabled={!composer.trim() || creating}>
            {creating ? "Posting" : "Post"}
          </button>
        </form>
      </section>
    </div>
  );
}
