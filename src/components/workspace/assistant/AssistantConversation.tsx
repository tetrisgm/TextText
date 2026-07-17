"use client";

import { useEffect, useRef } from "react";
import type { AssistantMessage } from "./useNativeAssistant";
import type { AssistantJob } from "@/lib/ai/jobs";
import type { NativeAICapabilities } from "@/lib/ai/native";
import type { NativeQuickActionId } from "@/lib/ai/quick-actions";
import styles from "./AssistantConversation.module.css";

const PROMPT_STARTERS = [
  { label: "Improve title", prompt: "Give this page a better title" },
  { label: "Summarize page", prompt: "Summarize this page" },
  { label: "Draft follow-ups", prompt: "Draft three related posts" },
] as const;

// The transcript inside the assistant sidebar: user and assistant turns,
// lightweight progress rows while the on-device model drives tools, a jobs
// strip so background work stays visible from anywhere.
export function AssistantConversation({
  capabilities,
  jobs,
  messages,
  quickActions,
  submitting,
  onApplyProposal,
  onOpenJob,
  onUsePrompt,
  onQuickAction,
  onUndoProposal,
}: {
  capabilities: NativeAICapabilities | null;
  jobs?: AssistantJob[];
  messages: AssistantMessage[];
  quickActions?: ReadonlyArray<{
    id: NativeQuickActionId;
    label: string;
    description?: string;
  }>;
  submitting: boolean;
  onApplyProposal?: (messageId: string) => Promise<void> | void;
  onOpenJob?: (job: AssistantJob) => void;
  onUsePrompt?: (prompt: string) => void;
  onQuickAction?: (action: NativeQuickActionId) => Promise<void> | void;
  onUndoProposal?: (messageId: string) => Promise<void> | void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, submitting]);

  const visibleJobs = (jobs ?? []).slice(0, 6);
  const quickActionBar =
    quickActions && quickActions.length > 0 ? (
      <div className={styles.quickActions} aria-label="On-device actions">
        {quickActions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={styles.quickAction}
            disabled={submitting}
            title={action.description ?? `${action.label} on this Mac`}
            onClick={() => void onQuickAction?.(action.id)}
          >
            {action.label}
          </button>
        ))}
      </div>
    ) : null;
  const jobsStrip =
    visibleJobs.length > 0 ? (
      <div className={styles.jobs} aria-label="Assistant jobs">
        {visibleJobs.map((job) => (
          <button
            key={job.id}
            type="button"
            className={styles.jobRow}
            data-status={job.status}
            title={`${job.label} (${job.contextLabel})`}
            onClick={() => onOpenJob?.(job)}
          >
            <span className={styles.jobDot} aria-hidden="true" />
            <span className={styles.jobCopy}>
              <span className={styles.jobLabel}>{job.label}</span>
              <span className={styles.jobMeta}>
                {job.contextLabel}
                {job.status === "running"
                  ? ` · ${job.activity ?? "Working"}`
                  : job.status === "error"
                    ? " · Failed"
                    : " · Done"}
              </span>
            </span>
          </button>
        ))}
      </div>
    ) : null;

  if (messages.length === 0) {
    return (
      <div className={styles.empty}>
        {jobsStrip}
        {quickActionBar}
        <p className={styles.emptyTitle}>
          {capabilities?.available
            ? "Private on this Mac"
            : "Ask about your workspace"}
        </p>
        <p className={styles.emptyBody}>
          {capabilities?.available
            ? "Answers and edits run on Apple's on-device model. Nothing leaves this Mac, and it works offline."
            : "Open the Mac app to use Apple's private, offline model."}
        </p>
        {onUsePrompt && (
          <div className={styles.examples} aria-label="Prompt starters">
            {PROMPT_STARTERS.map((starter) => (
              <button
                key={starter.label}
                type="button"
                disabled={submitting}
                onClick={(event) => {
                  const sidebar = event.currentTarget.closest<HTMLElement>(
                    "[data-assistant-sidebar]",
                  );
                  onUsePrompt(starter.prompt);
                  window.requestAnimationFrame(() => {
                    sidebar
                      ?.querySelector<HTMLTextAreaElement>("textarea")
                      ?.focus({ preventScroll: true });
                  });
                }}
              >
                <span>{starter.label}</span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={styles.thread}
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {jobsStrip}
      {quickActionBar}
      {messages.map((message) => {
        if (message.role === "progress") {
          return (
            <div key={message.id} className={styles.progress} role="status">
              {message.text}
            </div>
          );
        }
        if (message.proposal) {
          const proposal = message.proposal;
          const changing =
            proposal.status === "applying" || proposal.status === "undoing";
          const applied =
            proposal.status === "applied" || proposal.status === "undoing";
          const scopeLabel =
            proposal.scope === "selection"
              ? `${proposal.field} selection${
                  proposal.range
                    ? `, source offsets ${proposal.range.start} to ${proposal.range.end}`
                    : ""
                }`
              : proposal.field;
          return (
            <div key={message.id} className={styles.proposal}>
              <p className={styles.proposalLabel}>{proposal.label}</p>
              <p className={styles.proposalScope}>{scopeLabel}</p>
              <div
                className={styles.proposalPreview}
                aria-label={`${proposal.label} preview`}
              >
                <div className={styles.proposalValue} data-kind="before">
                  <span className={styles.proposalValueLabel}>Original</span>
                  <pre>{proposal.before || "Empty"}</pre>
                </div>
                <div className={styles.proposalValue} data-kind="after">
                  <span className={styles.proposalValueLabel}>Replacement</span>
                  <pre>{proposal.after || "Empty"}</pre>
                </div>
              </div>
              {proposal.note && (
                <p className={styles.proposalNote}>{proposal.note}</p>
              )}
              <div className={styles.proposalActions}>
                {applied ? (
                  <button
                    type="button"
                    className={styles.proposalSecondary}
                    disabled={changing}
                    title="Undo this assistant edit"
                    onClick={() => void onUndoProposal?.(message.id)}
                  >
                    {proposal.status === "undoing" ? "Undoing" : "Undo"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.proposalPrimary}
                    disabled={!proposal.canApply || changing}
                    title={
                      proposal.canApply
                        ? "Apply this preview"
                        : "This preview cannot be applied"
                    }
                    onClick={() => void onApplyProposal?.(message.id)}
                  >
                    {proposal.status === "undone"
                      ? "Apply again"
                      : changing
                        ? "Applying"
                        : "Apply"}
                  </button>
                )}
                {proposal.status === "undone" && (
                  <span className={styles.proposalStatus}>Undone</span>
                )}
                {proposal.status === "applied" && !proposal.syncPending && (
                  <span className={styles.proposalStatus}>Applied</span>
                )}
                {proposal.syncPending && (
                  <span className={styles.proposalStatus}>Sync pending</span>
                )}
              </div>
            </div>
          );
        }
        return (
          <div
            key={message.id}
            role={message.role === "error" ? "alert" : undefined}
            className={
              message.role === "user"
                ? styles.userTurn
                : message.role === "error"
                  ? styles.errorTurn
                  : styles.assistantTurn
            }
          >
            {message.text}
          </div>
        );
      })}
      {submitting && (
        <div className={styles.progress} role="status">
          Thinking on this Mac
        </div>
      )}
      <div ref={endRef} aria-hidden="true" />
    </div>
  );
}
