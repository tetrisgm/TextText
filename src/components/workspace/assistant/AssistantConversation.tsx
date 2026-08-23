"use client";

import { useEffect, useRef } from "react";
import type { AssistantMessage } from "./useNativeAssistant";
import type { AssistantJob } from "@/lib/ai/jobs";
import type { NativeQuickActionId } from "@/lib/ai/quick-actions";
import type { CloudAssistantProviderLabel } from "@/lib/ai/cloud-client";
import type { AiConnectionSnapshot } from "@/lib/ai/connection-state";
import { greeting, startersFor, type StarterContext } from "./starters";
import type { AssistantArtifactProof } from "./artifact-proof";
import styles from "./AssistantConversation.module.css";

const FALLBACK_STARTER_CONTEXT: StarterContext = { level: "root" };

function displayedMessageText(message: AssistantMessage): string {
  return message.text;
}

function progressFallback(context: StarterContext): string {
  if (context.level === "item") return `Reading ${context.label}`;
  if (context.level === "folder") return `Reviewing ${context.label}`;
  return "Reviewing your workspace";
}

function workflowHeading(context: StarterContext): string {
  if (context.level === "item") return `Ways to work with ${context.label}`;
  if (context.level === "folder") return `Ways to work with ${context.label}`;
  return "Start with a workspace workflow";
}

/**
 * Provider runtimes may emit operational narration rather than a useful
 * status. The rail has room for one concrete line, not a running monologue.
 */
function boundedProgressText(
  text: string,
  context: StarterContext,
  provider?: CloudAssistantProviderLabel | null,
): string {
  const contextual = progressFallback(context);
  const fallback = provider ? `${contextual} with ${provider}` : contextual;
  const compact = text.replace(/\s+/g, " ").trim();
  if (
    !compact ||
    compact.length > 108 ||
    /\b(using the .* skill|waiting|one last|attempt|tim(?:e|ing) out|unavailable|keep trying|read-only)\b/i.test(
      compact,
    )
  ) {
    return fallback;
  }
  return compact;
}

function boundedFailureText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "The assistant could not finish that request.";
  const firstReason = compact.split(/(?:\n\s*\n|(?<=[.!?])\s+)/, 1)[0];
  if (firstReason.length <= 180) return firstReason;
  return `${firstReason.slice(0, 177).trimEnd()}...`;
}

// The transcript inside the assistant sidebar: user and assistant turns,
// lightweight progress rows while the selected provider drives tools, a jobs
// strip so background work stays visible from anywhere.
/**
 * What the assistant did somewhere else.
 *
 * A remote MCP call has effects on a machine this workspace does not control,
 * and until this existed the only trace was an audit row nobody reads mid
 * conversation: the reply said a frame was created and gave no sign that a
 * request had left the building. One line per call, naming the server, so the
 * person can see it and object to it.
 */
function OutboundTrace({
  outbound,
}: {
  outbound: NonNullable<AssistantMessage["outbound"]>;
}) {
  const { calls, unreachable } = outbound;
  if (calls.length === 0 && unreachable.length === 0) return null;
  return (
    <div className={styles.outbound}>
      {calls.map((call, index) => (
        <span
          className={styles.outboundCall}
          key={`${call.connection}-${call.tool}-${index}`}
        >
          <span className={styles.outboundName}>{call.connection}</span>
          <code>{call.tool}</code>
          {call.status === "failed" && (
            <span className={styles.outboundFailed}>failed</span>
          )}
          {call.status === "input_required" && (
            <span className={styles.outboundAsked}>needs more information</span>
          )}
        </span>
      ))}
      {unreachable.length > 0 && (
        <span className={styles.outboundDown}>
          {unreachable.join(", ")} did not answer, so its tools were unavailable
        </span>
      )}
    </div>
  );
}

function ArtifactRow({ proof }: { proof: AssistantArtifactProof }) {
  return (
    <div className={styles.artifactRow}>
      <span className={styles.artifactCopy}>
        <span className={styles.artifactTitle}>{proof.title}</span>
        <span className={styles.artifactPath}>{proof.folderPath}</span>
      </span>
      {proof.href ? (
        <a className={styles.artifactOpen} href={proof.href}>
          Open
        </a>
      ) : null}
    </div>
  );
}

/** The concrete TextText item receipt for a completed turn. */
function ArtifactProof({
  artifacts,
}: {
  artifacts: readonly AssistantArtifactProof[] | undefined;
}) {
  if (!artifacts || artifacts.length === 0) return null;
  const firstOperation = artifacts[0].operation;
  const sameOperation = artifacts.every(
    (artifact) => artifact.operation === firstOperation,
  );
  if (artifacts.length === 1) {
    return (
      <div className={styles.artifactProof} aria-label="TextText proof">
        <span className={styles.artifactOperation}>{firstOperation}</span>
        <ArtifactRow proof={artifacts[0]} />
      </div>
    );
  }
  return (
    <details className={styles.artifactProof} aria-label="TextText proof">
      <summary className={styles.artifactSummary}>
        {sameOperation
          ? `${firstOperation} ${artifacts.length} items`
          : `${artifacts.length} verified TextText actions`}
      </summary>
      <div className={styles.artifactList}>
        {artifacts.map((artifact, index) => (
          <div
            className={styles.artifactWithOperation}
            key={`${artifact.operation}-${artifact.itemId}-${index}`}
          >
            {!sameOperation ? (
              <span className={styles.artifactOperation}>
                {artifact.operation}
              </span>
            ) : null}
            <ArtifactRow proof={artifact} />
          </div>
        ))}
      </div>
    </details>
  );
}

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
  aiSettingsHref,
  onOpenAiSettings,
  onRetry,
  onSaveAnswer,
  savingAnswerId,
  onRateAnswer,
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
  /** Direct route to the workspace's API-key setup. */
  aiSettingsHref?: string;
  /** Closes the assistant before its settings route replaces the workspace. */
  onOpenAiSettings?: () => void;
  /** Re-runs the last user turn through the same assistant submit path. */
  onRetry?: (prompt: string) => Promise<void> | void;
  /** Captures an answer and its prompt into the private Notes folder. */
  onSaveAnswer?: (messageId: string) => Promise<void> | void;
  savingAnswerId?: string | null;
  onRateAnswer?: (messageId: string, rating: "up" | "down") => Promise<void> | void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const context = starterContext ?? FALLBACK_STARTER_CONTEXT;

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
            title={
              action.description ?? `${action.label} with your AI provider`
            }
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
                  ? ` · ${job.activity ?? "In progress"}`
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
    const connected =
      Boolean(cloudProvider) || nativeConnection?.state === "ready";
    const embeddedConnectionAvailable = Boolean(
      nativeConnection?.embeddedChatSupported && onConnectNative,
    );
    const primaryConnectionLabel = embeddedConnectionAvailable
      ? "Continue with ChatGPT"
      : "Set up the in-app assistant";
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
              {connected
                ? greeting(viewerName, new Date())
                : "Write with your AI"}
            </p>
            <p className={styles.emptyBody}>
              {connected
                ? workflowHeading(context)
                : nativeConnection?.state === "unavailable"
                  ? "Set up the in-app assistant once, then write here beside your documents."
                  : nativeConnection?.state === "runtime-missing"
                    ? "Set up the in-app assistant to keep the conversation inside TextText."
                    : "Connect once. The agent reads and writes the document you have open."}
            </p>
          </div>
          {!connected && (
            <div className={styles.connect} aria-label="Connect an AI">
              {embeddedConnectionAvailable ? (
                <button
                  type="button"
                  className={styles.connectPrimary}
                  onClick={onConnectNative}
                >
                  {primaryConnectionLabel}
                </button>
              ) : (
                <a
                  className={styles.connectPrimary}
                  href={aiSettingsHref ?? "/docs/ai#embedded-agent"}
                  onClick={onOpenAiSettings}
                >
                  {primaryConnectionLabel}
                </a>
              )}
              <a className={styles.connectSecondary} href="/connect">
                Connect your AI app instead
              </a>
              <a className={styles.connectGuide} href="/docs/ai">
                Read the setup guide
              </a>
            </div>
          )}
          {connected && onUsePrompt && (
            <div className={styles.examples} aria-label="Suggested workflows">
              {startersFor(context).map((starter) => (
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

  const visibleMessages = messages.filter(
    (message) => message.role !== "progress",
  );
  const latestProgress = submitting
    ? [...messages].reverse().find((message) => message.role === "progress")
    : undefined;
  return (
    <div
      className={styles.thread}
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {jobsStrip}
      {quickActionBar}
      {visibleMessages.map((message, messageIndex) => {
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
              <ArtifactProof artifacts={message.artifactProofs} />
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
        if (message.role === "error") {
          const precedingUserMessage = visibleMessages
            .slice(0, messageIndex)
            .reverse()
            .find((candidate) => candidate.role === "user");
          return (
            <div key={message.id} role="alert" className={styles.errorTurn}>
              <span>{boundedFailureText(displayedMessageText(message))}</span>
              <div className={styles.errorActions}>
                {precedingUserMessage && onRetry ? (
                  <button
                    type="button"
                    onClick={() => void onRetry(precedingUserMessage.text)}
                  >
                    Try again
                  </button>
                ) : null}
                {aiSettingsHref ? (
                  <a href={aiSettingsHref} onClick={onOpenAiSettings}>
                    Verify connection
                  </a>
                ) : null}
              </div>
            </div>
          );
        }
        return (
          <div
            key={message.id}
            className={
              message.role === "user" ? styles.userTurn : styles.assistantTurn
            }
          >
            {message.provider && (
              <span className={styles.providerLabel}>
                Answered by {message.provider}
              </span>
            )}
            <ArtifactProof artifacts={message.artifactProofs} />
            <span>{displayedMessageText(message)}</span>
            {message.outbound && <OutboundTrace outbound={message.outbound} />}
            {message.role === "assistant" && onSaveAnswer ? (
              message.savedItem ? (
                <span className={styles.savedAnswer}>
                  Saved to Notes · {message.savedItem.title}
                </span>
              ) : (
                <button
                  type="button"
                  className={styles.saveAnswer}
                  disabled={savingAnswerId === message.id}
                  onClick={() => void onSaveAnswer(message.id)}
                >
                  {savingAnswerId === message.id ? "Saving to Notes" : "Save to Notes"}
                </button>
              )
            ) : null}
            {message.role === "assistant" && onRateAnswer ? (
              <span className={styles.answerFeedback} aria-label="Rate answer">
                <button
                  type="button"
                  className={styles.feedbackButton}
                  aria-label="Helpful answer"
                  aria-pressed={message.feedback === "up"}
                  onClick={() => void onRateAnswer(message.id, "up")}
                >
                  👍
                </button>
                <button
                  type="button"
                  className={styles.feedbackButton}
                  aria-label="Unhelpful answer"
                  aria-pressed={message.feedback === "down"}
                  onClick={() => void onRateAnswer(message.id, "down")}
                >
                  👎
                </button>
              </span>
            ) : null}
          </div>
        );
      })}
      {submitting && (
        <div className={styles.progress} role="status">
          {latestProgress
            ? boundedProgressText(
                latestProgress.text,
                context,
                activeCloudProvider,
              )
            : activeCloudProvider
              ? `${progressFallback(context)} with ${activeCloudProvider}`
              : progressFallback(context)}
        </div>
      )}
      <div ref={endRef} aria-hidden="true" />
    </div>
  );
}
