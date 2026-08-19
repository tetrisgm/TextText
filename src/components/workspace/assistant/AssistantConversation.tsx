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
 * The ways in, as a macOS grouped inset list: one group, hairline-separated
 * rows, a disclosure chevron, and at most one service open at a time. The
 * open service shows its numbered steps with exactly one labeled action per
 * step that needs one; copy actions resolve in place with a Copied beat and
 * run execCommand synchronously inside the click's activation (the
 * async-first order spends the activation and goes mute).
 */
function ConnectPaths() {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className={styles.connectPaths} aria-label="Ways to connect">
      {AGENT_INTEGRATIONS.map((integration) => (
        <ConnectPathRow
          key={integration.id}
          integration={integration}
          open={openId === integration.id}
          onToggle={() =>
            setOpenId((value) => (value === integration.id ? null : integration.id))
          }
        />
      ))}
    </div>
  );
}

function ConnectPathRow({
  integration,
  open,
  onToggle,
}: {
  integration: (typeof AGENT_INTEGRATIONS)[number];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={styles.connectPath} data-open={open || undefined}>
      <button
        type="button"
        className={styles.connectPathHeader}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className={styles.connectPathMark} aria-hidden="true">
          {integration.monogram}
        </span>
        <span className={styles.connectPathCopy}>
          <span className={styles.connectPathName}>{integration.name}</span>
          <span className={styles.connectPathHint}>{integration.environment}</span>
        </span>
        <span className={styles.connectPathChevron} aria-hidden="true">
          ›
        </span>
      </button>
      {open && (
        <div className={styles.connectPathSteps}>
          <ol>
            {integration.steps.map((step) => (
              <li key={step.text}>
                {step.text}
                {step.copy && <CopyStepButton copy={step.copy} />}
                {!step.copy &&
                  integration.action.kind === "link" &&
                  step.text.includes("button below") && (
                    <a
                      className={styles.connectStepAction}
                      href={integration.action.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {integration.action.label}
                    </a>
                  )}
              </li>
            ))}
          </ol>
          <p className={styles.connectPathOutcome}>{integration.outcome}</p>
        </div>
      )}
    </div>
  );
}

function CopyStepButton({ copy }: { copy: { label: string; value: string } }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.connectStepAction}
      onClick={() => {
        const legacyCopy = () => {
          const scratch = document.createElement("textarea");
          scratch.value = copy.value;
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
        if (legacyCopy()) done();
        else if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(copy.value).then(done).catch(() => {});
        }
      }}
    >
      {copied ? "Copied" : copy.label}
    </button>
  );
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
  onBuildItemType,
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
  onBuildItemType?: () => void;
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
              {/* One service per row; opening a row shows the numbered steps
                  and a labeled action, so nothing is a mystery glyph and
                  nobody lands somewhere with nothing to do. The compressed
                  row-with-a-copy-icon version failed exactly that way. */}
              <ConnectPaths />
              <p className={styles.connectAlt}>
                Prefer a key? <a href="/docs/ai#api-key">Add an Anthropic or OpenAI API key</a>
              </p>
            </div>
          )}
          {onBuildItemType ? (
            <button
              type="button"
              className={styles.buildType}
              onClick={onBuildItemType}
            >
              <span aria-hidden="true">✦</span>
              Build a new item type
            </button>
          ) : null}
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
            {message.outbound && <OutboundTrace outbound={message.outbound} />}
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
