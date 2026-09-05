"use client";

import { QuickActionControl } from "./QuickActionControl";

import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { CollaboratorMark } from "@/components/collab/CollaboratorMark";
import { NATIVE_QUICK_ACTIONS, type NativeQuickActionId } from "@/lib/ai/quick-actions";
import { loadAssistantBoundary } from "./assistant-boundary";
import { persistedAssistantMessagesFor } from "./replica-peek";
import type {
  AssistantComposerSubmission,
  AssistantSidebarProps,
} from "./AssistantSidebar";
import type { AssistantContext } from "./context";
import {
  ASSISTANT_SIDEBAR_MAX_WIDTH,
  ASSISTANT_SIDEBAR_MIN_WIDTH,
} from "./constants";
import { assistantComposerPlaceholder } from "./sidebar-copy";
import { resolveAssistantSidebarDimensions } from "./sidebar-dimensions";
import {
  greeting,
  starterContextFromChip,
  startersFor,
  workflowHeading,
} from "./starters";
import idleStyles from "./AssistantRailIdle.module.css";
import historyStyles from "./AssistantConversationHistory.module.css";
import styles from "./AssistantSidebar.module.css";

export type AssistantRailShellProps = AssistantSidebarProps & {
  /** The conversation context key, so the shell can peek at the replica. */
  contextKey?: string;
  shellOnQuickAction?: (action: NativeQuickActionId, language?: string) => unknown;
  shellOnSubmit?: (submission: AssistantComposerSubmission) => unknown;
  shellViewerName?: string | null;
};

const CLAUDE_SHELL_AGENT = {
  color: "#0071e3",
  name: "Claude",
  provider: "claude",
} as const;

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function focusLoadedComposer() {
  window.requestAnimationFrame(() => {
    const composer = document.querySelector<HTMLTextAreaElement>(
      '[data-assistant-sidebar]:not([data-state="hidden"]) textarea',
    );
    if (!composer) return;
    composer.focus({ preventScroll: true });
    composer.setSelectionRange(composer.value.length, composer.value.length);
  });
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="m5 5 8 8m0-8-8 8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.65"
      />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M4 5.25h9.5M4 9.75h9.5M4 14.25h6.25" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M8.5 2H4a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.3 2.2a1.1 1.1 0 0 1 1.6 1.6l-4 4-2.1.5.5-2.1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M9 4.25v9.5M4.25 9h9.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M9 13.5v-9m-3.5 3.4L9 4.4l3.5 3.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function ContextIcon({ kind }: { kind: AssistantContext["kind"] }) {
  if (kind === "folder") {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.25 4.25h4l1.15 1.4h6.35v7.1H2.25v-8.5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.3" />
        <path d="M2.5 6h11" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
      </svg>
    );
  }
  if (kind === "workspace") {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M6 2.75v10.5M6.5 6h6.75" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.75 2.25h5.4l3.1 3.1v8.4h-8.5V2.25Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.3" />
      <path d="M9 2.5v3h3M5.75 8.25h4.5M5.75 10.5h3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.3" />
    </svg>
  );
}

export function AssistantRailShell({
  agent: agentProp,
  attachments = [],
  className,
  composerLabel = "Message assistant",
  composerValue,
  context,
  disabled = false,
  layout = "auto",
  maxComposerLength,
  maxWidth = ASSISTANT_SIDEBAR_MAX_WIDTH,
  minWidth = ASSISTANT_SIDEBAR_MIN_WIDTH,
  onComposerChange,
  onNewConversation,
  onStateChange,
  shellOnQuickAction,
  shellOnSubmit,
  shellViewerName,
  state,
  style,
  submitOnEnter = true,
  submitting = false,
  title = "Assistant",
  width,
  contextKey,
  ...props
}: AssistantRailShellProps) {
  const generatedPanelId = useId();
  const titleId = useId();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(composerValue);
  const panelId = props.panelId ?? `assistant-sidebar-${generatedPanelId}`;
  const agent = agentProp ?? CLAUDE_SHELL_AGENT;
  const starterContext = starterContextFromChip(context ?? {});
  const starters = startersFor(starterContext);
  const quickActions = context?.kind === "item" ? NATIVE_QUICK_ACTIONS : [];
  const canSubmit =
    !disabled &&
    !submitting &&
    (composerValue.trim().length > 0 || attachments.length > 0);
  const { resolvedMaxWidth, resolvedMinWidth, resolvedWidth } =
    resolveAssistantSidebarDimensions({ maxWidth, minWidth, width });
  const rootStyle = {
    ...style,
    "--assistant-sidebar-width": `${resolvedWidth}px`,
    "--assistant-sidebar-min-width": `${resolvedMinWidth}px`,
    "--assistant-sidebar-max-width": `${resolvedMaxWidth}px`,
  } as CSSProperties;

  const activate = (restoreComposerFocus = false) => {
    const loading = loadAssistantBoundary();
    if (restoreComposerFocus) void loading.then(focusLoadedComposer);
    return loading;
  };

  // A returning owner with messages waiting should not sit on the greeting:
  // load the controller now; the shell still paints first, which is better
  // than the blank rail the lazy sidebar used to leave until it loaded.
  useEffect(() => {
    if (!props.workspaceHandle || !contextKey) return;
    if (persistedAssistantMessagesFor(props.workspaceHandle, contextKey)) {
      void loadAssistantBoundary();
    }
  }, [props.workspaceHandle, contextKey]);

  useEffect(() => {
    draftRef.current = composerValue;
  }, [composerValue]);

  useEffect(() => {
    const composer = composerRef.current;
    return () => {
      if (document.activeElement === composer) focusLoadedComposer();
    };
  }, []);

  useEffect(() => {
    const onToggleShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        !event.shiftKey ||
        (!event.metaKey && !event.ctrlKey) ||
        event.key.toLowerCase() !== "a" ||
        document.querySelector('[aria-modal="true"]')
      ) {
        return;
      }
      event.preventDefault();
      onStateChange("hidden");
    };
    window.addEventListener("keydown", onToggleShortcut, true);
    return () => window.removeEventListener("keydown", onToggleShortcut, true);
  }, [onStateChange]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    const submission = { text: draftRef.current, attachments };
    if (shellOnSubmit) {
      void shellOnSubmit(submission);
      return;
    }
    void activate().then(() => props.onSubmit(submission));
  };

  const handleComposerKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (
      !submitOnEnter ||
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      !canSubmit
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <div
      className={classNames("applecms", styles.root, className)}
      data-assistant-sidebar=""
      data-layout={layout}
      data-state={state}
      style={rootStyle}
    >
      <aside
        id={panelId}
        className={styles.panel}
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onStateChange("hidden");
        }}
      >
        <div
          className={styles.resizer}
          role="separator"
          tabIndex={0}
          aria-label="Resize assistant sidebar"
          aria-orientation="vertical"
          aria-valuemax={resolvedMaxWidth}
          aria-valuemin={resolvedMinWidth}
          aria-valuenow={resolvedWidth}
          aria-valuetext={`${resolvedWidth} pixels wide`}
          title="Resize assistant sidebar"
          onFocus={() => void activate()}
          onPointerDown={() => void activate()}
        />

        <header className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.agentAvatar} style={{ backgroundColor: agent.color }}>
              <CollaboratorMark provider={agent.provider} name={agent.name} />
            </span>
            <div className={styles.titleAndSync}>
              <h2 id={titleId} className={styles.title}>
                {`Chat with ${agent.name}`}
              </h2>
              {/* Same structure as the loaded rail, including the reserved
                  status line, so the two paint identically. */}
              <div className={styles.historySync} />
            </div>
            <div className={styles.headerActions}>
              <select
                className={styles.modelSelect}
                aria-label="Assistant model"
                title="Assistant model"
                value="auto"
                onChange={() => void activate()}
                onFocus={() => void activate()}
                onPointerDown={() => void activate()}
              >
                <option value="auto">Auto</option>
              </select>
              <div className={historyStyles.root}>
                <button
                  className={historyStyles.trigger}
                  type="button"
                  aria-label="Conversation history"
                  title="Conversation history"
                  onClick={() => void activate()}
                >
                  <HistoryIcon />
                </button>
              </div>
              {props.hasConversation ? (
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label="New chat"
                  title="New chat"
                  onClick={() => {
                    onNewConversation?.();
                    void activate();
                  }}
                >
                  <NewChatIcon />
                </button>
              ) : null}
              <button
                className={styles.iconButton}
                type="button"
                aria-label="Hide assistant"
                aria-keyshortcuts="Meta+Shift+A Control+Shift+A"
                title="Hide assistant"
                onClick={() => onStateChange("hidden")}
              >
                <CloseIcon />
              </button>
            </div>
          </div>
        </header>

        <div
          className={styles.content}
          role="region"
          aria-label={props.contentLabel ?? `${title} conversation`}
        >
          <div className={idleStyles.empty}>
            {quickActions.length > 0 ? (
              <div className={idleStyles.quickActions} aria-label="Assistant actions">
                {quickActions.map((action) => (
                  <QuickActionControl key={action.id} action={action}
                    className={idleStyles.quickAction}
                    onRun={(id, language) => {
                      if (shellOnQuickAction) void shellOnQuickAction(id, language);
                      else void activate();
                    }} />
                ))}
              </div>
            ) : null}
            <div className={idleStyles.emptyCenter}>
              <div className={idleStyles.emptyLede}>
                <p className={idleStyles.emptyTitle}>
                  {greeting(shellViewerName, new Date())}
                </p>
                <p className={idleStyles.emptyBody}>
                  {workflowHeading(starterContext)}
                </p>
              </div>
              <div className={idleStyles.examples} aria-label="Suggested workflows">
                {starters.map((starter) => (
                  <button
                    key={starter.label}
                    type="button"
                    onClick={() => {
                      draftRef.current = starter.prompt;
                      onComposerChange(starter.prompt);
                      void activate(true);
                    }}
                  >
                    {starter.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <form
          className={styles.composer}
          aria-busy={submitting || undefined}
          aria-label={`${title} composer`}
          onSubmit={submit}
        >
          <div className={styles.composerField}>
            {context ? (
              <div className={styles.contextChip}>
                <span className={styles.contextIcon} aria-hidden="true">
                  <ContextIcon kind={context.kind} />
                </span>
                <span className={styles.contextLabel}>{context.label}</span>
                {context.detail ? (
                  <span className={styles.contextDetail}>{context.detail}</span>
                ) : null}
              </div>
            ) : null}
            <textarea
              ref={composerRef}
              className={styles.textarea}
              value={composerValue}
              rows={1}
              aria-label={composerLabel}
              aria-keyshortcuts={submitOnEnter ? "Enter" : undefined}
              disabled={disabled}
              enterKeyHint={submitOnEnter ? "send" : "enter"}
              maxLength={maxComposerLength}
              placeholder={assistantComposerPlaceholder(context)}
              onFocus={() => void activate(true)}
              onChange={(event) => {
                draftRef.current = event.currentTarget.value;
                onComposerChange(event.currentTarget.value);
                void activate(true);
              }}
              onKeyDown={handleComposerKeyDown}
            />
            <div className={styles.composerToolbar}>
              <button
                className={styles.composerButton}
                type="button"
                aria-label="Add attachment"
                title={props.attachmentTitle ?? "Add attachment"}
                onClick={() => void activate(true)}
              >
                <PlusIcon />
              </button>
              <button
                className={classNames(styles.composerButton, styles.submitButton)}
                type="submit"
                disabled={!canSubmit}
                aria-label="Send message"
                title={submitOnEnter ? "Send message (Return)" : "Send message"}
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </form>
      </aside>
    </div>
  );
}
