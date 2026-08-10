"use client";

/**
 * Confirming an account deletion.
 *
 * Not built on ConfirmationDialog, on purpose. That component's focus trap
 * moves between exactly two buttons, its Enter handler confirms
 * unconditionally, and its arrow handler calls preventDefault, so a caret could
 * not move inside a text field and a stray Enter would delete the account. The
 * mechanics here are copied from it; the keyboard rules are not.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";

export type AccountOverview = {
  email: string | null;
  username: string | null;
  handle: string;
  workspaceName: string;
  documents: number;
  publishedDocuments: number;
  collaborators: number;
  apiTokens: number;
  hasCloudAiKey: boolean;
  confirmationPhrase: string;
};

export type DeleteAccountStage = "idle" | "failed" | "incomplete" | "signedOut";

const STAGE_MESSAGE: Record<Exclude<DeleteAccountStage, "idle">, string> = {
  failed: "Nothing was deleted. Try again.",
  incomplete:
    "Your account is closed and your workspace is hidden, but some data is still being removed. Select Delete account again to finish.",
  signedOut: "Your session ended. Sign in again to delete your account.",
};

export default function DeleteAccountDialog({
  open,
  account,
  pending,
  stage,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  account: AccountOverview;
  pending: boolean;
  stage: DeleteAccountStage;
  onCancel: () => void;
  onConfirm: (confirmation: string) => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [typed, setTyped] = useState("");

  // No state reset here: the parent mounts this only while it is open, so every
  // open is a fresh mount and the field starts empty on its own. Resetting in
  // an effect instead would cascade a render on every open.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.setTimeout(() => {
        restoreFocusRef.current?.focus({ preventScroll: true });
        restoreFocusRef.current = null;
      }, 0);
    };
  }, [open]);

  const cancel = useCallback(() => {
    if (!pending) onCancel();
  }, [pending, onCancel]);

  useEscapeLayer(open, "Delete account dialog", cancel);

  const phrase = account.confirmationPhrase;
  const matches = typed.trim().toLowerCase() === phrase.trim().toLowerCase();

  if (!open || typeof document === "undefined") return null;

  // Only the true statements. A workspace with no collaborators should not be
  // told that zero people lose access.
  const consequences: string[] = [];
  if (account.documents > 0) {
    consequences.push(
      `${account.documents} ${account.documents === 1 ? "document is" : "documents are"} deleted, with their images, files, and drafts.`,
    );
  }
  consequences.push(
    `The workspace ${account.workspaceName} is deleted, with its folders and Trash.`,
  );
  if (account.publishedDocuments > 0) {
    consequences.push(
      `Published pages at /t/${account.handle} stop working. That address stays reserved, so nobody can publish at your old links.`,
    );
  }
  if (account.collaborators > 0) {
    consequences.push(
      `${account.collaborators} ${account.collaborators === 1 ? "person" : "people"} you share with lose access, and comments they wrote on your documents are deleted too.`,
    );
  }
  if (account.apiTokens > 0) {
    consequences.push(
      `${account.apiTokens} API ${account.apiTokens === 1 ? "token" : "tokens"} stop working. TextText on your other devices signs out.`,
    );
  }
  if (account.hasCloudAiKey) {
    consequences.push("Your saved cloud AI key is deleted.");
  }

  return createPortal(
    // The applecms class is re-declared here on purpose: outside the shell
    // every --ac-* token resolves to nothing.
    <div
      className="confirmation-backdrop applecms"
      data-post-edit-menu-open="true"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
        // Enter is deliberately not handled. The field owns it, and a
        // destructive action should never be one keystroke away.
      }}
    >
      <section
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <div className="confirmation-dialog-copy">
          <h2 id={titleId} className="confirmation-dialog-title">
            Delete your account?
          </h2>
          <p id={messageId} className="confirmation-dialog-message">
            This happens immediately. Nothing here can be restored, by you or by
            support.
          </p>
          <ul className="confirmation-dialog-list">
            {consequences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <label className="confirmation-dialog-field" htmlFor={fieldId}>
            <span>Type {phrase} to confirm</span>
            <input
              ref={inputRef}
              id={fieldId}
              type="text"
              value={typed}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={pending}
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
          {!account.email ? (
            <p className="confirmation-dialog-hint">
              This account has no email address on file.
            </p>
          ) : null}
          {stage !== "idle" ? (
            <p role="alert" className="confirmation-dialog-error">
              {STAGE_MESSAGE[stage]}
            </p>
          ) : null}
        </div>
        <div className="confirmation-dialog-actions">
          <button
            type="button"
            className="confirmation-dialog-button confirmation-dialog-cancel ac-btn ac-btn-gray"
            disabled={pending}
            onClick={cancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirmation-dialog-button confirmation-dialog-confirm ac-btn ac-btn-filled"
            disabled={pending || !matches}
            onClick={() => onConfirm(typed)}
          >
            {pending ? "Deleting" : "Delete account"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
