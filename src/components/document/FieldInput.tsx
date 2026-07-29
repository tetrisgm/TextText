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
import type { DocumentFieldValue } from "@/lib/documents/model";
import type { DocumentFieldDefinition } from "@/lib/presentation/schema";

export type FieldInputProps = {
  field: DocumentFieldDefinition;
  value: DocumentFieldValue | undefined;
  onChange: (value: DocumentFieldValue) => void;
  disabled?: boolean;
};

const text = (value: DocumentFieldValue | undefined): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

export function FieldInput({ field, value, onChange, disabled }: FieldInputProps) {
  const id = useId();
  const label = field.label || field.id;

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
      case "image":
        return (
          <input
            id={id}
            type="url"
            className="tt-field-input"
            value={text(value)}
            placeholder={field.type === "image" ? "Image address" : "https://"}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            inputMode="url"
          />
        );
      case "enum":
        return (
          <select
            id={id}
            className="tt-field-input is-select"
            value={text(value)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value || null)}
          >
            <option value="">{"—"}</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );
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
              Array.isArray(value) ? value.join(", ") : text(value)
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
      className={`tt-field-row is-${field.type}`}
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
