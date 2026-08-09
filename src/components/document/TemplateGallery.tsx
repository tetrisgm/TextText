"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  validateDocumentSnapshot,
  type DocumentSnapshot,
} from "@/lib/documents/model";
import { exemplarFor } from "@/lib/presentation/exemplars";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { DocumentRenderer } from "./DocumentRenderer";
import styles from "./TemplateGallery.module.css";

// A look is only legible through content. An empty document previews as eight
// identical blank cards, so a document with nothing in it yet borrows the
// template's own example instead. Still validated data, still the same
// renderer: this only changes which snapshot is shown.
function exampleFor(template: TemplateDefinition): DocumentSnapshot {
  const exemplar = exemplarFor(template.id);
  return validateDocumentSnapshot({
    schemaVersion: 1,
    content: {
      title: exemplar?.title ?? template.name,
      body: exemplar?.body ?? "",
      fields: exemplar?.fields ?? {},
      tags: [],
      assets: exemplar?.assets ?? [],
    },
    presentation: {
      template: { id: template.id, version: template.version },
      theme: {},
    },
  });
}

function isBlank(document: DocumentSnapshot): boolean {
  return (
    !document.content.title.trim() &&
    !document.content.body.trim() &&
    !document.content.assets.length
  );
}

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
  const applied = document.presentation.template;
  const isApplied = (template: TemplateDefinition) =>
    template.id === applied.id && template.version === applied.version;
  const [preview, setPreview] = useState<TemplateDefinition | null>(null);
  const blank = isBlank(document);
  const shown = (template: TemplateDefinition) =>
    blank ? exampleFor(template) : document;
  const [focusIndex, setFocusIndex] = useState(0);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const backRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (preview) {
      // Judge a look from its masthead down, not from its footer up.
      continueRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    } else {
      cardRefs.current[focusIndex]?.focus({ preventScroll: true });
    }
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
      event.stopPropagation();
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
            Choose another look
          </button>
          <div className={styles.previewDocument}>
            <DocumentRenderer document={shown(preview)} template={preview} documentId="template-preview" />
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
            Use this look
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
        {blank && (
          <p className={styles.note}>
            Previews use example content until this document has some.
          </p>
        )}
        <div className={styles.grid} onKeyDown={handleGridKey}>
          {templates.map((template, index) => (
            <button
              key={`${template.id}@${template.version}`}
              ref={(node) => { cardRefs.current[index] = node; }}
              type="button"
              className={`${styles.card}${isApplied(template) ? ` ${styles.cardApplied}` : ""}`}
              aria-current={isApplied(template) ? "true" : undefined}
              onFocus={() => setFocusIndex(index)}
              onClick={() => setPreview(template)}
              aria-label={
                isApplied(template)
                  ? `${template.name}, current look`
                  : template.name
              }
            >
              <div className={styles.cardPreview} aria-hidden="true">
                <div className={styles.cardPreviewInner}>
                  <DocumentRenderer
                    document={shown(template)}
                    template={template}
                    documentId={`template-${index}`}
                  />
                </div>
              </div>
              <span className={styles.cardName}>
                {template.name}
                {isApplied(template) && (
                  <span className={styles.cardCurrent}>Current</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
