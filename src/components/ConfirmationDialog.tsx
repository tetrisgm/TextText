"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";

type ConfirmationDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmingLabel?: string;
  cancelLabel?: string;
  confirming?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmationDialog({
  open,
  title,
  message,
  confirmLabel,
  confirmingLabel = "Working",
  cancelLabel = "Cancel",
  confirming = false,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      confirmRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.setTimeout(() => {
        restoreFocusRef.current?.focus({ preventScroll: true });
        restoreFocusRef.current = null;
      }, 0);
    };
  }, [open]);

  const runConfirm = useCallback(() => {
    if (!confirming) onConfirm();
  }, [confirming, onConfirm]);

  const cancel = useCallback(() => {
    if (!confirming) onCancel();
  }, [confirming, onCancel]);

  useEscapeLayer(open, "Confirmation dialog", cancel);

  const focusButton = useCallback((direction: "next" | "previous") => {
    const active = document.activeElement;
    if (direction === "next") {
      if (active === cancelRef.current) confirmRef.current?.focus();
      else cancelRef.current?.focus();
      return;
    }
    if (active === confirmRef.current) cancelRef.current?.focus();
    else confirmRef.current?.focus();
  }, []);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="confirmation-backdrop applecms"
      data-post-edit-menu-open="true"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          runConfirm();
          return;
        }
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          focusButton("next");
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          focusButton("previous");
          return;
        }
        if (event.key !== "Tab") return;

        const active = document.activeElement;
        if (event.shiftKey && active === cancelRef.current) {
          event.preventDefault();
          confirmRef.current?.focus();
        } else if (!event.shiftKey && active === confirmRef.current) {
          event.preventDefault();
          cancelRef.current?.focus();
        }
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
            {title}
          </h2>
          <p id={messageId} className="confirmation-dialog-message">
            {message}
          </p>
        </div>
        <div className="confirmation-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="confirmation-dialog-button confirmation-dialog-cancel ac-btn ac-btn-gray"
            disabled={confirming}
            onClick={cancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="confirmation-dialog-button confirmation-dialog-confirm ac-btn ac-btn-filled"
            disabled={confirming}
            onClick={runConfirm}
          >
            {confirming ? confirmingLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
