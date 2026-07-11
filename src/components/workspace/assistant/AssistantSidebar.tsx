"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  ChangeEvent,
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import styles from "./AssistantSidebar.module.css";

export const ASSISTANT_SIDEBAR_DEFAULT_WIDTH = 360;
export const ASSISTANT_SIDEBAR_MIN_WIDTH = 280;
export const ASSISTANT_SIDEBAR_MAX_WIDTH = 600;

export type AssistantSidebarState = "hidden" | "open" | "pinned";

export type AssistantSidebarLayout = "auto" | "inline" | "overlay";

export type AssistantContext = {
  label: string;
  detail?: string;
};

export type AssistantAttachment = {
  id: string;
  name: string;
  size?: number;
};

export type AssistantComposerSubmission = {
  text: string;
  attachments: readonly AssistantAttachment[];
};

export type AssistantSidebarProps = {
  state: AssistantSidebarState;
  onStateChange: (state: AssistantSidebarState) => void;
  width: number;
  onWidthChange: (width: number) => void;
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSubmit: (submission: AssistantComposerSubmission) => void;
  onFilesSelected: (files: readonly File[]) => void;
  onRemoveAttachment: (attachment: AssistantAttachment) => void;
  attachments?: readonly AssistantAttachment[];
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
};

type ResizeSession = {
  pointerId: number;
  startWidth: number;
  startX: number;
};

const EMPTY_ATTACHMENTS: readonly AssistantAttachment[] = [];

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function positiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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
  state,
  onStateChange,
  width,
  onWidthChange,
  composerValue,
  onComposerChange,
  onSubmit,
  onFilesSelected,
  onRemoveAttachment,
  attachments = EMPTY_ATTACHMENTS,
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
  composerPlaceholder = "Ask about this page",
  accept,
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
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousStateRef = useRef(state);
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const [resizing, setResizing] = useState(false);

  const resolvedMinWidth = Math.round(
    positiveNumber(minWidth, ASSISTANT_SIDEBAR_MIN_WIDTH),
  );
  const resolvedMaxWidth = Math.max(
    resolvedMinWidth,
    Math.round(positiveNumber(maxWidth, ASSISTANT_SIDEBAR_MAX_WIDTH)),
  );
  const resolvedWidth = Math.round(
    clamp(
      positiveNumber(width, ASSISTANT_SIDEBAR_DEFAULT_WIDTH),
      resolvedMinWidth,
      resolvedMaxWidth,
    ),
  );
  const resolvedResizeStep = positiveNumber(resizeStep, 16);
  const visible = state !== "hidden";
  const pinned = state === "pinned";
  const canSubmit =
    !disabled &&
    !submitDisabled &&
    !submitting &&
    (composerValue.trim().length > 0 || attachments.length > 0);
  const pinLabel = pinned ? "Unpin assistant" : "Pin assistant";
  const rootStyle = {
    ...style,
    "--assistant-sidebar-width": `${resolvedWidth}px`,
    "--assistant-sidebar-min-width": `${resolvedMinWidth}px`,
    "--assistant-sidebar-max-width": `${resolvedMaxWidth}px`,
  } as CSSProperties;

  useEscapeLayer(visible, "Assistant", () => onStateChange("hidden"));

  useEffect(() => {
    const previousState = previousStateRef.current;
    previousStateRef.current = state;

    if (previousState === "hidden" && visible) {
      closeButtonRef.current?.focus();
    } else if (previousState !== "hidden" && !visible) {
      launcherRef.current?.focus();
    }
  }, [state, visible]);

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
    if (event.key !== "Escape" || !visible) return;
    event.preventDefault();
    event.stopPropagation();
    onStateChange("hidden");
  };

  return (
    <div
      className={classNames("applecms", styles.root, className)}
      data-assistant-sidebar=""
      data-layout={layout}
      data-resizing={resizing ? "true" : undefined}
      data-state={state}
      style={rootStyle}
    >
      {state === "hidden" && (
        <button
          ref={launcherRef}
          className={styles.launcher}
          type="button"
          aria-controls={panelId}
          aria-expanded="false"
          aria-label={
            launcherBusy ? "Open assistant (working)" : "Open assistant"
          }
          title={launcherBusy ? "Assistant is working" : "Open assistant"}
          onClick={() => onStateChange("open")}
        >
          <SidebarIcon />
          {launcherBusy && (
            <span className={styles.launcherBusy} aria-hidden="true" />
          )}
        </button>
      )}

      <aside
        id={panelId}
        className={styles.panel}
        aria-hidden={!visible}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : titleId}
        inert={visible ? undefined : true}
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
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <div className={styles.headerActions}>
              <button
                className={styles.iconButton}
                type="button"
                aria-label={pinLabel}
                aria-pressed={pinned}
                title={pinLabel}
                onClick={() => onStateChange(pinned ? "open" : "pinned")}
              >
                <PinIcon pinned={pinned} />
              </button>
              <button
                ref={closeButtonRef}
                className={styles.iconButton}
                type="button"
                aria-label="Hide assistant"
                title="Hide assistant"
                onClick={() => onStateChange("hidden")}
              >
                <CloseIcon />
              </button>
            </div>
          </div>

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
                <DocumentIcon />
              </span>
              <span className={styles.contextLabel}>{context.label}</span>
              {context.detail && (
                <span className={styles.contextDetail}>{context.detail}</span>
              )}
            </div>
          )}
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
          <input
            ref={fileInputRef}
            id={fileInputId}
            type="file"
            accept={accept}
            disabled={disabled || submitting}
            hidden
            multiple={multiple}
            onChange={chooseFiles}
          />

          {attachments.length > 0 && (
            <ul className={styles.attachmentList} aria-label="Attachments">
              {attachments.map((attachment) => {
                const fileSize = formatFileSize(attachment.size);
                return (
                  <li className={styles.attachmentChip} key={attachment.id}>
                    <span className={styles.attachmentIcon} aria-hidden="true">
                      <AttachmentIcon />
                    </span>
                    <span className={styles.attachmentCopy}>
                      <span
                        className={styles.attachmentName}
                        title={attachment.name}
                      >
                        {attachment.name}
                      </span>
                      {fileSize && (
                        <span className={styles.attachmentSize}>{fileSize}</span>
                      )}
                    </span>
                    <button
                      className={styles.removeAttachmentButton}
                      type="button"
                      disabled={disabled || submitting}
                      aria-label={`Remove attachment ${attachment.name}`}
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
            <textarea
              className={styles.textarea}
              value={composerValue}
              rows={1}
              aria-label={composerLabel}
              disabled={disabled}
              enterKeyHint={submitOnEnter ? "send" : "enter"}
              maxLength={maxComposerLength}
              placeholder={composerPlaceholder}
              onChange={(event) => onComposerChange(event.currentTarget.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <div className={styles.composerToolbar}>
              <button
                className={styles.composerButton}
                type="button"
                disabled={disabled || submitting}
                aria-controls={fileInputId}
                aria-label="Add attachment"
                title="Add attachment"
                onClick={() => fileInputRef.current?.click()}
              >
                <PlusIcon />
              </button>
              <button
                className={classNames(
                  styles.composerButton,
                  styles.submitButton,
                )}
                type="submit"
                disabled={!canSubmit}
                aria-label={submitting ? "Sending message" : "Send message"}
                title={submitting ? "Sending message" : "Send message"}
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

function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M6.4 2.75h5.2l-.7 4.1 2.15 2.2v1.2H9.7v4.45l-.7.75-.7-.75v-4.45H4.95v-1.2l2.15-2.2-.7-4.1Z"
        fill={pinned ? "currentColor" : "none"}
        fillOpacity={pinned ? "0.16" : undefined}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.45"
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

export default AssistantSidebar;
