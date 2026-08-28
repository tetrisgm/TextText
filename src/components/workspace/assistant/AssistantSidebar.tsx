"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  ChangeEvent,
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import { ShortcutTooltip } from "@/components/keyboard/ShortcutTooltip";
import type { AssistantContext } from "./context";
import styles from "./AssistantSidebar.module.css";
import { CollaboratorMark } from "@/components/collab/CollaboratorMark";
import type { AssistantAgentIdentity } from "./agent-identity";
import { AssistantConversationHistory } from "./AssistantConversationHistory";
import type { AssistantConversationSummary } from "./conversation-store";
import type { AssistantModelChoice } from "./model-preference";
import { WorkspaceAssistantSkillLauncher } from "./AssistantSkillLauncher";

export type { AssistantContext } from "./context";

export const ASSISTANT_SIDEBAR_DEFAULT_WIDTH = 360;
export const ASSISTANT_SIDEBAR_MIN_WIDTH = 280;
export const ASSISTANT_SIDEBAR_MAX_WIDTH = 600;

export type AssistantSidebarState = "hidden" | "open" | "pinned";

export type AssistantSidebarLayout = "auto" | "inline" | "overlay";

export type AssistantAttachment = {
  file?: File;
  id: string;
  name: string;
  size?: number;
  type?: string;
  /** A real TextText item added as bounded prompt context. */
  workspaceItemId?: string;
  detail?: string;
};

export type AssistantWorkspaceContextItem = {
  id: string;
  name: string;
  detail: string;
};

export type AssistantComposerSubmission = {
  text: string;
  attachments: readonly AssistantAttachment[];
};

export type AssistantSidebarProps = {
  /** Owner-scoped workspace used to load reusable skill names and shortcuts. */
  workspaceHandle?: string;
  agent?: AssistantAgentIdentity | null;
  state: AssistantSidebarState;
  onStateChange: (state: AssistantSidebarState) => void;
  /** Clears the transcript for where the person is, without moving them. */
  onNewConversation?: () => void;
  /** Whether there is anything to clear. */
  hasConversation?: boolean;
  conversations?: readonly AssistantConversationSummary[];
  activeConversationId?: string | null;
  onOpenConversation?: (conversationId: string) => void;
  onSearchConversations?: (
    query: string,
  ) => readonly AssistantConversationSummary[];
  onToggleConversationPinned?: (conversationId: string) => void;
  modelChoices?: readonly AssistantModelChoice[];
  selectedModel?: string | null;
  onModelChange?: (model: string) => void;
  width: number;
  onWidthChange: (width: number) => void;
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSubmit: (submission: AssistantComposerSubmission) => void;
  onCancel?: () => void;
  onFilesSelected: (files: readonly File[]) => void;
  onRemoveAttachment: (attachment: AssistantAttachment) => void;
  attachments?: readonly AssistantAttachment[];
  availableContextItems?: readonly AssistantWorkspaceContextItem[];
  onAddContextItem?: (item: AssistantWorkspaceContextItem) => void;
  context?: AssistantContext | null;
  children?: ReactNode;
  layout?: AssistantSidebarLayout;
  minWidth?: number;
  maxWidth?: number;
  resizeStep?: number;
  title?: string;
  ariaLabel?: string;
  contentLabel?: string;
  composerLabel?: string;
  composerPlaceholder?: string;
  accept?: string;
  attachmentDisabled?: boolean;
  attachmentTitle?: string;
  multiple?: boolean;
  maxComposerLength?: number;
  submitOnEnter?: boolean;
  disabled?: boolean;
  submitDisabled?: boolean;
  submitting?: boolean;
  /** Shows a pulsing badge on the launcher while background jobs run. */
  launcherBusy?: boolean;
  panelId?: string;
  className?: string;
  style?: CSSProperties;
  edgePeeking?: boolean;
  onEdgePeekEngage?: () => void;
};

type ResizeSession = {
  pointerId: number;
  startWidth: number;
  startX: number;
};

const EMPTY_ATTACHMENTS: readonly AssistantAttachment[] = [];
const EMPTY_CONTEXT_ITEMS: readonly AssistantWorkspaceContextItem[] = [];

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function positiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function assistantComposerPlaceholder(
  context: AssistantContext | null | undefined,
): string {
  if (context?.kind === "item") return "Ask or change this item";
  if (context?.kind === "folder") return "Ask or work with this collection";
  return "Find, create, or change anything";
}

export function resolveAssistantSidebarDimensions({
  availableWidth,
  maxWidth,
  minWidth,
  width,
}: {
  availableWidth?: number | null;
  maxWidth: number;
  minWidth: number;
  width: number;
}) {
  const configuredMin = Math.round(
    positiveNumber(minWidth, ASSISTANT_SIDEBAR_MIN_WIDTH),
  );
  const configuredMax = Math.max(
    configuredMin,
    Math.round(positiveNumber(maxWidth, ASSISTANT_SIDEBAR_MAX_WIDTH)),
  );
  const viewportLimit =
    availableWidth !== null &&
    availableWidth !== undefined &&
    Number.isFinite(availableWidth) &&
    availableWidth > 0
      ? Math.max(1, Math.floor(availableWidth))
      : null;
  const resolvedMinWidth = viewportLimit
    ? Math.min(configuredMin, viewportLimit)
    : configuredMin;
  const resolvedMaxWidth = viewportLimit
    ? Math.max(resolvedMinWidth, Math.min(configuredMax, viewportLimit))
    : configuredMax;
  const resolvedWidth = Math.round(
    clamp(
      positiveNumber(width, ASSISTANT_SIDEBAR_DEFAULT_WIDTH),
      resolvedMinWidth,
      resolvedMaxWidth,
    ),
  );

  return { resolvedMaxWidth, resolvedMinWidth, resolvedWidth };
}

export function isAssistantToggleShortcut(
  event: Pick<
    KeyboardEvent,
    "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
  >,
): boolean {
  return (
    !event.altKey &&
    event.shiftKey &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "a"
  );
}


function formatFileSize(value: number | undefined): string | null {
  if (value === undefined || !Number.isFinite(value) || value < 0) return null;
  if (value < 1024) return `${Math.round(value)} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  const precision = amount < 10 ? 1 : 0;
  return `${amount.toFixed(precision)} ${units[unitIndex]}`;
}

export function AssistantSidebar({
  workspaceHandle,
  agent,
  state,
  onStateChange,
  onNewConversation,
  hasConversation = false,
  conversations = [],
  activeConversationId = null,
  onOpenConversation,
  onSearchConversations,
  onToggleConversationPinned,
  modelChoices = [],
  selectedModel = null,
  onModelChange,
  width,
  onWidthChange,
  composerValue,
  onComposerChange,
  onSubmit,
  onCancel,
  onFilesSelected,
  onRemoveAttachment,
  attachments = EMPTY_ATTACHMENTS,
  availableContextItems = EMPTY_CONTEXT_ITEMS,
  onAddContextItem,
  context,
  children,
  layout = "auto",
  minWidth = ASSISTANT_SIDEBAR_MIN_WIDTH,
  maxWidth = ASSISTANT_SIDEBAR_MAX_WIDTH,
  resizeStep = 16,
  title = "Assistant",
  ariaLabel,
  contentLabel,
  composerLabel = "Message assistant",
  composerPlaceholder,
  accept,
  attachmentDisabled = false,
  attachmentTitle = "Add attachment",
  multiple = true,
  maxComposerLength,
  submitOnEnter = true,
  disabled = false,
  submitDisabled = false,
  submitting = false,
  launcherBusy = false,
  panelId: panelIdProp,
  className,
  style,
}: AssistantSidebarProps) {
  const generatedPanelId = useId();
  const titleId = useId();
  const fileInputId = useId();
  const panelId = panelIdProp ?? `assistant-sidebar-${generatedPanelId}`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousStateRef = useRef(state);
  const focusOnOpenRef = useRef(true);
  const pointerWithinRef = useRef(false);
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const [resizing, setResizing] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [contextQuery, setContextQuery] = useState("");

  const { resolvedMaxWidth, resolvedMinWidth, resolvedWidth } =
    resolveAssistantSidebarDimensions({
      availableWidth: viewportWidth,
      maxWidth,
      minWidth,
      width,
    });
  const resolvedResizeStep = positiveNumber(resizeStep, 16);
  const resolvedComposerPlaceholder =
    composerPlaceholder ?? assistantComposerPlaceholder(context);
  const selectedContextIds = new Set(
    attachments.flatMap((attachment) =>
      attachment.workspaceItemId ? [attachment.workspaceItemId] : [],
    ),
  );
  const contextLimitReached = selectedContextIds.size >= 4;
  const contextChoices = availableContextItems
    .filter((item) => !selectedContextIds.has(item.id))
    .filter((item) => {
      const query = contextQuery.trim().toLowerCase();
      return !query || `${item.name} ${item.detail}`.toLowerCase().includes(query);
    })
    .slice(0, 8);
  // The rail is open or it is closed; there is nothing else. A floating
  // third state (an overlay that covered the page, plus a hover-peek that
  // opened it uninvited) is what made the layout read as chaos: the panel
  // over the sort controls, the toggle over the search bar, two surfaces
  // fighting for the same pixels. "open" survives in the type only so old
  // saved values still parse; it means open.
  const visible = state !== "hidden";
  const revealed = visible;
  const canSubmit =
    !disabled &&
    !submitDisabled &&
    !submitting &&
    (composerValue.trim().length > 0 || attachments.length > 0);
  const rootStyle = {
    ...style,
    "--assistant-sidebar-width": `${resolvedWidth}px`,
    "--assistant-sidebar-min-width": `${resolvedMinWidth}px`,
    "--assistant-sidebar-max-width": `${resolvedMaxWidth}px`,
  } as CSSProperties;

  const showAssistant = useCallback(() => {
    focusOnOpenRef.current = true;
    onStateChange("pinned");
  }, [onStateChange]);

  const hideAssistant = useCallback(() => {
    onStateChange("hidden");
  }, [onStateChange]);

  const toggleAssistant = useCallback(() => {
    if (revealed) hideAssistant();
    else showAssistant();
  }, [hideAssistant, revealed, showAssistant]);

  useEscapeLayer(visible && focusWithin, "Assistant", hideAssistant);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  useEffect(() => {
    const onToggleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isAssistantToggleShortcut(event)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      toggleAssistant();
    };
    window.addEventListener("keydown", onToggleShortcut, true);
    return () => window.removeEventListener("keydown", onToggleShortcut, true);
  }, [toggleAssistant]);

  useEffect(() => {
    const previousState = previousStateRef.current;
    previousStateRef.current = state;

    if (previousState === "hidden" && visible) {
      if (focusOnOpenRef.current) {
        if (disabled) closeButtonRef.current?.focus();
        else composerRef.current?.focus({ preventScroll: true });
      }
      focusOnOpenRef.current = true;
    } else if (previousState !== "hidden" && !visible) {
      launcherRef.current?.focus();
    }
  }, [disabled, state, visible]);

  const handleRootPointerEnter = () => {
    pointerWithinRef.current = true;
  };
  const handleRootPointerLeave = () => {
    pointerWithinRef.current = false;
  };

  const requestWidth = (nextWidth: number) => {
    onWidthChange(
      Math.round(clamp(nextWidth, resolvedMinWidth, resolvedMaxWidth)),
    );
  };

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!visible || event.button !== 0) return;

    event.preventDefault();
    resizeSessionRef.current = {
      pointerId: event.pointerId,
      startWidth: resolvedWidth,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  };

  const continueResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    event.preventDefault();
    requestWidth(session.startWidth + session.startX - event.clientX);
  };

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    resizeSessionRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const loseResizeCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeSessionRef.current?.pointerId !== event.pointerId) return;
    resizeSessionRef.current = null;
    setResizing(false);
  };

  const resizeFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = resolvedResizeStep * (event.shiftKey ? 4 : 1);
    let nextWidth: number | null = null;

    if (event.key === "ArrowLeft") nextWidth = resolvedWidth + step;
    if (event.key === "ArrowRight") nextWidth = resolvedWidth - step;
    if (event.key === "Home") nextWidth = resolvedMinWidth;
    if (event.key === "End") nextWidth = resolvedMaxWidth;
    if (nextWidth === null) return;

    event.preventDefault();
    requestWidth(nextWidth);
  };

  const chooseFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (files?.length) onFilesSelected(Array.from(files));
    event.currentTarget.value = "";
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ text: composerValue, attachments });
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

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.key !== "Escape" || !revealed) return;
    event.preventDefault();
    event.stopPropagation();
    hideAssistant();
  };

  const handlePanelFocus = () => {
    setFocusWithin(true);
  };

  const handlePanelPointerDown = () => {};

  const handlePanelBlur = (event: ReactFocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
      setFocusWithin(false);
    }
  };

  return (
    <div
      className={classNames("applecms", styles.root, className)}
      data-assistant-sidebar=""
      data-layout={layout}
      data-resizing={resizing ? "true" : undefined}
      data-state={state}
      style={rootStyle}
      onPointerEnter={handleRootPointerEnter}
      onPointerLeave={handleRootPointerLeave}
    >
      {state === "hidden" && (
        <ShortcutTooltip
          className={styles.launcherWrap}
          label={launcherBusy ? "Assistant is working" : agent ? `Chat with ${agent.name}` : "Open assistant"}
          keys="⌘⇧A"
          placement="top"
        >
          <button
            ref={launcherRef}
            className={styles.launcher}
            type="button"
            aria-controls={panelId}
            aria-expanded="false"
            aria-keyshortcuts="Meta+Shift+A Control+Shift+A"
            aria-label={
              launcherBusy ? "Open assistant (working)" : agent ? `Chat with ${agent.name}` : "Open assistant"
            }
            onClick={showAssistant}
          >
            {agent ? <span className={styles.launcherAvatar} style={{ backgroundColor: agent.color }}><CollaboratorMark provider={agent.provider} name={agent.name} /></span> : <SidebarIcon />}
            {launcherBusy && (
              <span className={styles.launcherBusy} aria-hidden="true" />
            )}
          </button>
        </ShortcutTooltip>
      )}

      <aside
        ref={panelRef}
        id={panelId}
        className={styles.panel}
        aria-hidden={!revealed}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : titleId}
        inert={revealed ? undefined : true}
        onBlurCapture={handlePanelBlur}
        onFocusCapture={handlePanelFocus}
        onPointerDownCapture={handlePanelPointerDown}
        onKeyDown={handlePanelKeyDown}
      >
        <div
          className={styles.resizer}
          role="separator"
          tabIndex={visible ? 0 : -1}
          aria-label="Resize assistant sidebar"
          aria-orientation="vertical"
          aria-valuemax={resolvedMaxWidth}
          aria-valuemin={resolvedMinWidth}
          aria-valuenow={resolvedWidth}
          aria-valuetext={`${resolvedWidth} pixels wide`}
          title="Resize assistant sidebar"
          onKeyDown={resizeFromKeyboard}
          onLostPointerCapture={loseResizeCapture}
          onPointerCancel={finishResize}
          onPointerDown={beginResize}
          onPointerMove={continueResize}
          onPointerUp={finishResize}
        />

        <header className={styles.header}>
          <div className={styles.titleRow}>
            {agent && <span className={styles.agentAvatar} style={{ backgroundColor: agent.color }}><CollaboratorMark provider={agent.provider} name={agent.name} /></span>}
            <h2 id={titleId} className={styles.title}>
              {agent ? `Chat with ${agent.name}` : title}
            </h2>
            <div className={styles.headerActions}>
              {onModelChange && modelChoices.length > 1 ? (
                <select
                  className={styles.modelSelect}
                  aria-label="Assistant model"
                  title="Assistant model"
                  value={selectedModel ?? modelChoices[0]?.id}
                  onChange={(event) => onModelChange(event.currentTarget.value)}
                >
                  {modelChoices.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              ) : null}
              {onNewConversation &&
              onOpenConversation &&
              onToggleConversationPinned &&
              conversations.length > 0 ? (
                <AssistantConversationHistory
                  activeConversationId={activeConversationId}
                  conversations={conversations}
                  onNewConversation={onNewConversation}
                  onOpenConversation={onOpenConversation}
                  onSearchConversations={onSearchConversations}
                  onTogglePinned={onToggleConversationPinned}
                />
              ) : null}
              {/* A transcript is keyed to where you are, so without this the
                  only way to get a clean one was to navigate away and come
                  back. Hidden when there is nothing to clear, so it never
                  offers to do nothing. */}
              {onNewConversation && hasConversation ? (
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label="New chat"
                  title="New chat"
                  onClick={onNewConversation}
                >
                  <NewChatIcon />
                </button>
              ) : null}
              <button
                ref={closeButtonRef}
                className={styles.iconButton}
                type="button"
                aria-label="Hide assistant"
                aria-keyshortcuts="Meta+Shift+A Control+Shift+A"
                title="Hide assistant"
                onClick={hideAssistant}
              >
                <CloseIcon />
              </button>
            </div>
          </div>

        </header>

        <div
          className={styles.content}
          role="region"
          aria-label={contentLabel ?? `${title} conversation`}
        >
          {children}
        </div>

        <form
          className={styles.composer}
          aria-busy={submitting || undefined}
          aria-label={`${title} composer`}
          onSubmit={submit}
        >
          {!attachmentDisabled ? (
            <input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              accept={accept}
              aria-label="Choose assistant attachments"
              disabled={disabled || submitting}
              hidden
              multiple={multiple}
              onChange={chooseFiles}
            />
          ) : null}

          {attachments.length > 0 && (
            <ul className={styles.attachmentList} aria-label="Added context">
              {attachments.map((attachment) => {
                const fileSize = formatFileSize(attachment.size);
                return (
                  <li className={styles.attachmentChip} key={attachment.id}>
                    <span className={styles.attachmentIcon} aria-hidden="true">
                      {attachment.workspaceItemId ? <DocumentIcon /> : <AttachmentIcon />}
                    </span>
                    <span className={styles.attachmentCopy}>
                      <span
                        className={styles.attachmentName}
                        title={attachment.name}
                      >
                        {attachment.name}
                      </span>
                      {(attachment.detail || fileSize) && (
                        <span className={styles.attachmentSize}>{attachment.detail || fileSize}</span>
                      )}
                    </span>
                    <button
                      className={styles.removeAttachmentButton}
                      type="button"
                      disabled={disabled || submitting}
                      aria-label={`${attachment.workspaceItemId ? "Remove context" : "Remove attachment"} ${attachment.name}`}
                      title={`Remove ${attachment.name}`}
                      onClick={() => onRemoveAttachment(attachment)}
                    >
                      <SmallCloseIcon />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className={styles.composerField}>
            {workspaceHandle ? (
              <WorkspaceAssistantSkillLauncher
                handle={workspaceHandle}
                composerRef={composerRef}
                value={composerValue}
                onChange={onComposerChange}
                disabled={disabled || submitting}
              />
            ) : null}
            {/* The chip lives with the input, where it answers the question
                the input raises: what will this message be about? Removable
                scope belongs here too when it arrives; the header stays a
                title bar. */}
            {context && (
              <div
                className={styles.contextChip}
                aria-label={
                  context.detail
                    ? `Context: ${context.label}, ${context.detail}`
                    : `Context: ${context.label}`
                }
                title={
                  context.detail
                    ? `${context.label} - ${context.detail}`
                    : context.label
                }
              >
                <span className={styles.contextIcon} aria-hidden="true">
                  {context.kind === "folder" ? (
                    <FolderIcon />
                  ) : context.kind === "workspace" ? (
                    <WorkspaceIcon />
                  ) : (
                    <DocumentIcon />
                  )}
                </span>
                <span className={styles.contextLabel}>{context.label}</span>
                {context.detail && (
                  <span className={styles.contextDetail}>{context.detail}</span>
                )}
              </div>
            )}
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
              placeholder={resolvedComposerPlaceholder}
              onChange={(event) => onComposerChange(event.currentTarget.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <div className={styles.composerToolbar}>
              {onAddContextItem &&
              availableContextItems.length > 0 &&
              !contextLimitReached ? (
                <div className={styles.contextPicker}>
                  <button
                    className={styles.composerButton}
                    type="button"
                    disabled={disabled || submitting}
                    aria-expanded={contextPickerOpen}
                    aria-label="Add TextText context"
                    title="Add a TextText item as context"
                    onClick={() => setContextPickerOpen((open) => !open)}
                  >
                    <PlusIcon />
                  </button>
                  {contextPickerOpen ? (
                    <div className={styles.contextPickerPanel} role="dialog" aria-label="Add TextText context">
                      <input
                        autoFocus
                        aria-label="Search TextText items"
                        placeholder="Search items"
                        value={contextQuery}
                        onChange={(event) => setContextQuery(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.stopPropagation();
                            const first = contextChoices[0];
                            if (!first) return;
                            onAddContextItem(first);
                            setContextPickerOpen(false);
                            setContextQuery("");
                            composerRef.current?.focus();
                            return;
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            setContextPickerOpen(false);
                            setContextQuery("");
                            composerRef.current?.focus();
                          }
                        }}
                      />
                      <div className={styles.contextPickerResults}>
                        {contextChoices.length > 0 ? contextChoices.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              onAddContextItem(item);
                              setContextPickerOpen(false);
                              setContextQuery("");
                              composerRef.current?.focus();
                            }}
                          >
                            <span>{item.name}</span>
                            <small>{item.detail}</small>
                          </button>
                        )) : <span className={styles.contextPickerEmpty}>No matching items</span>}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : !attachmentDisabled ? (
                <button
                  className={styles.composerButton}
                  type="button"
                  disabled={disabled || submitting}
                  aria-controls={fileInputId}
                  aria-label="Add attachment"
                  title={attachmentTitle}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <PlusIcon />
                </button>
              ) : <span />}
              {submitting ? (
                <button
                  className={classNames(
                    styles.composerButton,
                    styles.submitButton,
                  )}
                  type="button"
                  aria-label="Stop assistant"
                  title="Stop assistant"
                  onClick={() => onCancel?.()}
                >
                  <StopIcon />
                </button>
              ) : (
                <button
                  className={classNames(
                    styles.composerButton,
                    styles.submitButton,
                  )}
                  type="submit"
                  disabled={!canSubmit}
                  aria-label="Send message"
                  title={
                    submitOnEnter ? "Send message (Return)" : "Send message"
                  }
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
        </form>
      </aside>
    </div>
  );
}

function SidebarIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect
        x="2.75"
        y="3.25"
        width="12.5"
        height="11.5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M11.25 3.75v10.5M8.75 6.75 10.9 9l-2.15 2.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** A page with a pen: start again on what you are looking at. */
function NewChatIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
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

function DocumentIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.75 2.25h5.4l3.1 3.1v8.4h-8.5V2.25Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
      <path
        d="M9 2.5v3h3M5.75 8.25h4.5M5.75 10.5h3.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.25 4.25h4l1.15 1.4h6.35v7.1H2.25v-8.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
      <path
        d="M2.5 6h11"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function WorkspaceIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.25"
        y="2.25"
        width="11.5"
        height="11.5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M6 2.75v10.5M6.5 6h6.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function AttachmentIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m5.15 8.95 4.2-4.2a2.1 2.1 0 0 1 2.95 2.95l-5.2 5.2a3.1 3.1 0 0 1-4.4-4.4l5.05-5.05M6.4 10.2l4.4-4.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
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

function SmallCloseIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="m4.25 4.25 5.5 5.5m0-5.5-5.5 5.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.45"
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

function StopIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect
        x="5"
        y="5"
        width="8"
        height="8"
        rx="1.25"
        fill="currentColor"
      />
    </svg>
  );
}

export default AssistantSidebar;
