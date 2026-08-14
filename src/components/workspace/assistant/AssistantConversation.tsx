"use client";

import { useEffect, useRef, useState } from "react";
import type { AssistantMessage } from "./useNativeAssistant";
import type { AssistantJob } from "@/lib/ai/jobs";
import type { NativeQuickActionId } from "@/lib/ai/quick-actions";
import type { CloudAssistantProviderLabel } from "@/lib/ai/cloud-client";
import type { AiConnectionSnapshot } from "@/lib/ai/connection-state";
import { greeting, startersFor, type StarterContext } from "./starters";
import { AGENT_INTEGRATIONS } from "@/lib/agent-integrations";
import styles from "./AssistantConversation.module.css";

const FALLBACK_STARTER_CONTEXT: StarterContext = { level: "root" };

function displayedMessageText(message: AssistantMessage): string {
  return message.text;
}

/**
 * One way in, one action. Copy rows resolve in place with a "Copied" beat so
 * nobody wonders whether anything happened; link rows just go.
 */
function ConnectPathRow({
  integration,
}: {
  integration: (typeof AGENT_INTEGRATIONS)[number];
}) {
  const [copied, setCopied] = useState(false);
  const { action } = integration;
  const hint =
    action.kind === "copy"
      ? copied
        ? action.copiedLabel
        : action.label
      : action.label;

  if (action.kind === "link") {
    return (
      <a
        className={styles.connectPath}
        href={action.href}
        target={action.href.startsWith("http") ? "_blank" : undefined}
        rel="noreferrer"
      >
        <span className={styles.connectPathMark} aria-hidden="true">
          {integration.monogram}
        </span>
        <span className={styles.connectPathCopy}>
          <span className={styles.connectPathName}>{integration.name}</span>
          <span className={styles.connectPathHint}>{hint}</span>
        </span>
        <span className={styles.connectPathAction} aria-hidden="true">→</span>
      </a>
    );
  }

  return (
    <button
      type="button"
      className={styles.connectPath}
      data-copied={copied || undefined}
      onClick={() => {
        // The async clipboard API can reject in embedded webviews and stricter
        // permission contexts; a copy row that silently does nothing is worse
        // than no row, so the selection-and-execCommand fallback stays.
        const legacyCopy = () => {
          const scratch = document.createElement("textarea");
          scratch.value = action.value;
          scratch.setAttribute("readonly", "");
          scratch.style.position = "fixed";
          scratch.style.opacity = "0";
          document.body.appendChild(scratch);
          scratch.select();
          const ok = document.execCommand("copy");
          scratch.remove();
          return ok;
        };
        const done = () => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2400);
        };
        // Synchronous first: execCommand runs inside the click's transient
        // activation. Waiting for the async API to reject spends that
        // activation, after which every path fails and the row goes mute.
        if (legacyCopy()) {
          done();
        } else if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(action.value).then(done).catch(() => {});
        }
      }}
    >
      <span className={styles.connectPathMark} aria-hidden="true">
        {integration.monogram}
      </span>
      <span className={styles.connectPathCopy}>
        <span className={styles.connectPathName}>{integration.name}</span>
        <span className={styles.connectPathHint}>{hint}</span>
      </span>
      <span className={styles.connectPathAction} aria-hidden="true">
        {copied ? "✓" : "⧉"}
      </span>
    </button>
  );
}

// The transcript inside the assistant sidebar: user and assistant turns,
// lightweight progress rows while the selected provider drives tools, a jobs
// strip so background work stays visible from anywhere.
export function AssistantConversation({
  activeCloudProvider,
  cloudProvider,
  jobs,
  messages,
  starterContext,
  viewerName,
  quickActions,
  submitting,
  onApplyProposal,
  onOpenJob,
  onUsePrompt,
  onQuickAction,
  onUndoProposal,
  nativeConnection,
  onConnectNative,
}: {
  activeCloudProvider?: CloudAssistantProviderLabel | null;
  cloudProvider?: CloudAssistantProviderLabel | null;
  jobs?: AssistantJob[];
  messages: AssistantMessage[];
  /** Where the person is, so the starters can name it. */
  starterContext?: StarterContext;
  viewerName?: string | null;
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
  nativeConnection?: AiConnectionSnapshot | null;
  onConnectNative?: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, submitting]);

  const visibleJobs = (jobs ?? []).slice(0, 6);
  const quickActionBar =
    quickActions && quickActions.length > 0 ? (
      <div className={styles.quickActions} aria-label="Assistant actions">
        {quickActions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={styles.quickAction}
            disabled={submitting}
            title={action.description ?? `${action.label} with your AI provider`}
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
    const connected = Boolean(cloudProvider) || nativeConnection?.state === "ready";
    return (
      <div className={styles.empty}>
        {jobsStrip}
        {quickActionBar}
        {/* One idea per state, vertically centered like a place rather than
            stacked like a form. Connected: a greeting and starters that name
            the current item. Not connected: one sentence and one action,
            because connecting is the only thing worth saying until it is
            done. The alternatives survive as a single quiet line. */}
        <div className={styles.emptyCenter}>
          <div className={styles.emptyLede}>
            <p className={styles.emptyTitle}>
              {connected ? greeting(viewerName, new Date()) : "Write with your AI"}
            </p>
            <p className={styles.emptyBody}>
              {connected
                ? "Ask about what you are looking at, or start with one of these."
                : nativeConnection?.state === "runtime-missing"
                  ? "The built-in agent needs the Mac app. Connect another AI app or add an API key to work here."
                  : "Connect the AI you already use once, and it works right here, beside your documents."}
            </p>
          </div>
          {!connected && (
            <div className={styles.connect} aria-label="Connect an AI">
              {nativeConnection?.embeddedChatSupported && onConnectNative && (
                <button
                  type="button"
                  className={styles.connectPrimary}
                  onClick={onConnectNative}
                >
                  Continue with ChatGPT
                </button>
              )}
              {/* Every path, each one actionable in place: the copy rows put
                  the install command or the MCP address on the clipboard, the
                  link rows open the one page that finishes the job. pen.dev
                  and paper.design set the bar here; a single "connect an AI"
                  button under it told people nothing about their options. */}
              <div className={styles.connectPaths} aria-label="Ways to connect">
                {AGENT_INTEGRATIONS.map((integration) => (
                  <ConnectPathRow key={integration.id} integration={integration} />
                ))}
              </div>
              <p className={styles.connectAlt}>
                Prefer a key? <a href="/docs/ai#api-key">Add an Anthropic or OpenAI API key</a>
                <span aria-hidden="true"> · </span>
                <a href="/connect">Full setup guide</a>
              </p>
            </div>
          )}
          {connected && onUsePrompt && (
            <div className={styles.examples} aria-label="Prompt starters">
              {startersFor(starterContext ?? FALLBACK_STARTER_CONTEXT).map((starter) => (
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
                  {starter.label}
                </button>
              ))}
            </div>
          )}
        </div>
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
              {displayedMessageText(message)}
            </div>
          );
        }
        if (message.proposal) {
          const proposal = message.proposal;
          const changing =
            proposal.status === "applying" || proposal.status === "undoing";
          const applied =
            proposal.status === "applied" || proposal.status === "undoing";
          const tagProposal = proposal.kind === "tags";
          const scopeLabel = tagProposal
            ? "Item tags"
            : proposal.scope === "selection"
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
              {tagProposal ? (
                <div
                  className={styles.proposalTags}
                  aria-label={`${proposal.label} preview`}
                >
                  {proposal.afterTags.length > 0 ? (
                    proposal.afterTags.map((tag) => (
                      <span
                        key={tag}
                        data-added={
                          proposal.addedTags.includes(tag) || undefined
                        }
                      >
                        #{tag}
                      </span>
                    ))
                  ) : (
                    <span>None</span>
                  )}
                </div>
              ) : (
                <div
                  className={styles.proposalPreview}
                  aria-label={`${proposal.label} preview`}
                >
                  <div className={styles.proposalValue} data-kind="before">
                    <span className={styles.proposalValueLabel}>Original</span>
                    <pre>{proposal.before || "Empty"}</pre>
                  </div>
                  <div className={styles.proposalValue} data-kind="after">
                    <span className={styles.proposalValueLabel}>
                      Replacement
                    </span>
                    <pre>{proposal.after || "Empty"}</pre>
                  </div>
                </div>
              )}
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
            {message.provider && (
              <span className={styles.providerLabel}>
                Answered by {message.provider}
              </span>
            )}
            <span>{displayedMessageText(message)}</span>
          </div>
        );
      })}
      {submitting && (
        <div className={styles.progress} role="status">
          {activeCloudProvider
            ? `Thinking with ${activeCloudProvider}`
            : "Contacting your AI provider"}
        </div>
      )}
      <div ref={endRef} aria-hidden="true" />
    </div>
  );
}
