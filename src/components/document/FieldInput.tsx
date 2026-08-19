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

import { useId, useMemo, useRef, useState } from "react";
import type { DocumentFieldRow, DocumentFieldValue } from "@/lib/documents/model";
import type {
  DocumentFieldDefinition,
  RowSubFieldDefinition,
} from "@/lib/presentation/schema";
import { statusWorkflowOptions } from "@/lib/presentation/workflow";
import type { WorkspaceReferenceChoice } from "@/lib/presentation/workspace-reference-choices";

export type FieldInputProps = {
  field: DocumentFieldDefinition;
  value: DocumentFieldValue | undefined;
  onChange: (value: DocumentFieldValue) => void;
  referenceChoices?: readonly WorkspaceReferenceChoice[];
  disabled?: boolean;
  embedded?: boolean;
};

const text = (value: DocumentFieldValue | undefined): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

export function FieldInput({
  field,
  value,
  onChange,
  referenceChoices = [],
  disabled,
  embedded = false,
}: FieldInputProps) {
  const id = useId();
  const label = field.label || field.id;
  const currentText = text(value);

  if (field.type === "image") {
    if (embedded && !currentText) return null;

    return (
      <div
        className={`tt-field-row is-image${embedded ? " is-embedded" : ""}`}
        data-field-id={field.id}
      >
        <span className="tt-field-label">
          {label}
          {field.required ? <span aria-hidden="true"> *</span> : null}
        </span>
        <div className={`tt-image-field-control${embedded ? " is-canvas" : ""}`}>
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

  if (field.type === "reference" && field.semantic === "people") {
    return (
      <div
        className={`tt-field-row is-reference is-people${embedded ? " is-embedded" : ""}`}
        data-field-id={field.id}
      >
        <span className="tt-field-label" id={`${id}-label`}>
          {label}
          {field.required ? <span aria-hidden="true"> *</span> : null}
        </span>
        <PeopleReferenceInput
          field={field}
          value={value}
          choices={referenceChoices}
          disabled={disabled}
          labelledBy={`${id}-label`}
          onChange={onChange}
        />
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
            maxLength={field.maxLength}
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
        const workflow = statusWorkflowOptions(field, value);
        if (workflow) {
          const currentValue =
            typeof value === "string" && value.trim() ? value : "";
          return (
            <span className="tt-status-workflow-control">
              <select
                id={id}
                className="tt-field-input is-select is-status"
                value={currentValue}
                disabled={disabled || (workflow.current !== null && workflow.next.length === 0)}
                onChange={(event) => onChange(event.target.value || null)}
              >
                {!workflow.current ? <option value="">Choose a starting state</option> : null}
                {workflow.current ? (
                  <optgroup label="Current">
                    <option value={workflow.current.value}>
                      {workflow.current.label}
                    </option>
                  </optgroup>
                ) : null}
                {workflow.next.length > 0 ? (
                  <optgroup label={workflow.current ? "Next" : "Start with"}>
                    {workflow.next.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.icon ? `${option.icon} ${option.label}` : option.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <small>
                {workflow.next.length > 0
                  ? `${workflow.current ? "Next" : "Start"}: ${workflow.next
                      .map((option) => option.label)
                      .join(" or ")}`
                  : "No next step"}
              </small>
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
            maxLength={field.type === "text" ? field.maxLength : undefined}
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

type PeopleField = Extract<DocumentFieldDefinition, { type: "reference" }>;

function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function PeopleReferenceInput({
  field,
  value,
  choices,
  disabled,
  labelledBy,
  onChange,
}: {
  field: PeopleField;
  value: DocumentFieldValue | undefined;
  choices: readonly WorkspaceReferenceChoice[];
  disabled?: boolean;
  labelledBy: string;
  onChange: (value: DocumentFieldValue) => void;
}) {
  const picker = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
  const [manualValue, setManualValue] = useState("");
  const selected = useMemo(
    () =>
      (field.multiple
        ? Array.isArray(value)
          ? value
          : value == null
            ? []
            : [value]
        : value == null
          ? []
          : [value]
      ).filter((entry): entry is string => typeof entry === "string" && Boolean(entry)),
    [field.multiple, value],
  );
  const choiceById = useMemo(
    () => new Map(choices.map((choice) => [choice.id, choice] as const)),
    [choices],
  );
  const filteredChoices = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return choices;
    return choices.filter((choice) =>
      `${choice.label} ${choice.description ?? ""}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [choices, query]);
  const choose = (choiceId: string) => {
    if (field.multiple) {
      onChange(
        selected.includes(choiceId)
          ? selected.filter((entry) => entry !== choiceId)
          : [...selected, choiceId],
      );
      return;
    }
    onChange(choiceId);
    picker.current?.removeAttribute("open");
    setQuery("");
  };
  const addManual = () => {
    const entries = manualValue
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length === 0) return;
    onChange(field.multiple ? [...new Set([...selected, ...entries])] : entries[0]!);
    setManualValue("");
  };

  return (
    <div className="tt-people-picker" aria-labelledby={labelledBy}>
      {selected.length > 0 ? (
        <div className="tt-people-selection" aria-label="Selected people">
          {selected.map((entry) => {
            const choice = choiceById.get(entry);
            const label = choice?.label ?? entry;
            return (
              <span className="tt-person-chip" key={entry}>
                <span className="tt-person-avatar" aria-hidden="true">
                  {initials(label)}
                </span>
                <span>{label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  disabled={disabled}
                  onClick={() =>
                    onChange(
                      field.multiple
                        ? selected.filter((selectedId) => selectedId !== entry)
                        : null,
                    )
                  }
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <span className="tt-people-empty">No one selected</span>
      )}

      {choices.length > 0 ? (
        <details className="tt-people-picker-menu" ref={picker}>
          <summary
            aria-disabled={disabled}
            onClick={(event) => {
              if (disabled) event.preventDefault();
            }}
          >
            {selected.length > 0 ? "Change people" : "Choose people"}
          </summary>
          <div className="tt-people-picker-popover">
            <input
              type="search"
              className="tt-field-input"
              value={query}
              placeholder="Find a workspace item"
              aria-label="Find people"
              disabled={disabled}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="tt-people-options" role="listbox" aria-multiselectable={field.multiple}>
              {filteredChoices.map((choice) => {
                const active = selected.includes(choice.id);
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={active ? "is-selected" : undefined}
                    key={choice.id}
                    disabled={disabled}
                    onClick={() => choose(choice.id)}
                  >
                    <span className="tt-person-avatar" aria-hidden="true">
                      {initials(choice.label)}
                    </span>
                    <span>
                      <strong>{choice.label}</strong>
                      {choice.description ? <small>{choice.description}</small> : null}
                    </span>
                    <span aria-hidden="true">{active ? "✓" : ""}</span>
                  </button>
                );
              })}
              {filteredChoices.length === 0 ? <p>No matching items</p> : null}
            </div>
          </div>
        </details>
      ) : null}

      <details className="tt-people-manual">
        <summary
          aria-disabled={disabled}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
        >
          {choices.length > 0 ? "Use an ID instead" : "Enter a person or item ID"}
        </summary>
        <div>
          <input
            type="text"
            className="tt-field-input"
            value={field.multiple ? manualValue : selected[0] ?? ""}
            placeholder={field.multiple ? "Add IDs, separated by commas" : "Person or item ID"}
            aria-label={field.multiple ? "Add people by ID" : "Person or item ID"}
            disabled={disabled}
            onChange={(event) =>
              field.multiple
                ? setManualValue(event.target.value)
                : onChange(event.target.value || null)
            }
            onKeyDown={(event) => {
              if (field.multiple && event.key === "Enter") {
                event.preventDefault();
                addManual();
              }
            }}
          />
          {field.multiple ? (
            <button type="button" disabled={disabled || !manualValue.trim()} onClick={addManual}>
              Add
            </button>
          ) : null}
        </div>
      </details>
    </div>
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
