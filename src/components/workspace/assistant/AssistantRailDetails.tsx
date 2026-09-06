import type { AssistantAttachment, AssistantSidebarProps } from "./AssistantSidebar";
import styles from "./AssistantSidebar.module.css";

export function AssistantAttachmentList({ attachments, disabled, onRemove }: {
  attachments: readonly AssistantAttachment[]; disabled?: boolean;
  onRemove?: (attachment: AssistantAttachment) => void;
}) {
  if (!attachments.length) return null;
  return (
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
              disabled={disabled}
              aria-label={`${attachment.workspaceItemId ? "Remove context" : "Remove attachment"} ${attachment.name}`}
              title={`Remove ${attachment.name}`}
              onClick={() => onRemove?.(attachment)}
            >
              <SmallCloseIcon />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function AssistantHistorySync({ status, onRetry }: {
  status: AssistantSidebarProps["historySyncStatus"]; onRetry?: () => void;
}) {
  return <div className={styles.historySync}>
    {status && <span role="status" aria-live="polite" aria-atomic="true">
      {status === "syncing" ? "Syncing" : status === "synced" ? "Synced" : status === "offline" ? "Offline" : "Saved on this device"}
    </span>}
    {(status === "offline" || status === "error") && onRetry &&
      <button type="button" className={styles.retrySync} onClick={onRetry}>Retry sync</button>}
  </div>;
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

export function DocumentIcon() {
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

export function StopIcon() {
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
