"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createItemTypeAction } from "@/app/editor/item-type-actions";
import {
  DocumentCollectionRenderer,
  DocumentEngineStyles,
  DocumentRenderer,
} from "@/components/document/DocumentRenderer";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { refreshWorkspacePool } from "@/lib/pool/store";
import {
  compileItemTypeBlueprint,
  ITEM_TYPE_STARTERS,
  itemTypeBlueprintSchema,
  type ItemTypeBlueprint,
  type ItemTypeFieldBlueprint,
} from "@/lib/presentation/item-type-blueprint";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import styles from "./ItemTypeStudio.module.css";

type StudioFolder = { id: string; name: string; path: string };

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

export function ItemTypeStudio({
  blogId,
  folders,
  generateWithConnectedAgent,
  handle,
  initialFolderPath = "",
  onClose,
  onCreated,
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
}) {
  const router = useRouter();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [design, setDesign] = useState<GeneratedDesign | null>(null);
  const [folderPath, setFolderPath] = useState(initialFolderPath);
  const [applyToExisting, setApplyToExisting] = useState(true);
  const [previewMode, setPreviewMode] = useState<"item" | "folder">("item");
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<NewFieldType>("text");
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    promptRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);

  const document = useMemo(
    () => (design ? previewDocument(design.template) : null),
    [design],
  );
  const collectionDocuments = useMemo(
    () =>
      design
        ? collectionPreviewDocuments(design.template, design.blueprint)
        : [],
    [design],
  );

  const setBlueprint = (next: ItemTypeBlueprint) => {
    try {
      setDesign(compiled(itemTypeBlueprintSchema.parse(next)));
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
        setDesign(compiled(blueprint));
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
      setDesign(compiled(blueprint));
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
    setBlueprint(current);
  };

  const renameField = (id: string, label: string) => {
    if (!design) return;
    const current = copyBlueprint(design.blueprint);
    const field = current.fields.find((candidate) => candidate.id === id);
    if (!field) return;
    field.label = label.slice(0, 160);
    setBlueprint(current);
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
      setBlueprint(current);
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
                        ? ("fact" as const)
                        : ("auto" as const),
                multiple: false,
                format: "plain" as const,
                target: "document" as const,
              }
            : newFieldType === "date"
              ? { ...common, type: "date", multiple: false, format: "plain", target: "document" }
              : { ...common, type: "boolean", multiple: false, format: "plain", target: "document" };
    current.fields.push(field);
    setBlueprint(current);
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
          display: "fact",
          multiple: false,
          format: "plain",
          target: "document",
        });
        current.collection.dateBy = "date";
      } else current.collection.dateBy = dated.id;
    } else delete current.collection.dateBy;
    setBlueprint(current);
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
          onClick={() => (design ? setDesign(null) : onClose())}
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
            disabled={Boolean(busy)}
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
                    setDesign(compiled(copyBlueprint(starter.blueprint)));
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
            <div className={styles.section}>
              <label>
                <span>Name</span>
                <input
                  value={design.blueprint.name}
                  maxLength={160}
                  onChange={(event) => {
                    const current = copyBlueprint(design.blueprint);
                    current.name = event.currentTarget.value || "Untitled type";
                    setBlueprint(current);
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
                    setBlueprint(current);
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
                  <option value="index">Index</option>
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
                    setBlueprint(current);
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
                placeholder="Ask for a change..."
                onChange={(event) => setFollowUp(event.currentTarget.value)}
              />
              <button type="submit" disabled={!followUp.trim() || Boolean(busy)}>
                {busy === "generate" ? "Updating" : "Update"}
              </button>
            </form>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </section>

          <section className={styles.preview} aria-label="Live preview">
            <header>
              <div>
                <strong>Preview</strong>
                <span>Real content renderer</span>
              </div>
              <div className={styles.previewTabs} role="tablist" aria-label="Preview surface">
                <button type="button" role="tab" aria-selected={previewMode === "item"} onClick={() => setPreviewMode("item")}>Item</button>
                <button type="button" role="tab" aria-selected={previewMode === "folder"} onClick={() => setPreviewMode("folder")}>Folder</button>
              </div>
            </header>
            <div className={styles.previewPaper}>
              {document && previewMode === "item" ? (
                <DocumentRenderer document={document} template={design.template} documentId="item-type-studio" preview />
              ) : document ? (
                <>
                  <DocumentEngineStyles />
                  {design.template.collection.layout === "board" && design.blueprint.collection.groupBy ? (
                  <div className={styles.boardPreview}>
                    {(() => {
                      const groupField = design.blueprint.fields.find(
                        (field) => field.id === design.blueprint.collection.groupBy && field.type === "enum",
                      );
                      return groupField && groupField.type === "enum"
                        ? groupField.options?.map((option) => {
                            const matches = collectionDocuments.filter(
                              (entry) => entry.content.fields[groupField.id] === option.value,
                            );
                            return (
                              <section key={option.value} className={styles.boardColumn}>
                                <header className={`${styles.boardHeader}${toneClass(option.tone)}`}>
                                  <span aria-hidden="true" />
                                  <strong>{option.label}</strong>
                                  <small>{matches.length}</small>
                                </header>
                                {matches.map((entry, index) => (
                                  <DocumentCollectionRenderer
                                    key={`${option.value}-${index}`}
                                    document={entry}
                                    template={design.template}
                                    documentId={`item-type-folder-${option.value}-${index}`}
                                  />
                                ))}
                              </section>
                            );
                          })
                        : null;
                    })()}
                  </div>
                  ) : design.template.collection.layout === "calendar" ? (
                  <div className={styles.calendarPreview}>
                    <header><strong>August 2026</strong></header>
                    <div className={styles.calendarWeekdays} aria-hidden="true">
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
                    </div>
                    <div className={styles.calendarGrid}>
                      {Array.from({ length: 28 }, (_, index) => {
                        const day = index + 1;
                        const entry = collectionDocuments.find((candidate) =>
                          Object.values(candidate.content.fields).includes(
                            `2026-08-${String(day).padStart(2, "0")}`,
                          ),
                        );
                        return <div key={day}><small>{day}</small>{entry ? <strong>{entry.content.title}</strong> : null}</div>;
                      })}
                    </div>
                  </div>
                  ) : (
                  <div className={styles.collectionPreview} data-layout={design.template.collection.layout}>
                    {collectionDocuments.map((entry, index) => (
                      <DocumentCollectionRenderer
                        key={entry.content.title}
                        document={entry}
                        template={design.template}
                        documentId={`item-type-folder-${index}`}
                      />
                    ))}
                  </div>
                  )}
                </>
              ) : null}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
