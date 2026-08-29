"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createItemTypeAction } from "@/app/editor/item-type-actions";
import {
  DocumentCollectionRenderer,
  DocumentEngineStyles,
  DocumentRenderer,
} from "@/components/document/DocumentRenderer";
import {
  validateDocumentSnapshot,
  type DocumentSnapshot,
} from "@/lib/documents/model";
import { refreshWorkspacePool } from "@/lib/pool/store";
import {
  compileItemTypeBlueprint,
  ITEM_TYPE_STARTERS,
  itemTypeBlueprintSchema,
  type ItemTypeBlueprint,
  type ItemTypeFieldBlueprint,
} from "@/lib/presentation/item-type-blueprint";
import { assessItemTypeQuality } from "@/lib/presentation/item-type-quality";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import {
  EMPTY_STUDIO_TIMELINE,
  addStudioRevision,
  currentStudioRevision,
  moveStudioTimeline,
  type StudioRevisionSource,
} from "./item-type-studio-state";
import styles from "./ItemTypeStudio.module.css";

type StudioFolder = { id: string; name: string; path: string };

type ItemTypeStudioPreviewDocument = {
  folderPath: string;
  document: DocumentSnapshot;
};

type GeneratedDesign = {
  blueprint: ItemTypeBlueprint;
  template: TemplateDefinition;
};

type NewFieldType =
  | "text"
  | "richtext"
  | "image"
  | "url"
  | "date"
  | "number"
  | "boolean"
  | "enum"
  | "rows";

type PreviewContentMode = "folder" | "sample" | "empty" | "stress";
type PreviewDevice = "desktop" | "tablet" | "phone";

function copyBlueprint(blueprint: ItemTypeBlueprint): ItemTypeBlueprint {
  return itemTypeBlueprintSchema.parse(structuredClone(blueprint));
}

function fieldId(label: string, fields: readonly ItemTypeFieldBlueprint[]): string {
  const base =
    label
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((part, index) =>
        index === 0
          ? part.toLowerCase()
          : `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`,
      )
      .join("") || "property";
  const used = new Set(fields.map((field) => field.id));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

function previewDocument(template: TemplateDefinition) {
  return validateDocumentSnapshot({
    schemaVersion: 1,
    content: {
      title: template.example?.title ?? template.name,
      subtitle: template.example?.subtitle,
      body: template.example?.body ?? "",
      fields: template.example?.fields ?? {},
      tags: template.example?.tags ?? [],
      assets: [],
    },
    presentation: {
      template: { id: template.id, version: template.version },
      theme: {},
    },
  });
}

function collectionPreviewDocuments(
  template: TemplateDefinition,
  blueprint: ItemTypeBlueprint,
) {
  const base = previewDocument(template);
  const titles =
    blueprint.item.shape === "article"
      ? ["The quiet craft of better work", "Notes from the edge", "What changed this week"]
      : blueprint.item.shape === "note"
        ? ["Books to remember", "Ideas for Saturday", "A thought for later"]
        : blueprint.item.shape === "reference"
          ? ["Design systems", "Research archive", "Useful patterns"]
          : ["Plan the launch", "Draft the brief", "Publish the update"];
  return titles.map((title, index) => {
    const fields = { ...base.content.fields };
    for (const field of blueprint.fields) {
      if (field.type === "rows" || field.type === "image" || field.type === "richtext") {
        continue;
      }
      if (field.type === "enum") {
        const option = field.options?.[index % (field.options?.length || 1)];
        fields[field.id] = field.multiple
          ? option
            ? [option.value]
            : []
          : option?.value ?? null;
      } else if (field.type === "boolean") {
        fields[field.id] = index === 2;
      } else if (field.type === "date") {
        fields[field.id] = `2026-08-${String(19 + index * 3).padStart(2, "0")}`;
      } else if (field.type === "number") {
        fields[field.id] = index + 1;
      }
    }
    return validateDocumentSnapshot({
      ...base,
      content: {
        ...base.content,
        title,
        fields,
      },
    });
  });
}

function retargetPreviewDocument(
  document: DocumentSnapshot,
  template: TemplateDefinition,
): DocumentSnapshot {
  return validateDocumentSnapshot({
    ...structuredClone(document),
    presentation: {
      template: { id: template.id, version: template.version },
      theme: {},
    },
  });
}

function emptyPreviewDocument(template: TemplateDefinition): DocumentSnapshot {
  return validateDocumentSnapshot({
    schemaVersion: 1,
    content: {
      title: "",
      body: "",
      fields: {},
      tags: [],
      assets: [],
    },
    presentation: {
      template: { id: template.id, version: template.version },
      theme: {},
    },
  });
}

function stressPreviewDocuments(
  template: TemplateDefinition,
  blueprint: ItemTypeBlueprint,
): DocumentSnapshot[] {
  return Array.from({ length: 4 }, (_, index) => {
    const base = previewDocument(template);
    const fields = { ...base.content.fields };
    for (const field of blueprint.fields) {
      if (field.type === "enum") {
        const values = field.options?.map((option) => option.value) ?? [];
        fields[field.id] = field.multiple ? values.slice(0, 3) : values[index % Math.max(values.length, 1)] ?? null;
      } else if (field.type === "boolean") {
        fields[field.id] = index % 2 === 0;
      } else if (field.type === "date") {
        fields[field.id] = "2026-08-29";
      } else if (field.type === "number") {
        fields[field.id] = 987654 + index;
      } else if (field.type === "url") {
        fields[field.id] = "https://example.com/a-deliberately-long-reference-path";
      } else if (field.type === "richtext") {
        fields[field.id] = "A long section tests rhythm, wrapping, and hierarchy.\n\nThe preview should remain calm even when the material is dense and uneven.";
      } else if (field.type === "text") {
        fields[field.id] = "A deliberately long property value that should wrap without crowding nearby information";
      } else if (field.type === "rows") {
        fields[field.id] = Array.from({ length: 5 }, (_, rowIndex) =>
          Object.fromEntries(
            field.fields.map((rowField) => [
              rowField.id,
              rowField.type === "boolean"
                ? rowIndex < 2
                : rowField.type === "number"
                  ? rowIndex + 1
                  : `A checklist item with enough text to test wrapping ${rowIndex + 1}`,
            ]),
          ),
        );
      }
    }
    return validateDocumentSnapshot({
      ...base,
      content: {
        ...base.content,
        title:
          index === 0
            ? "A very long title that tests how this design handles a difficult line break without losing its hierarchy"
            : `Stress test item ${index + 1}`,
        subtitle:
          "An intentionally long subtitle reveals weak spacing before a real reader does.",
        body:
          "Real work is rarely tidy. This preview uses longer text, crowded properties, and repeated sections to expose fragile decisions before the design is saved.\n\nA second paragraph tests the reading measure and vertical rhythm.",
        fields,
        tags: ["Long label", "Second tag", "A crowded third tag"],
      },
    });
  });
}

function previewContentForDesign(
  design: GeneratedDesign,
  mode: PreviewContentMode,
  folderDocuments: readonly DocumentSnapshot[],
): { item: DocumentSnapshot; collection: DocumentSnapshot[] } {
  if (mode === "empty") {
    return { item: emptyPreviewDocument(design.template), collection: [] };
  }
  if (mode === "stress") {
    const collection = stressPreviewDocuments(design.template, design.blueprint);
    return { item: collection[0], collection };
  }
  if (mode === "folder" && folderDocuments.length > 0) {
    const collection = folderDocuments
      .slice(0, 8)
      .map((document) => retargetPreviewDocument(document, design.template));
    return { item: collection[0], collection };
  }
  const collection = collectionPreviewDocuments(design.template, design.blueprint);
  return { item: previewDocument(design.template), collection };
}

function toneClass(tone: string | undefined) {
  return tone ? ` ${styles[`tone${tone.slice(0, 1).toUpperCase()}${tone.slice(1)}`] ?? ""}` : "";
}

function compiled(blueprint: ItemTypeBlueprint): GeneratedDesign {
  return {
    blueprint,
    template: compileItemTypeBlueprint(blueprint, { id: "preview.item-type" }),
  };
}

function propertyTypeLabel(field: ItemTypeFieldBlueprint): string {
  if (field.type === "enum") return field.multiple ? "Multi-select" : "Select";
  if (field.type === "richtext") return "Text block";
  if (field.type === "rows") return "List";
  return `${field.type.slice(0, 1).toUpperCase()}${field.type.slice(1)}`;
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 4 8 8m0-8-8 8" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}

function PreviewSurface({
  collectionDocuments,
  design,
  itemDocument,
  label,
  previewMode,
}: {
  collectionDocuments: DocumentSnapshot[];
  design: GeneratedDesign;
  itemDocument: DocumentSnapshot;
  label: string;
  previewMode: "item" | "folder";
}) {
  if (previewMode === "item") {
    return (
      <div className={styles.previewSurface} aria-label={label}>
        <DocumentRenderer
          document={itemDocument}
          template={design.template}
          documentId={`item-type-studio-${label}`}
          preview
        />
      </div>
    );
  }

  if (collectionDocuments.length === 0) {
    return (
      <div className={styles.previewSurface} aria-label={label}>
        <div className={styles.emptyPreview}>
          <span aria-hidden="true">□</span>
          <strong>No items yet</strong>
          <p>The folder stays quiet until its first item is added.</p>
        </div>
      </div>
    );
  }

  const groupField = design.blueprint.fields.find(
    (field) =>
      field.id === design.blueprint.collection.groupBy && field.type === "enum",
  );

  return (
    <div className={styles.previewSurface} aria-label={label}>
      <DocumentEngineStyles />
      {design.template.collection.layout === "board" &&
      groupField?.type === "enum" ? (
        <div className={styles.boardPreview}>
          {groupField.options?.map((option) => {
            const matches = collectionDocuments.filter(
              (entry) => entry.content.fields[groupField.id] === option.value,
            );
            return (
              <section key={option.value} className={styles.boardColumn}>
                <header
                  className={`${styles.boardHeader}${toneClass(option.tone)}`}
                >
                  <span aria-hidden="true" />
                  <strong>{option.label}</strong>
                  <small>{matches.length}</small>
                </header>
                {matches.map((entry, index) => (
                  <DocumentCollectionRenderer
                    key={`${option.value}-${index}`}
                    document={entry}
                    template={design.template}
                    documentId={`item-type-folder-${label}-${option.value}-${index}`}
                  />
                ))}
              </section>
            );
          })}
        </div>
      ) : design.template.collection.layout === "calendar" ? (
        <div className={styles.calendarPreview}>
          <header>
            <strong>August 2026</strong>
          </header>
          <div className={styles.calendarWeekdays} aria-hidden="true">
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
              <span key={`${day}-${index}`}>{day}</span>
            ))}
          </div>
          <div className={styles.calendarGrid}>
            {Array.from({ length: 28 }, (_, index) => {
              const day = index + 1;
              const entry = collectionDocuments.find((candidate) =>
                Object.values(candidate.content.fields).includes(
                  `2026-08-${String(day).padStart(2, "0")}`,
                ),
              );
              return (
                <div key={day}>
                  <small>{day}</small>
                  {entry ? <strong>{entry.content.title}</strong> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          className={styles.collectionPreview}
          data-layout={design.template.collection.layout}
        >
          {collectionDocuments.map((entry, index) => (
            <DocumentCollectionRenderer
              key={`${entry.content.title}-${index}`}
              document={entry}
              template={design.template}
              documentId={`item-type-folder-${label}-${index}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ItemTypeStudio({
  blogId,
  folders,
  generateWithConnectedAgent,
  handle,
  initialFolderPath = "",
  onClose,
  onCreated,
  previewDocuments = [],
}: {
  blogId: string;
  folders: readonly StudioFolder[];
  generateWithConnectedAgent?: (input: {
    current?: ItemTypeBlueprint;
    folderName?: string;
    request: string;
  }) => Promise<ItemTypeBlueprint>;
  handle: string;
  initialFolderPath?: string;
  onClose: () => void;
  onCreated?: (folderPath: string | null) => void;
  previewDocuments?: readonly ItemTypeStudioPreviewDocument[];
}) {
  const router = useRouter();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [timeline, setTimeline] = useState(EMPTY_STUDIO_TIMELINE);
  const [folderPath, setFolderPath] = useState(initialFolderPath);
  const [applyToExisting, setApplyToExisting] = useState(true);
  const [previewMode, setPreviewMode] = useState<"item" | "folder">("item");
  const [previewContentMode, setPreviewContentMode] =
    useState<PreviewContentMode>("sample");
  const [previewDevice, setPreviewDevice] =
    useState<PreviewDevice>("desktop");
  const [compare, setCompare] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<NewFieldType>("text");
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revision = currentStudioRevision(timeline);
  const design = useMemo(
    () => (revision ? compiled(revision.blueprint) : null),
    [revision],
  );
  const previousRevision = timeline.revisions[timeline.index - 1] ?? null;
  const previousDesign = useMemo(
    () => (previousRevision ? compiled(previousRevision.blueprint) : null),
    [previousRevision],
  );
  const qualityReport = useMemo(
    () => (design ? assessItemTypeQuality(design.blueprint) : null),
    [design],
  );
  const importantQualityFindings =
    qualityReport?.findings.filter((finding) => finding.severity === "important") ?? [];

  useEffect(() => {
    promptRef.current?.focus();
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [onClose]);

  const selectedFolderDocuments = useMemo(
    () =>
      previewDocuments
        .filter((entry) => entry.folderPath === folderPath)
        .map((entry) => entry.document),
    [folderPath, previewDocuments],
  );
  const effectivePreviewContentMode =
    previewContentMode === "folder" && selectedFolderDocuments.length === 0
      ? "sample"
      : previewContentMode;
  const isComparing = compare && Boolean(previousDesign);
  const previewContent = useMemo(
    () =>
      design
        ? previewContentForDesign(
            design,
            effectivePreviewContentMode,
            selectedFolderDocuments,
          )
        : null,
    [design, effectivePreviewContentMode, selectedFolderDocuments],
  );
  const previousPreviewContent = useMemo(
    () =>
      previousDesign
        ? previewContentForDesign(
            previousDesign,
            effectivePreviewContentMode,
            selectedFolderDocuments,
          )
        : null,
    [effectivePreviewContentMode, previousDesign, selectedFolderDocuments],
  );

  const setBlueprint = (
    next: ItemTypeBlueprint,
    label = "Edited design",
    source: StudioRevisionSource = "manual",
    options: { coalesce?: boolean; request?: string } = { coalesce: true },
  ) => {
    try {
      const blueprint = itemTypeBlueprintSchema.parse(next);
      compiled(blueprint);
      setTimeline((current) =>
        addStudioRevision(
          current,
          { blueprint, label, source, request: options.request },
          { coalesce: options.coalesce },
        ),
      );
      setError(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "That change could not be previewed.",
      );
    }
  };

  const generate = async (request: string, current?: ItemTypeBlueprint) => {
    const clean = request.trim();
    if (!clean || busy) return;
    setBusy("generate");
    setError(null);
    try {
      const folder = folders.find((candidate) => candidate.path === folderPath);
      if (generateWithConnectedAgent) {
        const blueprint = itemTypeBlueprintSchema.parse(
          await generateWithConnectedAgent({
            current,
            folderName: folder?.name,
            request: clean,
          }),
        );
        setBlueprint(blueprint, current ? "AI refinement" : "AI first draft", "ai", {
          coalesce: false,
          request: clean,
        });
        if (!current) setPreviewMode("item");
        setFollowUp("");
        return;
      }
      const response = await fetch("/api/ai/item-type", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: clean,
          current,
          folderName: folder?.name,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { blueprint?: unknown; template?: unknown; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error || "The assistant could not build that.");
      }
      const blueprint = itemTypeBlueprintSchema.parse(payload?.blueprint);
      setBlueprint(blueprint, current ? "AI refinement" : "AI first draft", "ai", {
        coalesce: false,
        request: clean,
      });
      if (!current) setPreviewMode("item");
      setFollowUp("");
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "The assistant could not build that.",
      );
    } finally {
      setBusy(null);
    }
  };

  const removeField = (id: string) => {
    if (!design) return;
    const current = copyBlueprint(design.blueprint);
    current.fields = current.fields.filter((field) => field.id !== id);
    current.collection.summaryFields = current.collection.summaryFields.filter(
      (field) => field !== id,
    );
    if (current.collection.sortBy === id) current.collection.sortBy = "updatedAt";
    if (current.collection.groupBy === id) {
      delete current.collection.groupBy;
      if (current.collection.layout === "board") current.collection.layout = "list";
    }
    if (current.collection.dateBy === id) {
      delete current.collection.dateBy;
      if (current.collection.layout === "calendar") current.collection.layout = "list";
    }
    setBlueprint(current, "Removed a property", "manual", { coalesce: false });
  };

  const renameField = (id: string, label: string) => {
    if (!design) return;
    const current = copyBlueprint(design.blueprint);
    const field = current.fields.find((candidate) => candidate.id === id);
    if (!field) return;
    field.label = label.slice(0, 160);
    setBlueprint(current, "Edited properties");
  };

  const addField = () => {
    if (!design || !newFieldLabel.trim()) return;
    const current = copyBlueprint(design.blueprint);
    const id = fieldId(newFieldLabel, current.fields);
    if (newFieldType === "rows") {
      current.fields.push({
        id,
        label: newFieldLabel.trim(),
        type: "rows",
        required: false,
        display: "checklist",
        fields: [
          {
            id: "done",
            label: "Done",
            type: "boolean",
            required: false,
            multiple: false,
            format: "plain",
            target: "document",
          },
          {
            id: "text",
            label: "Item",
            type: "text",
            required: false,
            multiple: false,
            format: "plain",
            target: "document",
          },
        ],
        maxRows: 200,
      });
      setBlueprint(current, "Added a property", "manual", { coalesce: false });
      setNewFieldLabel("");
      return;
    }
    const common = {
      id,
      label: newFieldLabel.trim(),
      required: false,
      display: newFieldType === "boolean" ? ("toggle" as const) : ("auto" as const),
    };
    const field: ItemTypeFieldBlueprint =
      newFieldType === "enum"
        ? {
            ...common,
            type: "enum",
            options: [
              { value: "option-one", label: "Option one" },
              { value: "option-two", label: "Option two" },
            ],
            multiple: false,
            format: "plain",
            target: "document",
          }
        : newFieldType === "number"
          ? { ...common, type: "number", multiple: false, format: "plain", target: "document" }
          : newFieldType === "text" ||
              newFieldType === "richtext" ||
              newFieldType === "image" ||
              newFieldType === "url"
            ? {
                ...common,
                type: newFieldType,
                display:
                  newFieldType === "image"
                    ? ("cover" as const)
                    : newFieldType === "richtext"
                      ? ("section" as const)
                      : newFieldType === "url"
                        ? ("auto" as const)
                        : ("auto" as const),
                multiple: false,
                format: "plain" as const,
                target: "document" as const,
              }
            : newFieldType === "date"
              ? { ...common, type: "date", multiple: false, format: "plain", target: "document" }
              : { ...common, type: "boolean", multiple: false, format: "plain", target: "document" };
    current.fields.push(field);
    setBlueprint(current, "Added a property", "manual", { coalesce: false });
    setNewFieldLabel("");
  };

  const setCollectionLayout = (
    layout: ItemTypeBlueprint["collection"]["layout"],
  ) => {
    if (!design) return;
    const current = copyBlueprint(design.blueprint);
    current.collection.layout = layout;
    if (layout === "board") {
      const group = current.fields.find(
        (field) => field.type === "enum" && !field.multiple,
      );
      if (!group) {
        current.fields.unshift({
          id: "status",
          label: "Status",
          type: "enum",
          required: false,
          display: "badge",
          options: [
            { value: "not-started", label: "Not started" },
            { value: "in-progress", label: "In progress" },
            { value: "done", label: "Done" },
          ],
          multiple: false,
          format: "plain",
          target: "document",
        });
        current.collection.groupBy = "status";
      } else current.collection.groupBy = group.id;
      current.collection.columns = 3;
    } else delete current.collection.groupBy;
    if (layout === "calendar") {
      const dated = current.fields.find((field) => field.type === "date");
      if (!dated) {
        current.fields.push({
          id: "date",
          label: "Date",
          type: "date",
          required: false,
          display: "auto",
          multiple: false,
          format: "plain",
          target: "document",
        });
        current.collection.dateBy = "date";
      } else current.collection.dateBy = dated.id;
    } else delete current.collection.dateBy;
    setBlueprint(current, "Changed folder view", "manual", { coalesce: false });
  };

  const save = async () => {
    if (!design || busy) return;
    setBusy("save");
    setError(null);
    try {
      const result = await createItemTypeAction(
        handle,
        design.blueprint,
        folderPath,
        applyToExisting,
      );
      if (!result.ok) throw new Error(result.error);
      await refreshWorkspacePool(handle, blogId);
      router.refresh();
      onCreated?.(result.folder?.path ?? null);
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save that item type.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="item-type-studio-title">
      <header className={styles.topbar}>
        <button
          type="button"
          className={styles.quietButton}
          onClick={() =>
            design ? setTimeline(EMPTY_STUDIO_TIMELINE) : onClose()
          }
        >
          {design ? "Back" : "Cancel"}
        </button>
        <div className={styles.topbarTitle}>
          <span>Build with AI</span>
          {design ? <strong>{design.blueprint.name}</strong> : null}
        </div>
        {design ? (
          <button
            type="button"
            className={styles.doneButton}
            disabled={Boolean(busy) || importantQualityFindings.length > 0}
            title={
              importantQualityFindings.length > 0
                ? "Fix important preflight issues before saving"
                : undefined
            }
            onClick={() => void save()}
          >
            {busy === "save" ? "Saving" : "Done"}
          </button>
        ) : (
          <button type="button" className={styles.iconButton} aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        )}
      </header>

      {!design ? (
        <main className={styles.promptCanvas}>
          <section className={styles.promptCard}>
            <span className={styles.spark} aria-hidden="true">✦</span>
            <h1 id="item-type-studio-title">What do you want to build?</h1>
            <p>
              Describe the items, the fields you need, and how the folder should
              look. You can name a visual reference such as Medium, Notion, or
              Apple Notes.
            </p>
            <form
              className={styles.promptForm}
              onSubmit={(event) => {
                event.preventDefault();
                void generate(prompt);
              }}
            >
              <textarea
                ref={promptRef}
                value={prompt}
                maxLength={6000}
                placeholder="A reading list with author, status, rating, and a card view..."
                onChange={(event) => setPrompt(event.currentTarget.value)}
              />
              <button type="submit" disabled={!prompt.trim() || Boolean(busy)} aria-label="Build this item type">
                {busy === "generate" ? <span className={styles.spinner} /> : <ArrowIcon />}
              </button>
            </form>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <div className={styles.starters} aria-label="Ready-made starting points">
              {ITEM_TYPE_STARTERS.map((starter) => (
                <button
                  key={starter.id}
                  type="button"
                  onClick={() => {
                    setBlueprint(
                      copyBlueprint(starter.blueprint),
                      `Started with ${starter.label}`,
                      "starter",
                      { coalesce: false },
                    );
                    setPreviewMode("item");
                    setError(null);
                  }}
                >
                  <strong>{starter.label}</strong>
                  <span>{starter.detail}</span>
                </button>
              ))}
            </div>
          </section>
        </main>
      ) : (
        <main className={styles.designCanvas}>
          <section className={styles.controls} aria-label="Item type settings">
            <div className={styles.historyPanel} aria-label="Design history">
              <div className={styles.historyHeading}>
                <div>
                  <strong>Design history</strong>
                  <span>Every direction is reversible</span>
                </div>
                <div className={styles.historyButtons}>
                  <button
                    type="button"
                    disabled={timeline.index <= 0}
                    onClick={() =>
                      setTimeline((current) =>
                        moveStudioTimeline(current, current.index - 1),
                      )
                    }
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    disabled={timeline.index >= timeline.revisions.length - 1}
                    onClick={() =>
                      setTimeline((current) =>
                        moveStudioTimeline(current, current.index + 1),
                      )
                    }
                  >
                    Redo
                  </button>
                </div>
              </div>
              <select
                aria-label="Design version"
                value={timeline.index}
                onChange={(event) =>
                  setTimeline((current) =>
                    moveStudioTimeline(current, Number(event.currentTarget.value)),
                  )
                }
              >
                {timeline.revisions.map((entry, index) => (
                  <option key={entry.id} value={index}>
                    {index + 1}. {entry.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.section}>
              <label>
                <span>Name</span>
                <input
                  value={design.blueprint.name}
                  maxLength={160}
                  onChange={(event) => {
                    const current = copyBlueprint(design.blueprint);
                    current.name = event.currentTarget.value || "Untitled type";
                    setBlueprint(current, "Edited details");
                  }}
                />
              </label>
              <label>
                <span>Visual direction</span>
                <input
                  value={design.blueprint.styleReference ?? ""}
                  placeholder="Notion, Medium, Apple Notes..."
                  maxLength={160}
                  onChange={(event) => {
                    const current = copyBlueprint(design.blueprint);
                    current.styleReference = event.currentTarget.value;
                    setBlueprint(current, "Edited details");
                  }}
                />
              </label>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionHeading}>
                <h2>Properties</h2>
                <span>{design.blueprint.fields.length}</span>
              </div>
              <div className={styles.properties}>
                {design.blueprint.fields.map((field) => (
                  <div className={styles.property} key={field.id}>
                    <input
                      aria-label={`Property name for ${field.label}`}
                      value={field.label}
                      onChange={(event) => renameField(field.id, event.currentTarget.value)}
                    />
                    <span>{propertyTypeLabel(field)}</span>
                    <button type="button" aria-label={`Remove ${field.label}`} onClick={() => removeField(field.id)}>
                      <CloseIcon />
                    </button>
                  </div>
                ))}
              </div>
              <div className={styles.addProperty}>
                <PlusIcon />
                <input
                  value={newFieldLabel}
                  placeholder="Add a property"
                  onChange={(event) => setNewFieldLabel(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addField();
                    }
                  }}
                />
                <select value={newFieldType} onChange={(event) => setNewFieldType(event.currentTarget.value as NewFieldType)}>
                  <option value="text">Text</option>
                  <option value="richtext">Text block</option>
                  <option value="image">Image</option>
                  <option value="url">URL</option>
                  <option value="date">Date</option>
                  <option value="number">Number</option>
                  <option value="boolean">Checkbox</option>
                  <option value="enum">Select</option>
                  <option value="rows">Checklist</option>
                </select>
                <button type="button" disabled={!newFieldLabel.trim()} onClick={addField}>Add</button>
              </div>
            </div>

            <div className={`${styles.section} ${styles.twoColumns}`}>
              <label>
                <span>Folder view</span>
                <select
                  value={design.blueprint.collection.layout}
                  onChange={(event) => setCollectionLayout(event.currentTarget.value as ItemTypeBlueprint["collection"]["layout"])}
                >
                  <option value="list">List</option>
                  <option value="cards">Cards</option>
                  <option value="board">Board</option>
                  <option value="calendar">Calendar</option>
                  <option value="timeline">Timeline</option>
                  <option value="single">Single focus</option>
                  <option value="heatmap">Heatmap</option>
                </select>
              </label>
              <label>
                <span>Item page</span>
                <select
                  value={design.blueprint.item.shape}
                  onChange={(event) => {
                    const current = copyBlueprint(design.blueprint);
                    current.item.shape = event.currentTarget.value as ItemTypeBlueprint["item"]["shape"];
                    setBlueprint(current, "Changed item page", "manual", {
                      coalesce: false,
                    });
                  }}
                >
                  <option value="page">Page</option>
                  <option value="article">Article</option>
                  <option value="note">Note</option>
                  <option value="task">Task</option>
                  <option value="reference">Reference</option>
                </select>
              </label>
            </div>

            <div className={styles.section}>
              <label>
                <span>Use in folder</span>
                <select value={folderPath} onChange={(event) => setFolderPath(event.currentTarget.value)}>
                  <option value="">Save for later</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.path}>{folder.name}</option>
                  ))}
                </select>
              </label>
              {folderPath ? (
                <label className={styles.checkbox}>
                  <input type="checkbox" checked={applyToExisting} onChange={(event) => setApplyToExisting(event.currentTarget.checked)} />
                  <span>Update items already in this folder</span>
                </label>
              ) : null}
            </div>

            <div className={styles.conversation} aria-label="Design conversation">
              {timeline.revisions
                .slice(0, timeline.index + 1)
                .filter((entry) => entry.request)
                .slice(-3)
                .map((entry) => (
                  <div className={styles.exchange} key={entry.id}>
                    <p className={styles.userMessage}>{entry.request}</p>
                    <p className={styles.agentMessage}>
                      <span aria-hidden="true">✦</span>
                      Preview updated. You can compare it with the previous version.
                    </p>
                  </div>
                ))}
              <form
                className={styles.refine}
                onSubmit={(event) => {
                  event.preventDefault();
                  void generate(followUp, design.blueprint);
                }}
              >
                <span aria-hidden="true">✦</span>
                <textarea
                  value={followUp}
                  maxLength={6000}
                  placeholder="Tell the agent what to change..."
                  onChange={(event) => setFollowUp(event.currentTarget.value)}
                />
                <button type="submit" disabled={!followUp.trim() || Boolean(busy)}>
                  {busy === "generate" ? "Updating" : "Send"}
                </button>
              </form>
            </div>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </section>

          <section className={styles.preview} aria-label="Live preview">
            <header className={styles.previewToolbar}>
              <div className={styles.previewTitle}>
                <div>
                  <strong>Preview</strong>
                  <span>Real content renderer</span>
                </div>
                <div className={styles.previewTabs} role="tablist" aria-label="Preview surface">
                  <button type="button" role="tab" aria-selected={previewMode === "item"} onClick={() => setPreviewMode("item")}>Item</button>
                  <button type="button" role="tab" aria-selected={previewMode === "folder"} onClick={() => setPreviewMode("folder")}>Folder</button>
                </div>
              </div>
              <div className={styles.previewOptions}>
                {qualityReport ? (
                  <details className={styles.preflight}>
                    <summary>
                      <span
                        data-status={
                          importantQualityFindings.length > 0
                            ? "important"
                            : qualityReport.findings.length > 0
                              ? "suggestion"
                              : "ready"
                        }
                        aria-hidden="true"
                      />
                      {importantQualityFindings.length > 0
                        ? "Needs attention"
                        : qualityReport.findings.length > 0
                          ? `${qualityReport.findings.length} suggestion${qualityReport.findings.length === 1 ? "" : "s"}`
                          : "Ready"}
                      <small>{qualityReport.score}</small>
                    </summary>
                    <div>
                      {qualityReport.findings.length > 0 ? (
                        qualityReport.findings.map((finding) => (
                          <p key={finding.code} data-severity={finding.severity}>
                            {finding.message}
                          </p>
                        ))
                      ) : (
                        <p>No preflight issues found.</p>
                      )}
                    </div>
                  </details>
                ) : null}
                <select
                  aria-label="Preview content"
                  value={effectivePreviewContentMode}
                  onChange={(event) =>
                    setPreviewContentMode(
                      event.currentTarget.value as PreviewContentMode,
                    )
                  }
                >
                  <option
                    value="folder"
                    disabled={selectedFolderDocuments.length === 0}
                  >
                    Folder content ({selectedFolderDocuments.length})
                  </option>
                  <option value="sample">Sample content</option>
                  <option value="empty">Empty state</option>
                  <option value="stress">Stress test</option>
                </select>
                <div className={styles.deviceTabs} role="group" aria-label="Preview device">
                  {(["desktop", "tablet", "phone"] as const).map((device) => (
                    <button
                      key={device}
                      type="button"
                      aria-pressed={previewDevice === device}
                      onClick={() => setPreviewDevice(device)}
                    >
                      {device === "desktop"
                        ? "Wide"
                        : device === "tablet"
                          ? "Tablet"
                          : "Phone"}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={styles.compareButton}
                  aria-pressed={isComparing}
                  disabled={!previousDesign}
                  onClick={() => setCompare((current) => !current)}
                >
                  Compare
                </button>
              </div>
            </header>
            <div
              className={styles.previewPaper}
              data-compare={isComparing ? "true" : undefined}
              data-device={previewDevice}
            >
              {previewContent ? (
                isComparing && previousDesign && previousPreviewContent ? (
                  <div className={styles.compareGrid}>
                    <div className={styles.comparePane}>
                      <span>Before</span>
                      <PreviewSurface
                        collectionDocuments={previousPreviewContent.collection}
                        design={previousDesign}
                        itemDocument={previousPreviewContent.item}
                        label="before"
                        previewMode={previewMode}
                      />
                    </div>
                    <div className={styles.comparePane}>
                      <span>Current</span>
                      <PreviewSurface
                        collectionDocuments={previewContent.collection}
                        design={design}
                        itemDocument={previewContent.item}
                        label="current"
                        previewMode={previewMode}
                      />
                    </div>
                  </div>
                ) : (
                  <PreviewSurface
                    collectionDocuments={previewContent.collection}
                    design={design}
                    itemDocument={previewContent.item}
                    label="current"
                    previewMode={previewMode}
                  />
                )
              ) : null}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
