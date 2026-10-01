"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { VaultError, vaultRequest } from "./bridge";
import { groupVaultCommentThreads, parseVaultCommentsPage, watchVaultComments, type VaultComment } from "./vault-comments";
import styles from "./VaultComments.module.css";

type MutationResult = { status: "written" | "unchanged" | "conflict"; itemId: string; commentId: string };
type Props = { itemId: string; path: string; canComment: boolean; canResolve: boolean; onClose: () => void };
const PAGE_SIZE = 100;
const MAX_COMMENTS = 500;

export async function readAllComments(itemId: string, signal?: AbortSignal): Promise<VaultComment[]> {
  const comments: VaultComment[] = [];
  const seenCursors = new Set<string>();
  const seenComments = new Set<string>();
  let after: string | null = null;
  let revision: string | null = null;
  for (let pageNumber = 0; pageNumber <= MAX_COMMENTS / PAGE_SIZE; pageNumber++) {
    const page = parseVaultCommentsPage(await vaultRequest("commentsRead", {
      itemId, limit: PAGE_SIZE, ...(after ? { after } : {}),
    }, signal));
    if (revision && page.revision !== revision) throw new Error("Comments changed while loading. Refresh to see the latest threads.");
    revision = page.revision;
    if (page.comments.some(comment => seenComments.has(comment.id))) throw new Error("The comments pages could not be completed.");
    page.comments.forEach(comment => seenComments.add(comment.id));
    comments.push(...page.comments);
    if (comments.length > MAX_COMMENTS) throw new Error("This file has more comments than the panel can show.");
    if (!page.nextCursor) return comments;
    if (!page.comments.length || seenCursors.has(page.nextCursor)) throw new Error("The comments pages could not be completed.");
    seenCursors.add(page.nextCursor);
    after = page.nextCursor;
  }
  throw new Error("This file has more comments than the panel can show.");
}

function commentTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function submitOnModifiedEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.nativeEvent.isComposing || event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function CommentBody({ comment }: { comment: VaultComment }) {
  return <div className={styles.comment}>
    <div className={styles.meta}><strong>{comment.authorName}</strong>
      {comment.authorActorType === "external_agent" && <span>Agent</span>}
      <time dateTime={comment.createdAt}>{commentTime(comment.createdAt)}</time></div>
    <p>{comment.body}</p>
  </div>;
}

export function VaultComments({ itemId, path, canComment, canResolve, onClose }: Props) {
  const headingId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const busyRef = useRef(false);
  const loadingRef = useRef(true);
  const [comments, setComments] = useState<VaultComment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"open" | "resolved">("open");
  const [draft, setDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const threads = useMemo(() => groupVaultCommentThreads(comments ?? []), [comments]);
  const openThreads = threads.filter(thread => !thread.root.resolvedAt);
  const resolvedThreads = threads.filter(thread => !!thread.root.resolvedAt);
  const visibleThreads = mode === "open" ? openThreads : resolvedThreads;

  const refresh = useCallback(async (signal?: AbortSignal, silent = false) => {
    const version = ++requestVersion.current;
    if (!silent) { loadingRef.current = true; setLoading(true); }
    try {
      const next = await readAllComments(itemId, signal);
      if (!signal?.aborted && version === requestVersion.current) { setComments(next); setError(""); }
    } catch (reason) {
      if (!signal?.aborted && version === requestVersion.current && !(reason instanceof DOMException && reason.name === "AbortError")) {
        if (silent && reason instanceof VaultError && ["401", "403", "404"].includes(reason.code ?? "")) {
          setComments(null); setError("Comment access is no longer available.");
        } else if (!silent) {
          setError(reason instanceof Error ? reason.message : "Comments could not be loaded.");
        }
      }
    } finally {
      if (!silent) loadingRef.current = false;
      if (!signal?.aborted && !silent && version === requestVersion.current) setLoading(false);
    }
  }, [itemId]);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void Promise.resolve().then(() => refresh(controller.signal));
    const stop = watchVaultComments(window, document, () => busyRef.current || loadingRef.current,
      () => refresh(controller.signal, true));
    return () => { stop(); controller.abort(); if (lifetime.current === controller) lifetime.current = null; };
  }, [refresh]);
  useEffect(() => { closeButton.current?.focus(); }, []);
  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const mutate = async (method: "commentsAdd" | "commentsResolve", key: string, params: Record<string, unknown>): Promise<boolean> => {
    if (busyRef.current) return false;
    const operationId = operation.current?.key === key ? operation.current.id : crypto.randomUUID();
    operation.current = { key, id: operationId };
    busyRef.current = true;
    setBusy(true); setError("");
    try {
      const result = await vaultRequest<MutationResult>(method, { itemId, operationId, ...params });
      if (result.itemId !== itemId || !["written", "unchanged", "conflict"].includes(result.status)) {
        throw new Error("The comment save was not confirmed.");
      }
      if (result.status === "conflict") {
        await refresh(lifetime.current?.signal);
        setError("Comments changed while you were working. Review the latest threads and try again.");
        return false;
      }
      operation.current = null;
      await refresh(lifetime.current?.signal);
      return true;
    } catch (reason) {
      if (reason instanceof VaultError && (reason.code === "409" || reason.code === "conflict")) {
        await refresh(lifetime.current?.signal);
        setError("Comments changed while you were working. Review the latest threads and try again.");
        return false;
      }
      setError(reason instanceof Error ? reason.message : "The comment could not be saved. Try again.");
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  };
  const add = async (body: string, parentId?: string) => {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > 4000) { setError("Write a comment of up to 4,000 characters."); return; }
    const key = JSON.stringify(["add", parentId ?? null, trimmed]);
    const saved = await mutate("commentsAdd", key, { body: trimmed, ...(parentId ? { parentId } : {}) });
    if (saved) {
      if (parentId) {
        setReplyDrafts(previous => ({ ...previous, [parentId]: "" }));
        setReplyingTo(null);
      } else setDraft("");
    }
  };
  const resolve = (commentId: string, resolved: boolean) => {
    void mutate("commentsResolve", JSON.stringify(["resolve", commentId, resolved]), { commentId, resolved });
  };

  return <aside className={styles.panel} aria-labelledby={headingId}>
    <header className={styles.header}>
      <div><h2 id={headingId}>Comments</h2><p title={path}>{path}</p></div>
      <button ref={closeButton} type="button" onClick={onClose} aria-label="Close comments">Close</button>
    </header>
    <div className={styles.tabs} role="group" aria-label="Comment threads">
      <button type="button" aria-pressed={mode === "open"} onClick={() => setMode("open")}>Open <span>{openThreads.length}</span></button>
      <button type="button" aria-pressed={mode === "resolved"} onClick={() => setMode("resolved")}>Resolved <span>{resolvedThreads.length}</span></button>
    </div>
    {error && <p className={styles.error} role="alert">{error} <button type="button" disabled={busy} onClick={() => void refresh(lifetime.current?.signal)}>Refresh</button></p>}
    <div className={styles.list} aria-busy={loading}>
      {loading && comments === null ? <p className={styles.empty} role="status">Loading comments…</p> :
        comments === null ? <p className={styles.empty}>Comments are unavailable. Refresh to try again.</p> :
        visibleThreads.length === 0 ? <p className={styles.empty}>{mode === "open" ? "No open comments on this file." : "No resolved comments on this file."}</p> :
        visibleThreads.map(thread => <section className={styles.thread} key={thread.root.id} aria-label={`Thread by ${thread.root.authorName}`}>
          <CommentBody comment={thread.root} />
          {thread.replies.map(reply => <div className={styles.reply} key={reply.id}><CommentBody comment={reply} /></div>)}
          <div className={styles.actions}>
            {canComment && !thread.root.resolvedAt && <button type="button" disabled={busy} onClick={() => setReplyingTo(thread.root.id)}>Reply</button>}
            {canResolve && <button type="button" disabled={busy} onClick={() => resolve(thread.root.id, !thread.root.resolvedAt)}>{thread.root.resolvedAt ? "Reopen" : "Resolve"}</button>}
          </div>
          {canComment && replyingTo === thread.root.id && !thread.root.resolvedAt && <form className={styles.replyForm} onSubmit={event => { event.preventDefault(); void add(replyDrafts[thread.root.id] ?? "", thread.root.id); }}>
            <label>Reply<textarea value={replyDrafts[thread.root.id] ?? ""} maxLength={4000} disabled={busy} rows={3} onKeyDown={submitOnModifiedEnter}
              onChange={event => setReplyDrafts(previous => ({ ...previous, [thread.root.id]: event.target.value }))} /></label>
            <div><button type="submit" disabled={busy || !(replyDrafts[thread.root.id] ?? "").trim()}>Post reply</button>
              <button type="button" disabled={busy} onClick={() => setReplyingTo(null)}>Cancel</button></div>
          </form>}
        </section>)}
    </div>
    {canComment && comments !== null && <form className={styles.composer} onSubmit={event => { event.preventDefault(); void add(draft); }}>
      <label>Add a comment<textarea value={draft} maxLength={4000} disabled={busy} rows={3} onKeyDown={submitOnModifiedEnter}
        onChange={event => setDraft(event.target.value)} /></label>
      <button type="submit" disabled={busy || !draft.trim()}>{busy ? "Saving…" : "Post comment"}</button>
    </form>}
  </aside>;
}
