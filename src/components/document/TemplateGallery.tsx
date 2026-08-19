"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import {
  validateDocumentSnapshot,
  type DocumentSnapshot,
} from "@/lib/documents/model";
import { exemplarFor } from "@/lib/presentation/exemplars";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import {
  filterTemplateLibrary,
  parseTemplateLook,
  safeTemplateFilename,
  serializeTemplateLook,
  type TemplateLibraryEntry,
  type TemplateLibraryFilter,
} from "@/lib/presentation/template-library";
import { DocumentRenderer } from "./DocumentRenderer";
import styles from "./TemplateGallery.module.css";

function exampleFor(template: TemplateDefinition): DocumentSnapshot {
  const exemplar = exemplarFor(template.id);
  const example = template.example;
  return validateDocumentSnapshot({
    schemaVersion: 1,
    content: {
      title: exemplar?.title ?? example?.title ?? template.name,
      subtitle: example?.subtitle,
      body: exemplar?.body ?? example?.body ?? "",
      fields: exemplar?.fields ?? example?.fields ?? {},
      tags: example?.tags ?? [],
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

function inferredLibrary(
  templates: readonly TemplateDefinition[],
): TemplateLibraryEntry[] {
  return templates.map((definition) => ({
    definition,
    scope: definition.id.startsWith("texttext.") ? "texttext" : "workspace",
    createdAt: null,
    versions: [{ definition, createdAt: null }],
    impact: { itemCount: 0, folderCount: 0, folderNames: [] },
  }));
}

function downloadLook(template: TemplateDefinition) {
  const blob = new Blob([serializeTemplateLook(template)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = safeTemplateFilename(template.name);
  link.click();
  URL.revokeObjectURL(url);
}

type ImportDraft = {
  text: string;
  definition: TemplateDefinition;
};

export function TemplateGallery({
  document,
  templates,
  library,
  targetItemCount = 0,
  onApply,
  onClose,
  onDuplicate,
  onImport,
  onRestoreVersion,
}: {
  document: DocumentSnapshot;
  templates: readonly TemplateDefinition[];
  library?: readonly TemplateLibraryEntry[];
  targetItemCount?: number;
  onApply: (template: TemplateDefinition) => void;
  onClose: () => void;
  onDuplicate?: (
    template: TemplateDefinition,
    name: string,
  ) => Promise<TemplateDefinition>;
  onImport?: (
    text: string,
    mode: "new" | "update",
  ) => Promise<TemplateDefinition>;
  onRestoreVersion?: (
    template: TemplateDefinition,
  ) => Promise<TemplateDefinition>;
}) {
  const entries = useMemo(
    () => (library?.length ? [...library] : inferredLibrary(templates)),
    [library, templates],
  );
  const applied = document.presentation.template;
  const isApplied = (template: TemplateDefinition) =>
    template.id === applied.id && template.version === applied.version;
  const [preview, setPreview] = useState<TemplateDefinition | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TemplateLibraryFilter>("all");
  const [focusIndex, setFocusIndex] = useState(0);
  const [remixName, setRemixName] = useState("");
  const [showRemix, setShowRemix] = useState(false);
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blank = isBlank(document);
  const shown = (template: TemplateDefinition) =>
    blank ? exampleFor(template) : document;
  const filtered = useMemo(
    () => filterTemplateLibrary(entries, query, filter),
    [entries, filter, query],
  );
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const backRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const boundedFocusIndex = Math.min(
    focusIndex,
    Math.max(0, filtered.length - 1),
  );
  const previewEntry = preview
    ? entries.find((entry) => entry.definition.id === preview.id)
    : null;

  useEffect(() => {
    const bodyOverflow = window.document.body.style.overflow;
    const rootOverflow = window.document.documentElement.style.overflow;
    window.document.body.style.overflow = "hidden";
    window.document.documentElement.style.overflow = "hidden";
    return () => {
      window.document.body.style.overflow = bodyOverflow;
      window.document.documentElement.style.overflow = rootOverflow;
    };
  }, []);

  const openPreview = useCallback((template: TemplateDefinition) => {
    setPreview(template);
    setRemixName(`${template.name} remix`);
    setShowRemix(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!preview) return;
    continueRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [preview]);

  const back = useCallback(() => {
    if (importDraft) {
      setImportDraft(null);
      setError(null);
      return;
    }
    if (preview) {
      setPreview(null);
      return;
    }
    onClose();
  }, [importDraft, onClose, preview]);

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
      : window.matchMedia("(max-width: 1180px)").matches
        ? 2
        : 4;
    let next = boundedFocusIndex;
    if (event.key === "ArrowRight") next += 1;
    else if (event.key === "ArrowLeft") next -= 1;
    else if (event.key === "ArrowDown") next += columns;
    else if (event.key === "ArrowUp") {
      if (boundedFocusIndex < columns) {
        event.preventDefault();
        backRef.current?.focus();
        return;
      }
      next -= columns;
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = filtered[boundedFocusIndex]?.definition;
      if (selected) openPreview(selected);
      return;
    } else return;
    event.preventDefault();
    const bounded = Math.max(0, Math.min(filtered.length - 1, next));
    setFocusIndex(bounded);
    cardRefs.current[bounded]?.focus();
  };

  const readImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      setImportDraft({ text, definition: parseTemplateLook(text) });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not read that look.",
      );
    }
  };

  const run = async (operation: () => Promise<TemplateDefinition>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const definition = await operation();
      setImportDraft(null);
      openPreview(definition);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not change that look.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (importDraft && onImport) {
    const canUpdate =
      !importDraft.definition.id.startsWith("texttext.") &&
      entries.some(
        (entry) =>
          entry.definition.id === importDraft.definition.id &&
          entry.scope !== "texttext",
      );
    return (
      <div
        className={styles.backdrop}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-look-title"
      >
        <section className={styles.importPanel}>
          <button
            ref={backRef}
            type="button"
            className={styles.backButton}
            onClick={back}
          >
            Library
          </button>
          <div className={styles.importPreview} aria-hidden="true">
            <DocumentRenderer
              document={exampleFor(importDraft.definition)}
              template={importDraft.definition}
              documentId="import-look-preview"
              preview
            />
          </div>
          <div className={styles.importCopy}>
            <span className={styles.eyebrow}>Import look</span>
            <h2 id="import-look-title">{importDraft.definition.name}</h2>
            <p>
              The file passed TextText&apos;s safe look schema. Choose whether it
              becomes an independent look or the next immutable version.
            </p>
            <div className={styles.importChoices}>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => onImport(importDraft.text, "new"))
                }
              >
                <strong>Save as new</strong>
                <span>Keep it separate from every existing look.</span>
              </button>
              <button
                type="button"
                disabled={busy || !canUpdate}
                onClick={() =>
                  void run(() => onImport(importDraft.text, "update"))
                }
              >
                <strong>Update existing</strong>
                <span>
                  {canUpdate
                    ? `Create the next version of ${importDraft.definition.name}.`
                    : "No matching workspace look exists."}
                </span>
              </button>
            </div>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>
        </section>
      </div>
    );
  }

  if (preview) {
    const at = entries.findIndex(
      (entry) => entry.definition.id === preview.id,
    );
    const step = (delta: number) => {
      const next = entries[(at + delta + entries.length) % entries.length];
      if (next) openPreview(next.definition);
    };
    const folderNames = previewEntry?.impact.folderNames ?? [];
    return (
      <div
        className={styles.backdrop}
        role="dialog"
        aria-modal="true"
        aria-label="Preview look"
        onKeyDown={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.matches("input, textarea, [contenteditable=true]")) return;
          if (event.key === "ArrowRight") {
            event.preventDefault();
            step(1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            step(-1);
          }
        }}
      >
        <section className={styles.preview}>
          <button
            ref={backRef}
            type="button"
            className={`${styles.backButton} ${styles.previewBack}`}
            onClick={() => setPreview(null)}
          >
            All looks
          </button>
          <div className={styles.previewStep}>
            <button
              type="button"
              aria-label="Previous look"
              onClick={() => step(-1)}
            >
              &#8249;
            </button>
            <span>{preview.name}</span>
            <button
              type="button"
              aria-label="Next look"
              onClick={() => step(1)}
            >
              &#8250;
            </button>
          </div>
          <div className={styles.previewLayout}>
            <div className={styles.previewDocument}>
              <DocumentRenderer
                document={shown(preview)}
                template={preview}
                documentId="template-preview"
                preview
              />
            </div>
            <aside className={styles.details} aria-label="Look details">
              <span
                className={styles.scopeLabel}
                data-scope={previewEntry?.scope ?? "workspace"}
              >
                {previewEntry?.scope === "personal"
                  ? "My look"
                  : previewEntry?.scope === "texttext"
                    ? "TextText"
                    : "Workspace"}
              </span>
              <h2>{preview.name}</h2>
              {preview.description && <p>{preview.description}</p>}
              <dl className={styles.impact}>
                <div>
                  <dt>Items using it</dt>
                  <dd>{previewEntry?.impact.itemCount ?? 0}</dd>
                </div>
                <div>
                  <dt>Folders using it</dt>
                  <dd>{previewEntry?.impact.folderCount ?? 0}</dd>
                </div>
                <div>
                  <dt>This change</dt>
                  <dd>
                    {isApplied(preview) ? "No changes" : `${targetItemCount} items`}
                  </dd>
                </div>
              </dl>
              {folderNames.length > 0 && (
                <p className={styles.folderNames}>
                  Used by {folderNames.slice(0, 3).join(", ")}
                  {folderNames.length > 3
                    ? ` and ${folderNames.length - 3} more`
                    : ""}
                </p>
              )}
              <button
                ref={continueRef}
                type="button"
                className={styles.continueButton}
                onClick={() =>
                  isApplied(preview) ? onClose() : onApply(preview)
                }
              >
                {isApplied(preview) ? "Keep this look" : "Use this look"}
              </button>
              <div className={styles.secondaryActions}>
                <button type="button" onClick={() => downloadLook(preview)}>
                  Export
                </button>
                {onDuplicate && (
                  <button
                    type="button"
                    onClick={() => setShowRemix((shown) => !shown)}
                  >
                    Remix
                  </button>
                )}
              </div>
              {showRemix && onDuplicate && (
                <form
                  className={styles.remixForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(() => onDuplicate(preview, remixName));
                  }}
                >
                  <label htmlFor="remix-look-name">Save as new</label>
                  <div>
                    <input
                      id="remix-look-name"
                      value={remixName}
                      onChange={(event) => setRemixName(event.target.value)}
                      maxLength={160}
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={busy || !remixName.trim()}
                    >
                      Save
                    </button>
                  </div>
                </form>
              )}
              {(previewEntry?.versions.length ?? 0) > 1 && (
                <div className={styles.history}>
                  <h3>Version history</h3>
                  {previewEntry?.versions.map((version, index) => (
                    <div
                      key={version.definition.version}
                      className={styles.versionRow}
                    >
                      <button
                        type="button"
                        onClick={() => openPreview(version.definition)}
                      >
                        <strong>Version {version.definition.version}</strong>
                        <span>
                          {index === 0
                            ? "Current"
                            : version.createdAt
                              ? new Date(version.createdAt).toLocaleDateString()
                              : "Earlier"}
                        </span>
                      </button>
                      {index > 0 && onRestoreVersion && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              onRestoreVersion(version.definition),
                            )
                          }
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
            </aside>
          </div>
        </section>
      </div>
    );
  }

  const counts = {
    texttext: entries.filter((entry) => entry.scope === "texttext").length,
    personal: entries.filter((entry) => entry.scope === "personal").length,
    workspace: entries.filter((entry) => entry.scope === "workspace").length,
  };
  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-gallery-title"
    >
      <section className={styles.chooser}>
        <header className={styles.libraryHeader}>
          <button
            ref={backRef}
            type="button"
            className={styles.backButton}
            onClick={onClose}
          >
            Back
          </button>
          <div>
            <span className={styles.eyebrow}>Look library</span>
            <h2 id="template-gallery-title">Choose a look</h2>
            {blank && (
              <p className={styles.note}>
                Previews use example content until this document has some.
              </p>
            )}
          </div>
          {onImport && (
            <label className={styles.importButton}>
              Import
              <input
                type="file"
                accept=".json,.texttext-look.json,application/json"
                onChange={(event) => void readImport(event)}
              />
            </label>
          )}
        </header>
        <div className={styles.libraryTools}>
          <label className={styles.search}>
            <span>Search looks</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setFocusIndex(0);
              }}
              placeholder="Search looks"
            />
          </label>
          <div className={styles.filters} aria-label="Filter looks">
            {(
              [
                ["all", "All", entries.length],
                ["personal", "Mine", counts.personal],
                ["workspace", "Workspace", counts.workspace],
                ["texttext", "TextText", counts.texttext],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value);
                  setFocusIndex(0);
                }}
              >
                {label} <span>{count}</span>
              </button>
            ))}
          </div>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {filtered.length > 0 ? (
          <div className={styles.grid} onKeyDown={handleGridKey}>
            {filtered.map((entry, index) => {
              const template = entry.definition;
              return (
                <button
                  key={`${template.id}@${template.version}`}
                  data-template-id={template.id}
                  data-template-version={template.version}
                  ref={(node) => {
                    cardRefs.current[index] = node;
                  }}
                  type="button"
                  className={`${styles.card}${isApplied(template) ? ` ${styles.cardApplied}` : ""}`}
                  aria-current={isApplied(template) ? "true" : undefined}
                  onFocus={() => setFocusIndex(index)}
                  onClick={() => openPreview(template)}
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
                        preview
                      />
                    </div>
                  </div>
                  <span className={styles.cardName}>
                    <span>
                      <strong>{template.name}</strong>
                      <small>
                        {entry.scope === "personal"
                          ? "Mine"
                          : entry.scope === "texttext"
                            ? "TextText"
                            : "Workspace"}
                      </small>
                    </span>
                    {isApplied(template) && (
                      <span className={styles.cardCurrent}>Current</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className={styles.empty}>
            <h3>No looks found</h3>
            <p>Try another search or library.</p>
          </div>
        )}
      </section>
    </div>
  );
}
