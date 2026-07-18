"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  addItemCommentAction,
  listItemCommentsAction,
  reopenItemCommentAction,
  replyItemCommentAction,
  resolveItemCommentAction,
  type ItemCommentView,
} from "@/app/editor/actions";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import { groupCommentThreads } from "@/components/workspace/comment-threads";
import { locateWorkspaceItemTextSelection } from "@/lib/ai/workspace-item-draft";
import styles from "./ReaderComments.module.css";

type SelectionAnchor = {
  end: number;
  exact: string;
  rect: DOMRect;
  start: number;
};

type ThreadPosition = {
  id: string;
  left: number;
  top: number;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readerProse(marker: HTMLDivElement | null): HTMLElement | null {
  return marker?.parentElement?.querySelector<HTMLElement>(".reader-prose") ?? null;
}

function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("script, style, button, textarea")) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

export function findReaderQuoteRange(
  root: HTMLElement,
  quote: string,
): Range | null {
  const nodes = textNodes(root);
  const source = nodes.map((node) => node.data).join("");
  const start = source.indexOf(quote);
  if (start < 0) return null;
  const end = start + quote.length;
  let cursor = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;

  for (const node of nodes) {
    const next = cursor + node.data.length;
    if (!startNode && start >= cursor && start <= next) {
      startNode = node;
      startOffset = start - cursor;
    }
    if (end >= cursor && end <= next) {
      endNode = node;
      endOffset = end - cursor;
      break;
    }
    cursor = next;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function selectionAnchor(
  root: HTMLElement,
  sourceBody: string,
): SelectionAnchor | null {
  const selection = window.getSelection();
  if (
    !selection ||
    selection.isCollapsed ||
    selection.rangeCount === 0 ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  ) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(root);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const afterRange = document.createRange();
  afterRange.selectNodeContents(root);
  afterRange.setStart(range.endContainer, range.endOffset);
  const located = locateWorkspaceItemTextSelection(
    "body",
    sourceBody,
    selection.toString(),
    {
      beforeText: beforeRange.toString(),
      afterText: afterRange.toString(),
    },
  );
  if (!located) return null;
  return {
    end: located.end,
    exact: located.text,
    rect,
    start: located.start,
  };
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 3.25h10v7H7.4L4.2 13v-2.75H3v-7Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}

export function ReaderComments({
  canResolve,
  handle,
  postId,
  sourceBody,
}: {
  canResolve: boolean;
  handle: string;
  postId: string;
  sourceBody: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [comments, setComments] = useState<ItemCommentView[]>([]);
  const [selection, setSelection] = useState<SelectionAnchor | null>(null);
  const [composing, setComposing] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadPositions, setThreadPositions] = useState<ThreadPosition[]>([]);
  const [body, setBody] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threads = useMemo(() => groupCommentThreads(comments), [comments]);
  const activeThread = threads.find((thread) => thread.root.id === activeThreadId);

  const closePopover = useCallback(() => {
    setComposing(false);
    setActiveThreadId(null);
    setBody("");
    setReplyBody("");
    setError(null);
  }, []);
  useEscapeLayer(composing || Boolean(activeThreadId), "Comment", closePopover);

  useEffect(() => {
    let active = true;
    listItemCommentsAction(handle, postId)
      .then((next) => {
        if (active) setComments(next);
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError, "Could not load comments."));
      });
    return () => {
      active = false;
    };
  }, [handle, postId]);

  const updateThreadPositions = useCallback(() => {
    const root = readerProse(rootRef.current);
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const next = threads
      .filter((thread) => !thread.root.resolved && thread.root.anchor?.field === "body")
      .map((thread) => {
        const range = findReaderQuoteRange(
          root,
          thread.root.anchor?.exactQuote ?? "",
        );
        const rect = range?.getBoundingClientRect();
        return rect && (rect.width || rect.height)
          ? {
              id: thread.root.id,
              left: clamp(rootRect.right + 8, 8, window.innerWidth - 38),
              top: rect.top + rect.height / 2,
            }
          : null;
      })
      .filter((value): value is ThreadPosition => Boolean(value))
      .map((value) => ({
        ...value,
        top: clamp(value.top, rootRect.top + 12, rootRect.bottom - 12),
      }));
    setThreadPositions(next);
  }, [threads]);

  useEffect(() => {
    let frame = 0;
    const schedulePositionUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateThreadPositions);
    };
    schedulePositionUpdate();
    const root = readerProse(rootRef.current);
    const observer =
      root && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(schedulePositionUpdate)
        : null;
    if (root) observer?.observe(root);
    window.addEventListener("resize", schedulePositionUpdate);
    document.addEventListener("scroll", schedulePositionUpdate, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedulePositionUpdate);
      document.removeEventListener("scroll", schedulePositionUpdate, true);
    };
  }, [updateThreadPositions]);

  useEffect(() => {
    const capture = () => {
      if (composing || activeThreadId) return;
      const root = readerProse(rootRef.current);
      setSelection(root ? selectionAnchor(root, sourceBody) : null);
    };
    document.addEventListener("pointerup", capture);
    document.addEventListener("keyup", capture);
    return () => {
      document.removeEventListener("pointerup", capture);
      document.removeEventListener("keyup", capture);
    };
  }, [activeThreadId, composing, sourceBody]);

  useEffect(() => {
    if (!composing && !activeThreadId) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!popoverRef.current?.contains(event.target)) closePopover();
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [activeThreadId, closePopover, composing]);

  const startComment = () => {
    if (!selection) return;
    setComposing(true);
    setActiveThreadId(null);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const submitComment = async (event: FormEvent) => {
    event.preventDefault();
    const clean = body.trim();
    if (!clean || !selection || saving) return;
    setSaving(true);
    setError(null);
    try {
      setComments(
        await addItemCommentAction(
          handle,
          postId,
          clean,
          "body",
          selection.exact,
          selection.start,
          selection.end,
        ),
      );
      closePopover();
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    } catch (saveError) {
      setError(errorMessage(saveError, "Could not add comment."));
    } finally {
      setSaving(false);
    }
  };

  const submitReply = async (event: FormEvent) => {
    event.preventDefault();
    const clean = replyBody.trim();
    if (!clean || !activeThread || saving) return;
    setSaving(true);
    setError(null);
    try {
      setComments(
        await replyItemCommentAction(handle, postId, activeThread.root.id, clean),
      );
      setReplyBody("");
    } catch (saveError) {
      setError(errorMessage(saveError, "Could not add reply."));
    } finally {
      setSaving(false);
    }
  };

  const toggleResolution = async () => {
    if (!activeThread || !canResolve || saving) return;
    setSaving(true);
    setError(null);
    try {
      const action = activeThread.root.resolved
        ? reopenItemCommentAction
        : resolveItemCommentAction;
      setComments(await action(handle, postId, activeThread.root.id));
      if (!activeThread.root.resolved) closePopover();
    } catch (saveError) {
      setError(errorMessage(saveError, "Could not update comment."));
    } finally {
      setSaving(false);
    }
  };

  const selectionPosition = selection
    ? {
        left: clamp(selection.rect.right + 8, 8, window.innerWidth - 104),
        top: clamp(selection.rect.bottom + 8, 8, window.innerHeight - 42),
      }
    : null;
  const popoverPosition = selection
    ? {
        left: clamp(selection.rect.right + 12, 12, window.innerWidth - 332),
        top: clamp(selection.rect.top, 12, window.innerHeight - 340),
      }
    : activeThreadId
      ? {
          left: clamp(
            (threadPositions.find((position) => position.id === activeThreadId)
              ?.left ?? 12) + 8,
            12,
            window.innerWidth - 332,
          ),
          top: clamp(
            (threadPositions.find((position) => position.id === activeThreadId)?.top ?? 80) - 24,
            12,
            window.innerHeight - 340,
          ),
        }
      : null;

  return (
    <div ref={rootRef} className={`applecms ${styles.layer}`} aria-live="polite">
      {selection && !composing && !activeThreadId && selectionPosition && (
        <button
          type="button"
          className={styles.selectionButton}
          style={selectionPosition}
          onPointerDown={(event) => event.preventDefault()}
          onClick={startComment}
        >
          <CommentIcon />
          Comment
        </button>
      )}
      {threadPositions.map((position) => {
        const thread = threads.find((candidate) => candidate.root.id === position.id);
        if (!thread) return null;
        return (
          <button
            key={position.id}
            type="button"
            className={styles.marker}
            style={{
              left: position.left,
              top: position.top,
            }}
            aria-label={`Open comment by ${thread.root.authorName}`}
            onClick={() => {
              setComposing(false);
              setActiveThreadId(position.id);
              setSelection(null);
            }}
          >
            <CommentIcon />
            {thread.replies.length > 0 && <span>{thread.replies.length + 1}</span>}
          </button>
        );
      })}
      {(composing || activeThread) && popoverPosition && (
        <section
          ref={popoverRef}
          className={styles.popover}
          style={popoverPosition}
          role="dialog"
          aria-label={composing ? "Comment on selection" : "Comment thread"}
        >
          <header>
            <strong>{composing ? "Comment on selection" : "Comment"}</strong>
            <button type="button" aria-label="Close comments" onClick={closePopover}>
              ×
            </button>
          </header>
          {(composing ? selection?.exact : activeThread?.root.anchor?.exactQuote) && (
            <blockquote>
              {composing ? selection?.exact : activeThread?.root.anchor?.exactQuote}
            </blockquote>
          )}
          {activeThread && (
            <div className={styles.thread}>
              {[activeThread.root, ...activeThread.replies].map((comment) => (
                <article key={comment.id}>
                  <strong>{comment.authorName}</strong>
                  <p>{comment.body}</p>
                </article>
              ))}
            </div>
          )}
          {error && <p className={styles.error}>{error}</p>}
          {composing ? (
            <form onSubmit={submitComment}>
              <textarea
                ref={composerRef}
                value={body}
                rows={3}
                placeholder="Add a comment"
                onChange={(event) => setBody(event.currentTarget.value)}
              />
              <button type="submit" disabled={!body.trim() || saving}>
                {saving ? "Posting" : "Post"}
              </button>
            </form>
          ) : (
            <>
              <form onSubmit={submitReply}>
                <textarea
                  value={replyBody}
                  rows={2}
                  placeholder="Reply"
                  onChange={(event) => setReplyBody(event.currentTarget.value)}
                />
                <button type="submit" disabled={!replyBody.trim() || saving}>
                  Reply
                </button>
              </form>
              {canResolve && (
                <button
                  type="button"
                  className={styles.resolveButton}
                  disabled={saving}
                  onClick={() => void toggleResolution()}
                >
                  {activeThread?.root.resolved ? "Reopen" : "Resolve"}
                </button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
