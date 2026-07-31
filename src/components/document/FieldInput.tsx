"use client";

// One input per declared template field.
//
// A template declares typed fields; a document stores their values in
// content.fields. Until this component existed there was no way to FILL a
// field in from the UI: the renderer displayed values and the sync layer
// carried them, but only an agent could set one. The editor mounts one of
// these per declared field, either into the render slot where the template
// binds the field, or into the Details panel for declared-but-unbound fields.
//
// The control follows the declared type, so a new field type needs exactly one
// case added here and nowhere else.

import { useId } from "react";
import type { DocumentFieldRow, DocumentFieldValue } from "@/lib/documents/model";
import type {
  DocumentFieldDefinition,
  RowSubFieldDefinition,
} from "@/lib/presentation/schema";

export type FieldInputProps = {
  field: DocumentFieldDefinition;
  value: DocumentFieldValue | undefined;
  onChange: (value: DocumentFieldValue) => void;
  disabled?: boolean;
  embedded?: boolean;
};

const text = (value: DocumentFieldValue | undefined): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

export function FieldInput({
  field,
  value,
  onChange,
  disabled,
  embedded = false,
}: FieldInputProps) {
  const id = useId();
  const label = field.label || field.id;
  const currentText = text(value);

  if (field.type === "image") {
    return (
      <div
        className={`tt-field-row is-image${embedded ? " is-embedded" : ""}`}
        data-field-id={field.id}
      >
        <span className="tt-field-label">
          {label}
          {field.required ? <span aria-hidden="true"> *</span> : null}
        </span>
        <div className="tt-image-field-control">
          {currentText ? (
            <img className="tt-image-field-preview" src={currentText} alt="" />
          ) : (
            <span className="tt-image-field-placeholder" aria-hidden="true">
              No image
            </span>
          )}
          <div className="tt-image-field-actions">
            <details className="tt-image-field-picker">
              <summary>{currentText ? "Change image" : "Add image"}</summary>
              <div className="tt-image-field-popover">
                <label htmlFor={id}>Image link</label>
                <input
                  id={id}
                  type="url"
                  className="tt-field-input"
                  value={currentText}
                  placeholder="Paste an image link"
                  disabled={disabled}
                  onChange={(event) => onChange(event.target.value)}
                  inputMode="url"
                />
              </div>
            </details>
            {currentText ? (
              <button type="button" disabled={disabled} onClick={() => onChange(null)}>
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const control = (() => {
    switch (field.type) {
      case "richtext":
        return (
          <textarea
            id={id}
            className="tt-field-input is-richtext"
            value={text(value)}
            placeholder={label}
            rows={3}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case "date":
        return (
          <input
            id={id}
            type="date"
            className="tt-field-input"
            value={text(value).slice(0, 10)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value || null)}
          />
        );
      case "url":
        return (
          <input
            id={id}
            type="url"
            className="tt-field-input"
            value={currentText}
            placeholder="https://"
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            inputMode="url"
          />
        );
      case "enum": {
        if (field.multiple) {
          const selected = Array.isArray(value)
            ? value.filter((entry): entry is string => typeof entry === "string")
            : [];
          return (
            <span className="tt-field-multienum" role="group" aria-label={label}>
              {field.options.map((option) => {
                const active = selected.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`tt-field-choice${active ? " is-active" : ""}`}
                    aria-pressed={active}
                    disabled={disabled}
                    onClick={() =>
                      onChange(
                        active
                          ? selected.filter((entry) => entry !== option.value)
                          : [...selected, option.value],
                      )
                    }
                  >
                    {option.icon ? `${option.icon} ` : ""}
                    {option.label}
                  </button>
                );
              })}
            </span>
          );
        }
        return (
          <select
            id={id}
            className="tt-field-input is-select"
            value={text(value)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value || null)}
          >
            <option value="">{"None"}</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.icon ? `${option.icon} ${option.label}` : option.label}
              </option>
            ))}
          </select>
        );
      }
      case "number":
        return (
          <input
            id={id}
            type="number"
            className="tt-field-input is-number"
            value={typeof value === "number" ? value : ""}
            min={field.min}
            max={field.max}
            step={field.step}
            disabled={disabled}
            onChange={(event) => {
              const parsed = event.target.valueAsNumber;
              onChange(Number.isFinite(parsed) ? parsed : null);
            }}
          />
        );
      case "boolean":
        return (
          <input
            id={id}
            type="checkbox"
            className="tt-field-input is-checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
          />
        );
      case "reference":
        // References store document/folder ids. A picker is a follow-up; the
        // id input keeps the value editable rather than trapped.
        return (
          <input
            id={id}
            type="text"
            className="tt-field-input"
            value={
              Array.isArray(value)
                ? value.filter((entry) => typeof entry === "string").join(", ")
                : text(value)
            }
            placeholder={field.multiple ? "ids, comma separated" : "id"}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                field.multiple
                  ? event.target.value
                      .split(",")
                      .map((entry) => entry.trim())
                      .filter(Boolean)
                  : event.target.value,
              )
            }
          />
        );
      case "rows":
        return (
          <RowsEditor
            field={field}
            rows={Array.isArray(value) ? (value as DocumentFieldRow[]) : []}
            disabled={disabled}
            onChange={onChange}
          />
        );
      case "text":
      default:
        return (
          <input
            id={id}
            type="text"
            className="tt-field-input"
            value={text(value)}
            placeholder={label}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        );
    }
  })();

  return (
    <label
      className={`tt-field-row is-${field.type}${embedded ? " is-embedded" : ""}`}
      htmlFor={id}
      data-field-id={field.id}
    >
      <span className="tt-field-label">
        {label}
        {field.required ? <span aria-hidden="true"> *</span> : null}
      </span>
      {control}
    </label>
  );
}

/** Every binding the template's item spec uses, so the editor can tell bound
 * fields (rendered in place) from declared-but-unbound ones (Details panel). */
export function collectBoundFields(node: unknown, into = new Set<string>()): Set<string> {
  if (typeof node !== "object" || node === null) return into;
  const record = node as Record<string, unknown>;
  if (typeof record.bind === "string" && record.bind.startsWith("content.fields.")) {
    into.add(record.bind.slice("content.fields.".length));
  }
  if (Array.isArray(record.children)) {
    for (const child of record.children) collectBoundFields(child, into);
  }
  return into;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type RowsField = Extract<DocumentFieldDefinition, { type: "rows" }>;

function emptyRow(field: RowsField): DocumentFieldRow {
  const row: DocumentFieldRow = {};
  for (const sub of field.fields) {
    row[sub.id] = sub.type === "boolean" ? false : null;
  }
  return row;
}

function RowScalarInput({
  sub,
  value,
  disabled,
  onChange,
}: {
  sub: RowSubFieldDefinition;
  value: DocumentFieldRow[string];
  disabled?: boolean;
  onChange: (value: DocumentFieldRow[string]) => void;
}) {
  switch (sub.type) {
    case "boolean":
      return (
        <input
          type="checkbox"
          className="tt-field-input is-checkbox"
          checked={value === true}
          disabled={disabled}
          aria-label={sub.label}
          onChange={(event) => onChange(event.target.checked)}
        />
      );
    case "date":
      return (
        <input
          type="date"
          className="tt-field-input"
          value={typeof value === "string" ? value.slice(0, 10) : ""}
          disabled={disabled}
          aria-label={sub.label}
          onChange={(event) => onChange(event.target.value || null)}
        />
      );
    case "number":
      return (
        <input
          type="number"
          className="tt-field-input is-number"
          value={typeof value === "number" ? value : ""}
          min={sub.min}
          max={sub.max}
          step={sub.step}
          disabled={disabled}
          aria-label={sub.label}
          onChange={(event) => {
            const parsed = event.target.valueAsNumber;
            onChange(Number.isFinite(parsed) ? parsed : null);
          }}
        />
      );
    case "enum":
      return (
        <select
          className="tt-field-input is-select"
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          aria-label={sub.label}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">{"None"}</option>
          {sub.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.icon ? `${option.icon} ${option.label}` : option.label}
            </option>
          ))}
        </select>
      );
    default:
      return (
        <input
          type={sub.type === "url" || sub.type === "image" ? "url" : "text"}
          className="tt-field-input"
          value={typeof value === "string" ? value : ""}
          placeholder={sub.label}
          disabled={disabled}
          aria-label={sub.label}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

/** The editor for a rows field: one line per record, one control per declared
 * sub-field, add and remove. This is also where checklists get edited, since a
 * checklist is a rows field with a boolean column. */
function RowsEditor({
  field,
  rows,
  disabled,
  onChange,
}: {
  field: RowsField;
  rows: DocumentFieldRow[];
  disabled?: boolean;
  onChange: (value: DocumentFieldValue) => void;
}) {
  const setRow = (index: number, subId: string, value: DocumentFieldRow[string]) => {
    const next = rows.map((row, i) => (i === index ? { ...row, [subId]: value } : row));
    onChange(next);
  };
  return (
    <div className="tt-rows-editor">
      {rows.map((row, index) => (
        <div className="tt-rows-editor-row" key={index}>
          {field.fields.map((sub) => (
            <RowScalarInput
              key={sub.id}
              sub={sub}
              value={row[sub.id] ?? null}
              disabled={disabled}
              onChange={(value) => setRow(index, sub.id, value)}
            />
          ))}
          <button
            type="button"
            className="tt-rows-editor-remove"
            aria-label={`Remove row ${index + 1}`}
            disabled={disabled}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            {"×"}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="tt-rows-editor-add"
        disabled={disabled || rows.length >= field.maxRows}
        onClick={() => onChange([...rows, emptyRow(field)])}
      >
        Add row
      </button>
    </div>
  );
}
