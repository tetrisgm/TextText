"use client";

import { useEffect, useId, useRef, useState } from "react";
import { isOptimisticPostId } from "@/lib/workspace/local-view";
import { usePresence } from "@/lib/collab/usePresence";
import { CollaboratorMark } from "@/components/collab/CollaboratorMark";
import { executeWorkspaceToolRequest } from "@/lib/ai/workspace-tool-client";
import { participantMarks, type ParticipantMark } from "./participants";
import { changeSummary, itemAgentChanges, type ParticipantChange } from "./participant-changes";
import styles from "./ParticipantsRow.module.css";

type Props = { postId?: string | null; handle: string; canReviewChanges?: boolean };

export function ParticipantsRow({ postId, handle, canReviewChanges = false }: Props) {
  const peers = usePresence(postId && !isOptimisticPostId(postId) ? postId : null);
  const marks = participantMarks(peers);
  if (!postId || !marks.length) return null;
  return (
    <div className={styles.row} role="group" aria-label="People and agents on this item">
      {marks.map((mark) => <Participant key={`${postId}:${mark.id}`} mark={mark}
        postId={postId} handle={handle} canReviewChanges={canReviewChanges} />)}
    </div>
  );
}

function Participant({ mark, postId, handle, canReviewChanges }: Props & { mark: ParticipantMark; postId: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<ParticipantChange[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [review, setReview] = useState(false);

  useEffect(() => {
    if (!open || !mark.agent || !canReviewChanges) return;
    let cancelled = false;
    executeWorkspaceToolRequest(handle, "list_agent_changes", { id: postId })
      .then((result) => {
        const changes = itemAgentChanges(result, postId);
        if (!cancelled) setHistory(changes);
      }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [open, mark.agent, canReviewChanges, handle, postId, attempt]);

  useEffect(() => {
    if (!open) return;
    const close = () => popover.current?.hidePopover();
    // A native top-layer popover cannot remain attached to a moved toolbar.
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [open]);

  return <>
    <button ref={trigger} type="button" className={styles.trigger}
      popoverTarget={id} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={id} aria-label={`${mark.name}, ${mark.state}, ${mark.connection}`}
      title={`${mark.name} · ${mark.state}`}>
      <span className={styles.mark} aria-hidden="true">
        {mark.agent ? <CollaboratorMark name={mark.name} provider={mark.provider} /> : mark.initials}
      </span>
    </button>
    <div ref={popover} id={id} popover="auto" role="dialog" aria-labelledby={`${id}-name`}
      className={styles.popover} style={position}
      onBeforeToggle={(event) => {
        if (event.newState !== "open") return;
        const rect = trigger.current?.getBoundingClientRect();
        if (rect) setPosition({ top: Math.min(rect.bottom + 8, window.innerHeight - 80),
          left: Math.max(8, Math.min(rect.right - 304, window.innerWidth - 312)) });
        setHistory(null);
        setFailed(false);
        setReview(false);
      }}
      onToggle={(event) => setOpen(event.newState === "open")}>
      <div className={styles.header}>
        <strong id={`${id}-name`}>{mark.name}</strong>
        <button type="button" autoFocus className={styles.close} aria-label="Close participant details"
          onClick={() => popover.current?.hidePopover()}>×</button>
      </div>
      <p>{mark.role}</p>
      <p className={styles.connection}>{mark.connection}</p>
      <p role="status" aria-live="polite">{mark.state}</p>
      <p className={styles.meta}>{mark.state === "Editing" ? "Editor session open. Typing activity is not reported."
        : mark.state === "Working" ? "Active agent presence. The current task is not reported."
        : mark.state === "Present" ? "Activity is not reported by this session." : "Read-only session open."}</p>
      <div className={styles.history}>
        <strong>Latest change</strong>
        {!mark.agent ? <p>Changes by this person are not reported.</p>
          : !canReviewChanges ? <p>The workspace owner can review recorded agent changes.</p>
          : failed ? <><p role="status">Could not load changes.</p><button type="button" className={styles.action}
            onClick={() => { setFailed(false); setHistory(null); setAttempt((value) => value + 1); }}>Retry</button></>
          : history === null ? <p role="status">Checking recorded changes…</p>
          : history.length === 0 ? <p>No recorded agent changes on this item.</p>
          : <>
            <p>{changeSummary(history[0])} · <time dateTime={history[0].createdAt}>{new Date(history[0].createdAt).toLocaleString()}</time></p>
            <p className={styles.meta}>Item history. This session is not linked to a recorded connection.</p>
            <button type="button" className={styles.action} aria-expanded={review} aria-controls={`${id}-changes`}
              onClick={() => setReview(!review)}>Review changes</button>
            {review && <div id={`${id}-changes`}><ChangeReview changes={history} /></div>}
          </>}
      </div>
    </div>
  </>;
}

export function ChangeReview({ changes }: { changes: ParticipantChange[] }) {
  return <div className={styles.review}>
    <p>Recent agent changes on this item, up to 50 records. Text shown here is the recorded version.</p>
    {changes.map((change) => <details key={change.id}>
      <summary>{changeSummary(change)} · {new Date(change.createdAt).toLocaleString()}</summary>
      <p className={styles.connection}>Connection: {change.connectionId}<br />Run: {change.runId}</p>
      {change.changes.map((field, index) => <section key={`${field.field}:${index}`} aria-label={`${field.field} change`}>
        <strong>{field.field}</strong>
        <p>Before</p><pre>{field.before || "(empty)"}</pre>
        <p>After</p><pre>{field.after || "(empty)"}</pre>
      </section>)}
    </details>)}
  </div>;
}
