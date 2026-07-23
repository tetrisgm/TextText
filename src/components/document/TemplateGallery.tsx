"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { DocumentRenderer } from "./DocumentRenderer";
import styles from "./TemplateGallery.module.css";

export function TemplateGallery({
  document,
  templates,
  onApply,
  onClose,
}: {
  document: DocumentSnapshot;
  templates: readonly TemplateDefinition[];
  onApply: (template: TemplateDefinition) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<TemplateDefinition | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const backRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (preview) continueRef.current?.focus();
    else cardRefs.current[focusIndex]?.focus();
  }, [focusIndex, preview]);

  const back = useCallback(() => {
    if (preview) {
      setPreview(null);
      return;
    }
    onClose();
  }, [onClose, preview]);

  useEffect(() => {
    const handle = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable=true]")) return;
      event.preventDefault();
      back();
    };
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, [back]);

  const handleGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const columns = window.matchMedia("(max-width: 620px)").matches
      ? 1
      : window.matchMedia("(max-width: 900px)").matches
        ? 2
        : 3;
    let next = focusIndex;
    if (event.key === "ArrowRight") next += 1;
    else if (event.key === "ArrowLeft") next -= 1;
    else if (event.key === "ArrowDown") next += columns;
    else if (event.key === "ArrowUp") {
      if (focusIndex < columns) {
        event.preventDefault();
        backRef.current?.focus();
        return;
      }
      next -= columns;
    } else if (event.key === "Enter") {
      event.preventDefault();
      setPreview(templates[focusIndex] ?? null);
      return;
    } else return;
    event.preventDefault();
    setFocusIndex(Math.max(0, Math.min(templates.length - 1, next)));
  };

  if (preview) {
    return (
      <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Preview look">
        <section className={styles.preview}>
          <button
            ref={backRef}
            type="button"
            className={`${styles.backButton} ${styles.previewBack}`}
            onClick={() => setPreview(null)}
          >
            Try another theme
          </button>
          <div className={styles.previewDocument}>
            <DocumentRenderer document={document} template={preview} documentId="template-preview" />
          </div>
          <button
            ref={continueRef}
            type="button"
            className={styles.continueButton}
            onClick={() => onApply(preview)}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                backRef.current?.focus();
              }
            }}
          >
            Continue
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="template-gallery-title">
      <section className={styles.chooser}>
        <button ref={backRef} type="button" className={styles.backButton} onClick={onClose}>
          Back
        </button>
        <h2 id="template-gallery-title">Choose a look</h2>
        <div className={styles.grid} onKeyDown={handleGridKey}>
          {templates.map((template, index) => (
            <button
              key={`${template.id}@${template.version}`}
              ref={(node) => { cardRefs.current[index] = node; }}
              type="button"
              className={styles.card}
              onFocus={() => setFocusIndex(index)}
              onClick={() => setPreview(template)}
              aria-label={template.name}
            >
              <div className={styles.cardPreview} aria-hidden="true">
                <DocumentRenderer
                  document={document}
                  template={template}
                  documentId={`template-${index}`}
                />
              </div>
              <span className={styles.cardName}>{template.name}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
